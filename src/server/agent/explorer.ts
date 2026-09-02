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

export type ExplorationResult = {
  journeys: DiscoveredJourney[]
  source: 'model' | 'heuristic'
  model: string | null
}

export async function discoverJourneys(
  provider: ModelProvider,
  observation: PageObservation,
  goal: string | null,
  limit: number,
  options: { authenticated?: boolean } = {},
): Promise<ExplorationResult> {
  const heuristic = heuristicJourneys(observation)
  const rank = (journeys: readonly DiscoveredJourney[]) =>
    rankJourneys(journeys, limit, options)

  if (!provider.available) {
    console.debug('[explorer] Provider not available, using heuristic-only discovery')
    return { journeys: rank(heuristic), source: 'heuristic', model: null }
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
      return { journeys: rank(heuristic), source: 'heuristic', model: null }
    }
    
    if (parsed.data.journeys.length === 0) {
      console.debug('[explorer] Model returned 0 journeys, using heuristic fallback')
      return { journeys: rank(heuristic), source: 'heuristic', model: null }
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
    return { journeys: rank(heuristic), source: 'heuristic', model: null }
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
function heuristicJourneys(observation: PageObservation): DiscoveredJourney[] {
  const found = new Map<string, DiscoveredJourney>()
  const currentPath = new URL(observation.url).pathname || '/'

  const candidates = observation.elements.filter(
    (e) => e.role === 'link' || e.role === 'button',
  )

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

  // --- Phase 4: last resort — just load the entry page ---
  console.debug('[explorer] Phase 4: using fallback entry page journey')
  found.set(
    'Load the entry page',
    discoveredJourneySchema.parse({
      name: 'Load the entry page',
      goal: 'The entry page loads without server or client errors.',
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

  // If text mentions "sign in" or "login", navigate to a login path
  if (/sign\s*in|log\s*in|login/i.test(lowerText)) {
    // Try the current path + /login first
    const loginPath = currentPath === '/' ? '/login' : `${currentPath}/login`
    results.push({ label: 'Navigate to login page', path: loginPath })
  }

  // If text mentions "dashboard" or "admin"
  if (/dashboard|admin|manage/i.test(lowerText)) {
    const dashPath = currentPath === '/' ? '/dashboard' : `${currentPath}/dashboard`
    results.push({ label: 'Navigate to dashboard', path: dashPath })
  }

  return results
}
