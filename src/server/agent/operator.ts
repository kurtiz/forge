/**
 * Operator agent.
 *
 * Executes one journey. The model is not consulted after every click: it sets
 * strategy, and a deterministic executor performs the safe mechanical sequence
 * between meaningful state transitions. That keeps latency, cost, and the
 * number of ways a run can go wrong down.
 *
 * The sequence here is intentionally conservative. It navigates to the entry
 * path, fills any form the journey needs with synthetic data, activates the
 * control whose accessible name best matches the journey, and records what the
 * application did. Interaction is name- and role-based rather than
 * coordinate-based, so it survives layout changes.
 */
import type { Budget } from '../domain/budget'
import type {
  ActionResult,
  BrowserExecutor,
  PageElement,
  PageObservation,
} from '../execution/types'
import type { FailureSignal } from '../domain/analysis'
import type { DiscoveredJourney } from '../contracts'
import { detectAuthWall } from './authenticator'

export type OperatorStep = {
  sequence: number
  action: string
  target: string | null
  expected: string
  actual: string
  status: 'passed' | 'failed' | 'skipped'
}

/**
 * What a journey did.
 *
 * `skipped` exists because "we could not attempt this" is not "this works".
 * Collapsing the two into a boolean is how a run in which nothing was actually
 * exercised ends up reporting "no failures detected", which is the most
 * expensive kind of wrong answer this product can give.
 */
export type JourneyOutcome = 'passed' | 'failed' | 'skipped'

export type JourneyRun = {
  outcome: JourneyOutcome
  steps: OperatorStep[]
  trace: string[]
  signal: FailureSignal
  finalObservation: PageObservation | null
}

/** Synthetic values. Never real credentials, never production data. */
function syntheticValue(element: PageElement): string {
  const hint = `${element.name} ${element.inputType ?? ''}`.toLowerCase()
  if (element.inputType === 'email' || hint.includes('email')) {
    return 'forge-verifier@example.com'
  }
  if (element.inputType === 'password' || hint.includes('password')) {
    return 'ForgeVerify!2024'
  }
  if (element.inputType === 'tel' || hint.includes('phone')) return '4155550188'
  if (element.inputType === 'number' || hint.includes('quantity')) return '2'
  if (element.inputType === 'url') return 'https://example.com'
  if (hint.includes('coupon') || hint.includes('promo')) return 'FORGE10'
  if (hint.includes('search') || hint.includes('query')) return 'test'
  if (hint.includes('name')) return 'Nadia Okonjo'
  return 'Forge verification'
}

/**
 * Scores how well an element matches what this journey is trying to do.
 *
 * Buttons outrank links heavily. A page that contains a form almost always
 * also contains a navigation link with the same words in it, and following
 * that link looks like success while testing nothing.
 */
function scoreElement(
  element: PageElement,
  journey: DiscoveredJourney,
  currentUrl: string,
): number {
  const haystack = element.name.toLowerCase()
  const needles = `${journey.name} ${journey.goal}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3)

  let score = 0
  for (const needle of needles) {
    if (haystack.includes(needle)) score += 2
  }
  if (score === 0) return 0

  if (element.role === 'button') {
    score += 6
  } else if (element.href) {
    // A link back to the page we are already on cannot advance the journey.
    try {
      const target = new URL(element.href, currentUrl)
      const here = new URL(currentUrl)
      if (target.pathname === here.pathname) return 0
    } catch {
      return 0
    }
  }

  return score
}

export async function runJourney(
  executor: BrowserExecutor,
  baseUrl: string,
  journey: DiscoveredJourney,
  budget: Budget,
): Promise<JourneyRun> {
  const steps: OperatorStep[] = []
  const trace: string[] = []
  const signal: FailureSignal = { consoleErrors: [], networkErrors: [] }
  let sequence = 0
  let finalObservation: PageObservation | null = null

  const record = (
    action: string,
    target: string | null,
    expected: string,
    result: ActionResult,
  ) => {
    finalObservation = result.observation
    steps.push({
      sequence: ++sequence,
      action,
      target,
      expected,
      actual: result.detail,
      status: result.ok ? 'passed' : 'failed',
    })
    trace.push(`${action}${target ? ` "${target}"` : ''} -> ${result.detail}`)

    signal.status = result.observation.status || signal.status
    if (result.observation.transportError) signal.transportError = true
    // A login form on a page the journey did not navigate to means the app
    // moved us to a wall. Without this a 200 redirect to /login is invisible
    // and gets reported as an application defect.
    if (detectAuthWall(result.observation, journey)) {
      signal.authWall = true
    }
    for (const error of result.observation.consoleErrors) {
      if (!signal.consoleErrors.includes(error)) signal.consoleErrors.push(error)
    }
    for (const error of result.observation.networkErrors) {
      signal.networkErrors ??= []
      if (!signal.networkErrors.includes(error)) signal.networkErrors.push(error)
    }
    return result.ok
  }

  const entryUrl = new URL(journey.entryPath || '/', baseUrl).toString()

  budget.spend('browserActions')
  const opened = await executor.navigate(entryUrl)
  if (!record('Navigate', journey.entryPath, 'Page loads without an error status', opened)) {
    return { outcome: 'failed', steps, trace, signal, finalObservation }
  }

  // Fill every visible field before activating anything: a form submitted with
  // empty required fields tests the validation, not the journey.
  const fields = opened.observation.elements.filter(
    (e) => e.role === 'input' || e.role === 'textarea',
  )
  for (const field of fields.slice(0, 8)) {
    if (!budget.canSpend('browserActions')) break
    budget.spend('browserActions')
    const value = syntheticValue(field)
    const filled = await executor.fill(field.ref, value)
    record('Fill', field.name, `Field accepts "${value}"`, filled)
  }

  const observation = finalObservation ?? opened.observation
  const ranked = observation.elements
    .filter((e) => e.role === 'button' || e.role === 'link')
    .map((element) => ({
      element,
      score: scoreElement(element, journey, observation.url),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)

  // Once fields have been filled, the journey is about submitting them. Falling
  // back to a link here would abandon the input that was just entered.
  const primary =
    (fields.length > 0
      ? ranked.find((c) => c.element.role === 'button')?.element
      : undefined) ?? ranked[0]?.element

  if (!primary) {
    // Nothing on the page corresponds to this journey. That is normally a
    // discovery miss rather than an application defect, so the journey is
    // skipped - unless the reason nothing matched is that a sign-in form is
    // standing in front of it, which is a real result, not a miss.
    //
    // Skipped is not passed. Nothing was exercised here, and reporting it as a
    // pass is how a run against a page with no affordances announces that the
    // application works.
    const blocked = signal.authWall === true
    steps.push({
      sequence: ++sequence,
      action: 'Locate control',
      target: journey.name,
      expected: `A control matching "${journey.name}" is present`,
      actual: blocked
        ? 'A sign-in form is in the way: the application requires a login this run does not have.'
        : 'No matching control was found on the page.',
      status: blocked ? 'failed' : 'skipped',
    })
    trace.push(`Locate control "${journey.name}" -> ${blocked ? 'blocked by sign-in' : 'not found'}`)
    return {
      outcome: blocked ? 'failed' : 'skipped',
      steps,
      trace,
      signal,
      finalObservation,
    }
  }

  budget.spend('browserActions')
  const activated =
    fields.length > 0 && primary.role === 'button'
      ? await executor.submit(primary.ref)
      : await executor.click(primary.ref)

  const ok = record(
    fields.length > 0 && primary.role === 'button' ? 'Submit' : 'Click',
    primary.name,
    journey.goal,
    activated,
  )

  if (!ok) return { outcome: 'failed', steps, trace, signal, finalObservation }

  budget.spend('browserActions')
  const after = await executor.readPage()
  finalObservation = after

  // A journey that ended on a login form did not do what it set out to do,
  // whatever the status code says. Without this an unauthenticated run reports
  // "all journeys passed" for an application it never got inside.
  const walled = detectAuthWall(after, journey)
  if (walled) signal.authWall = true

  const brokeAfterwards =
    after.status >= 500 ||
    after.consoleErrors.length > 0 ||
    after.networkErrors.length > 0

  const failed = brokeAfterwards || walled

  steps.push({
    sequence: ++sequence,
    action: 'Verify',
    target: null,
    expected: 'No server or client errors after the action',
    actual: walled
      ? 'Ended on a sign-in form: the application requires a login this run does not have.'
      : brokeAfterwards
        ? `Errors after the action: ${[...after.networkErrors, ...after.consoleErrors]
            .slice(0, 3)
            .join('; ')}`
        : `Settled on ${new URL(after.url).pathname} with status ${after.status}`,
    status: failed ? 'failed' : 'passed',
  })

  if (brokeAfterwards) {
    signal.status = after.status || signal.status
    for (const error of after.consoleErrors) {
      if (!signal.consoleErrors.includes(error)) signal.consoleErrors.push(error)
    }
    signal.networkErrors ??= []
    for (const error of after.networkErrors) {
      if (!signal.networkErrors.includes(error)) signal.networkErrors.push(error)
    }
  }

  return {
    outcome: failed ? 'failed' : 'passed',
    steps,
    trace,
    signal,
    finalObservation,
  }
}
