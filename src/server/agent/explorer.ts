/**
 * Explorer agent.
 *
 * Turns an entry-page observation into a ranked set of journeys. Model output
 * is schema-validated and then re-ranked by `rankJourneys`, so a confident but
 * wrong model cannot spend the whole run budget on a settings page. When no
 * model is reachable, the heuristic path below still produces useful journeys
 * from the page's own affordances.
 */
import {
  discoveredJourneySchema,
  explorerOutputSchema,
  type DiscoveredJourney,
} from '../contracts'
import { rankJourneys } from '../domain/analysis'
import type { PageObservation } from '../execution/types'
import { EXPLORER_SYSTEM } from './prompts'
import { extractJson } from './json'
import type { ModelProvider } from './provider'

/**
 * Why discovery fell back to heuristics.
 *
 * Recorded because the fallback is close to useless on an application whose
 * controls do not happen to use the words the heuristics know, and a run that
 * quietly produces one journey called "Load the entry page" looks like a thin
 * application rather than an unreachable model. The run timeline now says
 * which it was.
 */
export type HeuristicReason =
  | 'no_model_configured'
  | 'model_call_failed'
  | 'model_output_invalid'
  | 'model_returned_nothing'

export const HEURISTIC_REASON_TEXT: Record<HeuristicReason, string> = {
  no_model_configured: 'no model is reachable',
  model_call_failed: 'the model call failed',
  model_output_invalid: 'the model returned output that did not validate',
  model_returned_nothing: 'the model proposed no journeys',
}

export type ExplorationResult = {
  journeys: DiscoveredJourney[]
  source: 'model' | 'heuristic'
  model: string | null
  /** Set only when `source` is `heuristic`. */
  reason?: HeuristicReason
}

/** The path part of a page's URL, always absolute, never with a trailing slash. */
export function currentPath(observation: PageObservation): string {
  try {
    const path = new URL(observation.url).pathname
    return path.length > 1 ? path.replace(/\/+$/, '') : '/'
  } catch {
    return '/'
  }
}

/**
 * Every path the page links to, deduplicated and in document order.
 *
 * Only http and https links count. `javascript:void(0)` and `mailto:` parse
 * happily and yield a pathname - "void(0)" in the first case - which would then
 * be offered to the model as somewhere it could send a journey.
 */
export function offeredPaths(observation: PageObservation): string[] {
  const paths = new Set<string>()
  for (const element of observation.elements) {
    if (!element.href) continue
    try {
      const url = new URL(element.href, observation.url)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      const path = url.pathname
      paths.add(path.length > 1 ? path.replace(/\/+$/, '') : '/')
    } catch {
      // A malformed href offers nothing.
    }
  }
  return [...paths]
}

/**
 * Pins each journey to a page that exists.
 *
 * A journey is derived from the elements of one page, so it belongs on that
 * page unless it names somewhere that page links to. Anything else is a guess,
 * and a guess is either a 404 Forge would go on to blame the application for,
 * or a 200 on an unrelated page where no control matches and the journey is
 * skipped. Both waste the run; the second is what a tenant-scoped application
 * does to a model that proposed `/dashboard`.
 */
export function anchorJourneys(
  journeys: readonly DiscoveredJourney[],
  observation: PageObservation,
): DiscoveredJourney[] {
  const here = currentPath(observation)
  const offered = new Set(offeredPaths(observation))
  offered.add(here)

  return journeys.map((journey) => {
    const proposed = journey.entryPath?.trim()
    if (!proposed) return { ...journey, entryPath: here }

    const normalised = proposed.startsWith('/') ? proposed : `/${proposed}`
    const withoutSlash =
      normalised.length > 1 ? normalised.replace(/\/+$/, '') : '/'

    if (offered.has(withoutSlash)) return { ...journey, entryPath: withoutSlash }

    /*
     * A path nothing pointed at. Preferring the page in front of us over the
     * model's guess is the conservative choice: the controls it reasoned about
     * are here.
     */
    return { ...journey, entryPath: here }
  })
}

export async function discoverJourneys(
  provider: ModelProvider,
  observation: PageObservation,
  goal: string | null,
  limit: number,
  options: { authenticated?: boolean } = {},
): Promise<ExplorationResult> {
  const heuristic = heuristicJourneys(observation, goal)
  const rank = (journeys: readonly DiscoveredJourney[]) =>
    rankJourneys(anchorJourneys(journeys, observation), limit, options)
  const fallback = (reason: HeuristicReason): ExplorationResult => ({
    journeys: rank(heuristic),
    source: 'heuristic',
    model: null,
    reason,
  })

  if (!provider.available) {
    console.debug('[explorer] Provider not available, using heuristic-only discovery')
    return fallback('no_model_configured')
  }

  try {
    console.debug(`[explorer] Calling model for discovery at ${observation.url}`)
    const output = await provider.generate({
      task: 'discovery',
      system: EXPLORER_SYSTEM,
      user: describe(observation, goal, options.authenticated ?? false),
      maxTokens: 700,
    })

    console.debug(`[explorer] Model returned ${output.text.length} chars, attempting parse`)
    const parsed = explorerOutputSchema.safeParse(extractJson(output.text))
    
    if (!parsed.success) {
      console.debug(`[explorer] Schema validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}`)
      return fallback('model_output_invalid')
    }

    if (parsed.data.journeys.length === 0) {
      console.debug('[explorer] Model returned 0 journeys, using heuristic fallback')
      return fallback('model_returned_nothing')
    }

    console.debug(`[explorer] Model discovery succeeded: ${parsed.data.journeys.length} journeys`)
    return {
      journeys: rank(parsed.data.journeys),
      source: 'model',
      model: output.model,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.debug(`[explorer] Model call failed: ${message}`)
    // Discovery is not worth failing a run over: the heuristic path covers it.
    return fallback('model_call_failed')
  }
}

function describe(
  observation: PageObservation,
  goal: string | null,
  authenticated: boolean,
): string {
  const lines = [
    `URL: ${observation.url}`,
    `Title: ${observation.title || '(none)'}`,
    `HTTP status: ${observation.status}`,
  ]
  if (goal) lines.push(`Stated application goal: ${goal}`)
  if (authenticated) {
    lines.push(
      'The browser is already signed in with a test account. Do not propose sign-in, sign-up, or registration journeys; propose journeys that are only reachable once signed in.',
    )
  }
  if (observation.headings.length) {
    lines.push(`Headings: ${observation.headings.join(' | ')}`)
  }

  const links = observation.elements.filter((e) => e.role === 'link')
  const buttons = observation.elements.filter((e) => e.role === 'button')
  const inputs = observation.elements.filter((e) => e.role !== 'link' && e.role !== 'button')

  if (links.length) {
    lines.push(`Links: ${links.map((l) => l.name).slice(0, 25).join(' | ')}`)
  }

  /*
   * The paths this page actually links to, and the one it is on.
   *
   * Without them the model guesses site-root paths - `/dashboard` for an
   * application whose dashboard is at `/acme/dashboard` - and every journey
   * starts on the wrong page. Naming the current path matters just as much:
   * after a sign-in the interesting page is rarely the site root.
   */
  const offered = offeredPaths(observation)
  lines.push(`Current path: ${currentPath(observation)}`)
  if (offered.length > 0) {
    lines.push(`Paths linked from this page: ${offered.slice(0, 25).join(' ')}`)
  }
  lines.push(
    'Set entryPath to the current path, or to one of the linked paths above. Never invent a path; a URL this application did not offer is not a journey.',
  )
  if (buttons.length) {
    lines.push(`Buttons: ${buttons.map((b) => b.name).slice(0, 20).join(' | ')}`)
  }
  if (inputs.length) {
    lines.push(`Inputs: ${inputs.map((i) => i.name).slice(0, 20).join(' | ')}`)
  }
  lines.push(`Page text: ${observation.text}`)

  return lines.join('\n')
}

const ACTION_WORDS: Array<[RegExp, string]> = [
  [/sign ?up|register|create account/i, 'Create an account'],
  [/sign ?in|log ?in/i, 'Sign in'],
  [/checkout|cart|buy|purchase|order/i, 'Complete checkout'],
  [/invite|team|member/i, 'Invite a teammate'],
  [/upload|import/i, 'Upload a file'],
  [/new|create|add/i, 'Create a record'],
  [/search|find/i, 'Search'],
  [/contact|message|support/i, 'Send a message'],
  [/settings|preferences|profile/i, 'Update settings'],
]

/**
 * Derives journeys from what the page actually offers. When the page has
 * actionable elements (links, buttons), it matches them against known action
 * patterns. When the page is sparse — e.g. a landing page that only mentions
 * sub-paths — it falls back to extracting paths from the page text and
 * inferring likely sub-pages from the URL structure.
 */
/**
 * Words from the stated goal worth matching against a page.
 *
 * Short words carry no signal, and the words people reach for when writing a
 * goal - "user", "should", "able" - appear in every goal and match nothing
 * useful, so they are dropped rather than left to match a "User settings" link.
 */
const GOAL_STOP_WORDS = new Set([
  'user',
  'users',
  'should',
  'able',
  'must',
  'want',
  'wants',
  'need',
  'needs',
  'this',
  'that',
  'with',
  'from',
  'their',
  'them',
  'they',
  'when',
  'then',
  'have',
  'been',
  'into',
  'page',
  'site',
  'application',
])

export function goalKeywords(goal: string | null): string[] {
  if (!goal) return []
  return [
    ...new Set(
      goal
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3 && !GOAL_STOP_WORDS.has(word)),
    ),
  ]
}

function heuristicJourneys(
  observation: PageObservation,
  goal: string | null = null,
): DiscoveredJourney[] {
  const found = new Map<string, DiscoveredJourney>()
  const currentPath = new URL(observation.url).pathname || '/'

  const candidates = observation.elements.filter(
    (e) => e.role === 'link' || e.role === 'button',
  )

  /*
   * Phase 0: the goal the operator of this project actually stated.
   *
   * It used to be handed to the model and to nothing else, so on a run where
   * no model was reachable - which is every run on a deployment without one -
   * the single clearest statement of intent in the whole system was ignored.
   */
  const keywords = goalKeywords(goal)
  if (keywords.length > 0) {
    for (const element of candidates) {
      const name = element.name.toLowerCase()
      if (!keywords.some((word) => name.includes(word))) continue

      let entryPath = currentPath
      if (element.href) {
        try {
          entryPath = new URL(element.href, observation.url).pathname
        } catch {
          entryPath = currentPath
        }
      }

      found.set(
        element.name,
        discoveredJourneySchema.parse({
          name: element.name.replace(/\s+/g, ' ').trim().slice(0, 80),
          goal: goal ?? `Complete "${element.name}".`,
          // Above everything the heuristics guess at: it is the one journey
          // somebody actually asked for.
          priority: 0.95,
          entryPath,
        }),
      )
    }

    if (found.size > 0) {
      console.debug(`[explorer] Phase 0 matched: ${found.size} journeys from the stated goal`)
      return [...found.values()]
    }
  }

  // --- Phase 1: match element text against known action patterns ---
  for (const element of candidates) {
    for (const [pattern, name] of ACTION_WORDS) {
      if (!pattern.test(element.name)) continue
      if (found.has(name)) continue

      let entryPath = '/'
      if (element.href) {
        try {
          entryPath = new URL(element.href, observation.url).pathname
        } catch {
          entryPath = '/'
        }
      }

      found.set(
        name,
        discoveredJourneySchema.parse({
          name,
          goal: `A user can complete "${element.name.trim() || name}" from the entry page.`,
          priority: 0.6,
          entryPath,
        }),
      )
      break
    }
  }

  if (found.size > 0) {
    console.debug(`[explorer] Phase 1 matched: ${found.size} journeys from action words`)
    return [...found.values()]
  }

  // --- Phase 2: if sparse, extract paths from page text ---
  const textPaths = extractPathsFromText(observation.text, observation.url)
  for (const p of textPaths) {
    if (found.has(p.label)) continue
    found.set(
      p.label,
      discoveredJourneySchema.parse({
        name: p.label,
        goal: `Navigate to ${p.path} and verify the page loads without errors.`,
        priority: 0.55,
        entryPath: p.path,
      }),
    )
  }

  if (found.size > 0) {
    console.debug(`[explorer] Phase 2 matched: ${found.size} journeys from text paths`)
    return [...found.values()]
  }

  // --- Phase 3: still sparse — infer sub-pages from URL structure ---
  const inferred = inferSubPages(currentPath, observation.text)
  for (const p of inferred) {
    if (found.has(p.label)) continue
    found.set(
      p.label,
      discoveredJourneySchema.parse({
        name: p.label,
        goal: `Navigate to ${p.path} and verify the page loads without errors.`,
        priority: 0.5,
        entryPath: p.path,
      }),
    )
  }

  if (found.size > 0) {
    console.debug(`[explorer] Phase 3 matched: ${found.size} journeys from inferred subpages`)
    return [...found.values()]
  }

  /*
   * Phase 4: last resort.
   *
   * Named after the stated goal when there is one, even though nothing on the
   * page matched it. The journey will be skipped, and "could not attempt
   * 'Users should be able to add referrals'" tells its reader something;
   * "could not attempt 'Load the entry page'" tells them nothing at all.
   */
  console.debug('[explorer] Phase 4: using fallback entry page journey')
  const fallbackName = goal ? goal.trim().slice(0, 80) : 'Load the entry page'
  found.set(
    fallbackName,
    discoveredJourneySchema.parse({
      name: fallbackName,
      goal: goal ?? 'The entry page loads without server or client errors.',
      priority: 0.5,
      entryPath: currentPath,
    }),
  )

  return [...found.values()]
}

/** Matches paths like /eightbrothers/login, /api/v2/users, /settings */
const PATH_PATTERN = /(?:^|\s|[,;:])((?:\/[a-zA-Z0-9_-]+){1,6})(?:\s|[,;:.]|$)/g

/**
 * Extracts path-like strings from page text. Filters out static-asset
 * extensions and common non-navigable paths.
 */
function extractPathsFromText(
  text: string,
  currentUrl: string,
): Array<{ label: string; path: string }> {
  const results: Array<{ label: string; path: string }> = []
  const seen = new Set<string>()
  const currentPath = new URL(currentUrl).pathname || '/'

  let match: RegExpExecArray | null
  while ((match = PATH_PATTERN.exec(text)) !== null) {
    const raw = match[1]
    // Skip static assets
    if (/\.\w{2,4}$/.test(raw)) continue
    // Skip the current path itself
    if (raw === currentPath) continue
    // Normalise trailing slash
    const path = raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw
    if (seen.has(path)) continue
    seen.add(path)

    // Build a human-readable label from the last path segment
    const segments = path.split('/').filter(Boolean)
    const lastSegment = segments[segments.length - 1] ?? path
    const label = `Navigate to ${lastSegment.replace(/[-_]/g, ' ')}`

    results.push({ label, path })
    if (results.length >= 4) break // cap at 4 extracted paths
  }

  return results
}

/**
 * When the page text is completely empty of paths, infer likely sub-pages
 * from common URL conventions (e.g. a root page → try /dashboard, /login).
 */
function inferSubPages(
  currentPath: string,
  text: string,
): Array<{ label: string; path: string }> {
  const lowerText = text.toLowerCase()
  const results: Array<{ label: string; path: string }> = []

  /**
   * Appends a segment to the current path, unless the page is already there.
   *
   * Without the guard, exploring `/acme/dashboard` and seeing the word
   * "dashboard" in its own heading proposes `/acme/dashboard/dashboard`, which
   * 404s. Forge then has a reproducible failure against a URL it invented,
   * which is the worst thing a verifier can produce.
   */
  const under = (segment: string): string | null => {
    const base = currentPath.replace(/\/+$/, '')
    if (base.split('/').includes(segment)) return null
    return base === '' ? `/${segment}` : `${base}/${segment}`
  }

  // If text mentions "sign in" or "login", navigate to a login path
  if (/sign\s*in|log\s*in|login/i.test(lowerText)) {
    const loginPath = under('login')
    if (loginPath) {
      results.push({ label: 'Navigate to login page', path: loginPath })
    }
  }

  // If text mentions "dashboard" or "admin"
  if (/dashboard|admin|manage/i.test(lowerText)) {
    const dashPath = under('dashboard')
    if (dashPath) {
      results.push({ label: 'Navigate to dashboard', path: dashPath })
    }
  }

  return results
}
