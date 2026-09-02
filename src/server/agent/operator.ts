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
import { detectAuthWall, looksLikeLoginPage } from './authenticator'
import { isAuthJourney } from '../domain/analysis'

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

/**
 * A date the application is likely to accept.
 *
 * Two weeks out rather than today, because a form asking for a date usually
 * wants one that has not happened yet - today is often the first thing a
 * picker disables - and a date far enough ahead is still a plausible one.
 */
function syntheticDate(offsetDays = 14): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

/**
 * A value the project says is true of its own application.
 *
 * Invented data is right up until the application checks it against itself: a
 * referral form that looks a patient up by phone number will never find one
 * for a number Forge made up, and the journey stops at a submit button that
 * will not enable. These are the values somebody who knows the application
 * supplied so that it can.
 */
export type SampleValue = { label: string; value: string }

/**
 * The sample value for a field, if the project supplied one.
 *
 * Every word of the label has to appear in the field, so "Phone number"
 * answers a field called "Phone number" or "Patient phone number" and not one
 * called "Number of copies". The most specific label wins, which is how a
 * project can give a general "Phone" and a particular "Referring phone" and
 * have each land where it belongs.
 */
export function matchSampleValue(
  element: PageElement,
  samples: readonly SampleValue[],
): string | null {
  if (samples.length === 0) return null

  const field = new Set(
    `${element.name} ${element.inputType ?? ''}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(normaliseWord),
  )
  if (field.size === 0) return null

  let best: { value: string; words: number } | null = null
  for (const sample of samples) {
    const words = sample.label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(normaliseWord)

    if (words.length === 0) continue
    if (!words.every((word) => field.has(word))) continue
    if (!best || words.length > best.words) {
      best = { value: sample.value, words: words.length }
    }
  }

  return best?.value ?? null
}

/** Synthetic values. Never real credentials, never production data. */
function syntheticValue(element: PageElement): string {
  const hint = `${element.name} ${element.inputType ?? ''}`.toLowerCase()
  /*
   * Typed fields first, and dates before anything else.
   *
   * A date input given prose keeps nothing at all: the browser rejects the
   * value, the page reports no error, and the run carries on believing it
   * filled a field that is still empty - which is how a form ends up sitting
   * behind a submit button the application will not enable.
   */
  if (element.inputType === 'date') return syntheticDate()
  if (element.inputType === 'datetime-local') return `${syntheticDate()}T10:30`
  if (element.inputType === 'month') return syntheticDate().slice(0, 7)
  if (element.inputType === 'time') return '10:30'
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
  // An untyped field that says it wants a date still wants a date.
  if (hint.includes('date')) return syntheticDate()
  if (hint.includes('name')) return 'Nadia Okonjo'
  return 'Forge verification'
}

/** An element's identity for comparison across observations, since refs are not. */
function elementKey(element: PageElement): string {
  return `${element.role}:${element.name.toLowerCase().replace(/\s+/g, ' ').trim()}`
}

/** Whether a control is holding anything. Unknown values count as empty. */
function looksEmpty(element: PageElement, filled: Set<string>): boolean {
  if (element.role === 'checkbox') return element.checked !== true
  if (typeof element.value === 'string') return element.value.trim() === ''
  return !filled.has(element.ref)
}

/**
 * The first option in a `select` that means something.
 *
 * The leading option of a select is usually the instruction to pick one, and
 * choosing it is the same as choosing nothing.
 */
const PLACEHOLDER_OPTION = /^(-+|\u2014|select|choose|pick|please|none|any)\b/i

function firstRealOption(element: PageElement): string | null {
  return (
    element.options?.find(
      (option) => option.trim() !== '' && !PLACEHOLDER_OPTION.test(option.trim()),
    ) ?? null
  )
}

/** Checkboxes a form is likely to be waiting on, beyond the ones marked required. */
const CONSENT_WORDS = /\b(agree|accept|consent|terms|policy|confirm|acknowledge|understand)\b/i

/**
 * Scores how well an element matches what this journey is trying to do.
 *
 * Buttons outrank links heavily. A page that contains a form almost always
 * also contains a navigation link with the same words in it, and following
 * that link looks like success while testing nothing.
 */
/**
 * Trims a plural so a journey and a control can be about the same thing.
 *
 * Whole-word matching stopped "Refer a patient" from clicking a chip reading
 * "Referring doctor", and then went too far the other way: a journey to add a
 * referral could not match the "Referrals" link that leads to it, so it never
 * left the page it started on. Both sides are normalised the same way, so
 * trimming more than a grammarian would is harmless - "address" and
 * "addresses" both become "addres", and they still match each other.
 */
function normaliseWord(word: string): string {
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

function scoreElement(
  element: PageElement,
  journey: DiscoveredJourney,
  currentUrl: string,
): number {
  /*
   * Whole words only, against a name with its whitespace collapsed.
   *
   * Substring matching is how "Refer a patient" comes to click a profile chip
   * reading "Joey Benson, Referring doctor": "refer" is inside "referring", the
   * chip is the only thing that matched, and the journey reports a pass for
   * having opened a menu. An accessible name also arrives with the newlines of
   * whatever markup produced it, so it is flattened before matching.
   */
  // A control the page will not accept cannot advance a journey.
  if (element.disabled) return 0

  const haystack = element.name.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!haystack) return 0

  const words = new Set(
    haystack.split(/[^a-z0-9]+/).filter(Boolean).map(normaliseWord),
  )
  const needles = `${journey.name} ${journey.goal}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3)
    .map(normaliseWord)

  let matched = 0
  for (const needle of needles) {
    if (words.has(needle)) matched++
  }
  if (matched === 0) return 0

  /*
   * The control has to be mostly about this journey, not merely mention it.
   *
   * Counting shared words alone picks the wrong control on a real application:
   * a journey to view referrals shares "referring" and "doctor" with a profile
   * chip reading "JB / Joey Benson / Referring doctor", so the journey clicks
   * an account menu and reports a pass. Coverage is the discriminator - how
   * much of the control's own label the journey accounts for. The chip scores
   * two words out of five; "Referrals" and "Toggle Sidebar" score everything
   * they have.
   */
  const coverage = matched / words.size
  if (coverage < 0.5) return 0

  let score = matched * 2

  /*
   * Prefer the control that is mostly about this journey. A short exact label
   * beats a long one that happens to contain the same word, which is usually
   * navigation or account chrome rather than the thing under test.
   */
  if (words.size <= 4) score += 2

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

/**
 * Labels that submit a form, and labels that must never be pressed to do it.
 *
 * Once a journey has filled a form, submitting it is the next step whatever the
 * button is called - "Save" shares no words with "Add referral", and waiting
 * for a label that matches the journey is how a run fills three fields and then
 * reports a pass for having reached the form. The destructive list is the
 * counterweight: a form's buttons include the ones that throw the work away,
 * and pressing those instead is worse than not submitting at all.
 */
const SUBMIT_WORDS =
  /\b(save|submit|create|add|send|confirm|continue|finish|done|apply|update|post|book|place|pay|invite|register|sign\s?up)\b/i

const DESTRUCTIVE_WORDS =
  /\b(delete|remove|discard|cancel|reset|clear|revoke|archive|sign\s?out|log\s?out|back)\b/i

/**
 * The control that submits the form in front of us.
 *
 * Deliberately narrow: a button, on the vocabulary list, not on the
 * destructive list, and not already used. Anything it cannot identify is left
 * alone rather than guessed at.
 */
export function findSubmitControl(
  elements: PageElement[],
  used: Set<string> = new Set(),
): PageElement | null {
  return (
    elements.find(
      (element) =>
        element.role === 'button' &&
        !element.disabled &&
        !used.has(element.ref) &&
        SUBMIT_WORDS.test(element.name) &&
        !DESTRUCTIVE_WORDS.test(element.name),
    ) ?? null
  )
}

/**
 * The submit control the page is refusing to enable.
 *
 * Looked for only once nothing usable was found, because it turns "this
 * application offers no way to submit the form" into what is actually true:
 * the form was not accepted as complete, and here is the button that says so.
 */
export function findDisabledSubmitControl(
  elements: PageElement[],
): PageElement | null {
  return (
    elements.find(
      (element) =>
        element.role === 'button' &&
        element.disabled === true &&
        SUBMIT_WORDS.test(element.name) &&
        !DESTRUCTIVE_WORDS.test(element.name),
    ) ?? null
  )
}

/**
 * Controls a form has to be walked through before it will accept a submit.
 *
 * These are the ones that are neither a field nor the submit: the trigger that
 * opens a date picker, the lookup that resolves a patient from a phone number,
 * the button that opens a listbox. A journey that only fills inputs and then
 * presses submit cannot complete a form built from any of them - which is
 * precisely the form most applications now ship.
 *
 * Deliberately not `add`, `new`, `open` or `edit`: those overlap with the
 * vocabulary of leaving the page, and pressing one abandons the form.
 */
const PREREQUISITE_WORDS =
  /\b(pick|choose|select|calendar|date|time|schedule|find|search|lookup|browse|upload|attach|month|year)\b|\b(mm|dd|yyyy)\b/i

/**
 * The next control that might satisfy what the form is waiting for.
 *
 * Looked for only when the application has disabled its own submit button, so
 * this never goes pressing things on a form that was already complete. The
 * submit and destructive vocabularies are excluded for the usual reason: one
 * of them is not a prerequisite, and the other throws the work away.
 */
export function findPrerequisiteControl(
  elements: PageElement[],
  used: Set<string> = new Set(),
): PageElement | null {
  return (
    elements.find(
      (element) =>
        element.role === 'button' &&
        !element.disabled &&
        !used.has(elementKey(element)) &&
        PREREQUISITE_WORDS.test(element.name) &&
        !SUBMIT_WORDS.test(element.name) &&
        !DESTRUCTIVE_WORDS.test(element.name),
    ) ?? null
  )
}

/**
 * What appeared on the page that was not there before.
 *
 * Refs are handed out fresh on every observation, so they cannot be compared
 * across two of them; role and name can. Counted rather than set-matched, so a
 * calendar that adds a second "15" is seen to have added one.
 */
export function revealedElements(
  before: PageObservation,
  after: PageObservation,
): PageElement[] {
  const seen = new Map<string, number>()
  for (const element of before.elements) {
    const key = elementKey(element)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  const revealed: PageElement[] = []
  for (const element of after.elements) {
    const key = elementKey(element)
    const remaining = seen.get(key) ?? 0
    if (remaining > 0) seen.set(key, remaining - 1)
    else revealed.push(element)
  }
  return revealed
}

const DAY_NUMBER = /^\d{1,2}$/
const MONTH_NAME =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i

/** Whether a control reads like one cell of a date grid. */
function looksLikeDayCell(element: PageElement): boolean {
  if (element.role !== 'button' && element.role !== 'option') return false
  const name = element.name.trim()
  return DAY_NUMBER.test(name) || (MONTH_NAME.test(name) && /\d/.test(name))
}

/**
 * What to press in whatever just opened.
 *
 * A calendar is recognised as a grid rather than as a button that happens to
 * be named "8", and the cell chosen is the first enabled one after today,
 * because a date in the past is not what a form asking for one wants. A
 * listbox is answered with its first enabled option. Anything else is left
 * alone: pressing an unrecognised control inside an overlay is how a journey
 * ends up somewhere it cannot explain.
 */
export function chooseRevealed(revealed: PageElement[]): PageElement | null {
  const grid = revealed.filter(looksLikeDayCell)
  if (grid.length >= 7) {
    const today = grid.findIndex((element) => element.current)
    const usable = grid.filter((element) => !element.disabled)
    const ahead = usable.filter((element) => grid.indexOf(element) > today)
    return ahead[0] ?? usable[0] ?? null
  }

  const options = revealed.filter(
    (element) => element.role === 'option' && !element.disabled,
  )
  return options[0] ?? null
}

/**
 * How many actions one journey may take.
 *
 * A real journey is a handful of steps - open the list, start the new one,
 * fill it, satisfy what it is waiting on, submit it - and anything much longer
 * is a loop rather than a journey. The cap bounds the browser budget one
 * journey can consume, so a single wandering journey cannot starve the rest of
 * the run.
 */
const MAX_STEPS = 8

/**
 * How many prerequisites one journey may work through.
 *
 * Each one costs up to three browser actions, and a form still refusing to
 * enable its submit after three of them is telling us something the next click
 * will not fix.
 */
const MAX_PREREQUISITES = 3

/** A page's identity for the purpose of noticing that nothing happened. */
function fingerprint(observation: PageObservation): string {
  return [
    observation.url,
    observation.title,
    observation.elements.length,
    observation.elements
      .slice(0, 12)
      .map((e) => e.name)
      .join('|'),
  ].join('::')
}

/**
 * Executes one journey.
 *
 * A journey is a sequence, not a click. "Add a referral" means open the
 * referrals page, start a new one, fill the form, submit it, and see what came
 * back - and a single action stops at whichever of those comes first, then
 * reports a pass for having got there. So this walks the application until the
 * page stops changing, nothing matches any more, or the step budget runs out.
 *
 * The model is not consulted between steps. It sets strategy in the Explorer
 * and judges evidence in the Judge; in between, a deterministic loop drives the
 * browser. That keeps a finding's baseline defensible without a model, keeps
 * the cost of a journey to its browser actions, and keeps the number of ways a
 * run can go wrong small.
 */
export async function runJourney(
  executor: BrowserExecutor,
  baseUrl: string,
  journey: DiscoveredJourney,
  budget: Budget,
  options: { authenticated?: boolean; sampleValues?: readonly SampleValue[] } = {},
): Promise<JourneyRun> {
  const authenticated = options.authenticated ?? false
  const sampleValues = options.sampleValues ?? []
  const steps: OperatorStep[] = []
  const trace: string[] = []
  const signal: FailureSignal = { consoleErrors: [], networkErrors: [] }
  let sequence = 0
  let finalObservation: PageObservation | null = null

  /** Controls already activated, so a journey cannot click its way in circles. */
  const usedRefs = new Set<string>()
  /** Fields already filled, so a re-rendered form is not typed into twice. */
  const filledRefs = new Set<string>()
  /** Fields that would not take what we offered, so they are not retried. */
  const refusedFields = new Set<string>()
  /** Prerequisite controls already worked through, by name rather than by ref. */
  const usedHelpers = new Set<string>()
  /** Their labels, for the report: what a reader needs to see was attempted. */
  const helpersTried: string[] = []
  /** Whether anything was actually activated. Nothing activated is not a pass. */
  let activated = false
  /** Whether a form was submitted. The strongest evidence a journey happened. */
  let submitted = false
  /** Whether this journey has put anything into a form at all. */
  let touchedForm = false
  /** How many prerequisites have been worked through. */
  let prerequisites = 0

  const note = (
    action: string,
    target: string | null,
    expected: string,
    actual: string,
    status: OperatorStep['status'],
  ) => {
    steps.push({ sequence: ++sequence, action, target, expected, actual, status })
    trace.push(`${action}${target ? ` "${target}"` : ''} -> ${actual}`)
  }

  /*
   * `whenNotOk` exists for the actions where a refusal is not the
   * application's fault. A field that would not take the value we invented for
   * it is a limit of this agent, not a defect, and recording it as a failed
   * step puts a bug in front of a reader that nobody can act on.
   */
  const record = (
    action: string,
    target: string | null,
    expected: string,
    result: ActionResult,
    whenNotOk: OperatorStep['status'] = 'failed',
  ) => {
    finalObservation = result.observation
    note(action, target, expected, result.detail, result.ok ? 'passed' : whenNotOk)

    signal.status = result.observation.status || signal.status
    if (result.observation.transportError) signal.transportError = true

    if (authenticated && looksLikeLoginPage(result.observation)) {
      // Signed in, and the application is asking again.
      signal.staleAuth = true
    } else if (detectAuthWall(result.observation, journey)) {
      // A login form on a page the journey did not navigate to means the app
      // moved us to a wall. Without this a 200 redirect to /login is invisible
      // and gets reported as an application defect.
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

  const done = (outcome: JourneyOutcome): JourneyRun => ({
    outcome,
    steps,
    trace,
    signal,
    finalObservation,
  })

  /* ----------------------------------------------------------------- open */

  const entryUrl = new URL(journey.entryPath || '/', baseUrl).toString()

  budget.spend('browserActions')
  const opened = await executor.navigate(entryUrl)
  if (!record('Navigate', journey.entryPath, 'Page loads without an error status', opened)) {
    return done('failed')
  }

  let observation = opened.observation

  /* --------------------------------------------------------- prerequisites */

  /**
   * Works through one thing the form is waiting for.
   *
   * This is the step a name-matching walk cannot take. A date sits behind a
   * button reading "Pick a date", which shares no words with the journey and
   * is not a submit; pressing it opens a grid of day cells named "1", "2",
   * "3", which share no words with anything at all. Neither is reachable by
   * scoring labels against the journey, so both are found structurally: the
   * application disabled its own submit button, something on the page is
   * shaped like the way to satisfy it, and whatever that opens is answered on
   * its own terms.
   *
   * Only ever entered from a disabled submit, so a form the application is
   * already willing to accept is never poked at.
   */
  const satisfyPrerequisite = async (): Promise<
    'advanced' | 'unavailable' | 'broke'
  > => {
    if (prerequisites >= MAX_PREREQUISITES) return 'unavailable'
    // Three actions: open it, choose in it, and read the page back.
    if (!budget.canSpend('browserActions', 3)) return 'unavailable'

    const helper = findPrerequisiteControl(observation.elements, usedHelpers)
    if (!helper) return 'unavailable'

    prerequisites++
    usedHelpers.add(elementKey(helper))
    helpersTried.push(helper.name.replace(/\s+/g, ' ').trim())
    usedRefs.add(helper.ref)

    const before = observation
    budget.spend('browserActions')
    const opening = await executor.click(helper.ref)

    /*
     * A control this executor cannot operate is not a broken application.
     *
     * The fetch executor cannot activate anything that only does something
     * through JavaScript, and a date picker is exactly that. Calling its
     * refusal a failure would report a defect against every form built this
     * way, on every run without a browser. Only what the application itself
     * did wrong - a server error, an error on the console - fails the journey.
     */
    const broke =
      opening.observation.status >= 500 ||
      opening.observation.consoleErrors.length > 0 ||
      opening.observation.networkErrors.length > 0

    record(
      'Open',
      helper.name,
      'The control the form is waiting on opens',
      opening,
      broke ? 'failed' : 'skipped',
    )
    if (broke) return 'broke'
    if (!opening.ok) return 'unavailable'

    activated = true
    observation = opening.observation

    const revealed = revealedElements(before, observation)
    const choice = chooseRevealed(revealed)

    if (!choice) {
      /*
       * Nothing in there this journey knows how to answer. If what opened was
       * an overlay of choices, it is dismissed rather than left sitting over
       * the form - one the run cannot use is still one the submit button is
       * underneath. A control that merely revealed another field opened
       * nothing, and pressing Escape at it would be a wasted action at best.
       */
      const overlay = revealed.filter(
        (e) => e.role === 'button' || e.role === 'option',
      ).length
      if (overlay >= 3 && budget.canSpend('browserActions')) {
        budget.spend('browserActions')
        const dismissed = await executor.pressKey('Escape')
        if (dismissed.ok) observation = dismissed.observation
      }
      // The press itself may have been the point - a lookup, a search - so
      // this still counts as progress worth re-checking the form against.
      return 'advanced'
    }

    budget.spend('browserActions')
    const chosen = await executor.click(choice.ref)
    const choiceBroke =
      chosen.observation.status >= 500 ||
      chosen.observation.consoleErrors.length > 0 ||
      chosen.observation.networkErrors.length > 0

    record(
      'Choose',
      choice.name,
      `"${helper.name}" accepts a choice`,
      chosen,
      choiceBroke ? 'failed' : 'skipped',
    )
    if (choiceBroke) return 'broke'

    observation = chosen.observation
    return 'advanced'
  }

  /* ----------------------------------------------------------------- walk */

  for (let step = 0; step < MAX_STEPS; step++) {
    /*
     * A login form is not a form to fill with synthetic data.
     *
     * Typing invented credentials into one achieves nothing at best. At worst
     * it signs the run out of the session the authenticator established, or
     * trips the application's failed-attempt lockout on the very account the
     * operator of this project supplied. The credentials Forge holds belong to
     * the authenticator, which types them once, structurally, and never shows
     * them to the model - so the Operator's answer to a login form is to leave
     * it alone and report what it found.
     *
     * The one case where filling is right is a journey whose whole point is to
     * authenticate - a sign-up flow - on a run that is not already signed in.
     */
    const isLoginForm = looksLikeLoginPage(observation)
    const mayFillLoginForm =
      !authenticated && isAuthJourney(journey.name, journey.goal)

    if (isLoginForm && !mayFillLoginForm) {
      note(
        'Inspect form',
        journey.name,
        authenticated
          ? 'A signed-in visitor is not asked to sign in again'
          : `A control matching "${journey.name}" is present`,
        authenticated
          ? 'This page asked for credentials again even though the run is already signed in. The session did not carry, or the application serves its login page to signed-in users.'
          : 'A sign-in form is in the way: the application requires a login this run does not have.',
        'failed',
      )
      if (!authenticated) signal.authWall = true
      return done('failed')
    }

    /*
     * Fill before activating: a form submitted with empty required fields
     * tests the validation, not the journey.
     *
     * A control already holding something is left as it is. Overwriting it
     * would throw away whatever the application put there - the patient a
     * lookup just resolved, the date a picker just set - and typing over it is
     * how a journey undoes the step it took immediately before.
     */
    const fields = observation.elements.filter(
      (e) =>
        (e.role === 'input' || e.role === 'textarea') &&
        !e.disabled &&
        !filledRefs.has(e.ref) &&
        !refusedFields.has(elementKey(e)) &&
        looksEmpty(e, filledRefs),
    )

    for (const field of fields.slice(0, 8)) {
      if (!budget.canSpend('browserActions')) break
      budget.spend('browserActions')
      /*
       * What the project supplied beats what the agent can invent. A field
       * with no sample falls back to a synthetic value, so a project only has
       * to name the ones its application actually checks.
       */
      const value = matchSampleValue(field, sampleValues) ?? syntheticValue(field)
      const filled = await executor.fill(field.ref, value)
      touchedForm = true

      if (filled.ok) {
        filledRefs.add(field.ref)
        record('Fill', field.name, `Field accepts "${value}"`, filled)
      } else {
        /*
         * The field kept nothing. Remembered by name so the next iteration
         * does not spend the budget typing the same rejected value again, and
         * recorded as skipped rather than failed: what this proves is that the
         * agent had nothing this field would take.
         */
        refusedFields.add(elementKey(field))
        record('Fill', field.name, `Field accepts "${value}"`, filled, 'skipped')
      }
      if (filled.observation) observation = filled.observation
    }

    /* A select is a field too, and one no amount of typing can answer. */
    const selects = observation.elements.filter(
      (e) =>
        e.role === 'select' &&
        !e.disabled &&
        !filledRefs.has(e.ref) &&
        looksEmpty(e, filledRefs),
    )

    for (const select of selects.slice(0, 4)) {
      const option = firstRealOption(select)
      if (!option) continue
      if (!budget.canSpend('browserActions')) break
      budget.spend('browserActions')
      filledRefs.add(select.ref)
      touchedForm = true
      const chosen = await executor.selectOption(select.ref, option)
      record('Choose', select.name, `"${option}" can be chosen`, chosen, 'skipped')
      observation = chosen.observation
    }

    /*
     * The boxes a form will not submit without.
     *
     * Only the ones the page marks required or that read as consent - ticking
     * every checkbox on a page would change filters, toggle settings, and opt
     * a test account into things nobody asked for.
     */
    const consents = observation.elements.filter(
      (e) =>
        e.role === 'checkbox' &&
        !e.disabled &&
        e.checked !== true &&
        !filledRefs.has(e.ref) &&
        (e.required === true || CONSENT_WORDS.test(e.name)),
    )

    for (const box of consents.slice(0, 4)) {
      if (!budget.canSpend('browserActions')) break
      budget.spend('browserActions')
      filledRefs.add(box.ref)
      touchedForm = true
      const ticked = await executor.check(box.ref)
      record('Tick', box.name, `"${box.name}" can be turned on`, ticked, 'skipped')
      observation = ticked.observation
    }

    /*
     * Whether this page is a form. Decided from the page rather than from what
     * was filled this iteration, because a form can persist across a step -
     * and `submit` looks for a form to submit and fails when there is none, so
     * it must not be used on a page that has no fields at all.
     */
    const onForm = observation.elements.some(
      (e) => e.role === 'input' || e.role === 'textarea' || e.role === 'select',
    )

    const ranked = observation.elements
      .filter(
        (e) =>
          (e.role === 'button' || e.role === 'link') && !usedRefs.has(e.ref),
      )
      .map((element) => ({
        element,
        score: scoreElement(element, journey, observation.url),
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)

    /*
     * Once a form has been touched the journey is about submitting it.
     *
     * A button that matches the journey wins first; failing that, the button
     * that submits the form, whatever it is called. Falling back to a link at
     * this point would abandon the input that was just entered.
     *
     * The test is the whole journey's, not this iteration's: after opening a
     * date picker and choosing a day, nothing new gets filled, and a run that
     * asked only "did I just fill something" would go back to ranking links
     * and follow the navigation out of the form it had finally completed.
     */
    const formPending = onForm && touchedForm && !submitted
    const primary = formPending
      ? /*
         * No link fallback here, deliberately.
         *
         * A form page's best-scoring element is often the navigation link back
         * to the list the form belongs to - "Referrals" for a referral form -
         * and following it abandons everything just typed and leaves the
         * journey somewhere else entirely, still calling itself done. A filled
         * form is either submitted or it is stopped at.
         */
        (ranked.find((c) => c.element.role === 'button')?.element ??
        findSubmitControl(observation.elements, usedRefs))
      : ranked[0]?.element

    if (!primary) {
      /*
       * A form was filled and there is nothing here that submits it.
       *
       * Recorded by name rather than passed over, because this is the exact
       * point where a journey stops short of the thing it was about, and the
       * buttons it did see are what a reader needs to tell a missing submit
       * control from one this rule failed to recognise.
       */
      /*
       * Only while a form is still outstanding. Once it has been submitted the
       * journey has moved on, and the page it landed on is not a form report.
       */
      if (touchedForm && !submitted) {
        /*
         * A disabled submit is a different answer from a missing one. The
         * application rendered the way to finish and refused to enable it,
         * which usually means a required field this run did not fill, or one
         * it filled with something the form rejected. Either way that is a
         * result about the application rather than a shrug about the page.
         */
        const blocked = findDisabledSubmitControl(observation.elements)
        if (blocked) {
          /*
           * Before reporting it, try to satisfy it. A disabled submit is the
           * application saying what is missing, and the date picker or lookup
           * that supplies it is usually right there on the form.
           */
          const attempt = await satisfyPrerequisite()
          if (attempt === 'broke') return done('failed')
          if (attempt === 'advanced') continue

          /*
           * Read from the page rather than from what this run remembers
           * typing. A field the agent filled with something the form threw
           * away is empty, whatever the agent's own bookkeeping says.
           */
          const unfilled = observation.elements
            .filter((e) => e.required && looksEmpty(e, filledRefs))
            .map((e) => e.name.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 5)

          note(
            'Submit form',
            journey.name,
            'The filled form can be submitted',
            `The form was filled, but "${blocked.name}" is disabled, so the application does not consider it complete.${
              unfilled.length > 0
                ? ` Required and not filled: ${unfilled.join(', ')}.`
                : ''
            }${
              helpersTried.length > 0
                ? ` Worked through: ${helpersTried.join(', ')}.`
                : ''
            }`,
            'skipped',
          )
          return done('skipped')
        }

        const buttons = observation.elements
          .filter((e) => e.role === 'button')
          .map((e) => e.name.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 6)

        note(
          'Submit form',
          journey.name,
          'A control that submits the form is present',
          buttons.length > 0
            ? `The form was filled, but none of these looked like a way to submit it: ${buttons.join(', ')}.`
            : 'The form was filled, but the page offered no button to submit it.',
          'skipped',
        )
        return done('skipped')
      }

      /*
       * Nothing left on this page corresponds to the journey. If the journey
       * has already done something, that is where it ends - it walked as far
       * as the application goes. If it has done nothing at all, it was never
       * attempted, and saying so is the whole point of the skipped outcome.
       */
      if (activated) break

      const blocked = signal.authWall === true
      note(
        'Locate control',
        journey.name,
        `A control matching "${journey.name}" is present`,
        blocked
          ? 'A sign-in form is in the way: the application requires a login this run does not have.'
          : 'No matching control was found on the page.',
        blocked ? 'failed' : 'skipped',
      )
      return done(blocked ? 'failed' : 'skipped')
    }

    if (!budget.canSpend('browserActions', 2)) {
      note(
        'Continue journey',
        primary.name,
        'Budget remains for the next step',
        'The run budget ran out before this journey finished.',
        'skipped',
      )
      break
    }

    const asSubmit = onForm && primary.role === 'button'
    usedRefs.add(primary.ref)

    budget.spend('browserActions')
    const activation = asSubmit
      ? await executor.submit(primary.ref)
      : await executor.click(primary.ref)

    activated = true
    if (asSubmit) submitted = true

    if (!record(asSubmit ? 'Submit' : 'Click', primary.name, journey.goal, activation)) {
      return done('failed')
    }

    budget.spend('browserActions')
    const after = await executor.readPage()
    finalObservation = after

    /*
     * A journey that ended on a login form did not do what it set out to do,
     * whatever the status code says. Without this an unauthenticated run
     * reports "all journeys passed" for an application it never got inside.
     */
    const walled = detectAuthWall(after, journey)
    if (walled) signal.authWall = true
    if (authenticated && looksLikeLoginPage(after)) signal.staleAuth = true

    const broke =
      after.status >= 500 ||
      after.consoleErrors.length > 0 ||
      after.networkErrors.length > 0

    if (broke || walled || signal.staleAuth) {
      note(
        'Verify',
        null,
        'No server or client errors after the action',
        walled || signal.staleAuth
          ? 'Ended on a sign-in form: the application requires a login this run does not have.'
          : `Errors after the action: ${[...after.networkErrors, ...after.consoleErrors]
              .slice(0, 3)
              .join('; ')}`,
        'failed',
      )

      signal.status = after.status || signal.status
      for (const error of after.consoleErrors) {
        if (!signal.consoleErrors.includes(error)) signal.consoleErrors.push(error)
      }
      signal.networkErrors ??= []
      for (const error of after.networkErrors) {
        if (!signal.networkErrors.includes(error)) signal.networkErrors.push(error)
      }

      return done('failed')
    }

    const moved = fingerprint(after) !== fingerprint(observation)
    observation = after

    // The application did not react. Repeating the loop would pick the next
    // control and wander away from the journey, so this is where it stops.
    if (!moved) break
  }

  /* --------------------------------------------------------------- verdict */

  if (!activated) {
    note(
      'Locate control',
      journey.name,
      `A control matching "${journey.name}" is present`,
      'No matching control was found on the page.',
      'skipped',
    )
    return done('skipped')
  }

  /*
   * A form was filled and never submitted, so whatever the journey was about
   * did not happen. Calling that a pass is the same mistake as calling
   * "reached the form" a pass, one step further along.
   */
  if (touchedForm && !submitted) {
    note(
      'Submit form',
      journey.name,
      'The filled form is submitted',
      'The journey filled a form and ran out of steps before submitting it.',
      'skipped',
    )
    return done('skipped')
  }

  note(
    'Verify',
    null,
    'The journey completes without server or client errors',
    finalObservation
      ? `${submitted ? 'Submitted and settled' : 'Settled'} on ${pathOfUrl(finalObservation.url)} with status ${finalObservation.status}`
      : 'The journey completed.',
    'passed',
  )

  return done('passed')
}

/** The path of a URL, for a step description. Falls back to the whole string. */
function pathOfUrl(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
