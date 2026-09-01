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
): Promise<ExplorationResult> {
  const heuristic = heuristicJourneys(observation)

  if (!provider.available) {
    return { journeys: rankJourneys(heuristic, limit), source: 'heuristic', model: null }
  }

  try {
    const output = await provider.generate({
      task: 'discovery',
      system: EXPLORER_SYSTEM,
      user: describe(observation, goal),
      maxTokens: 700,
    })

    const parsed = explorerOutputSchema.safeParse(extractJson(output.text))
    if (!parsed.success || parsed.data.journeys.length === 0) {
      return {
        journeys: rankJourneys(heuristic, limit),
        source: 'heuristic',
        model: null,
      }
    }

    return {
      journeys: rankJourneys(parsed.data.journeys, limit),
      source: 'model',
      model: output.model,
    }
  } catch {
    // Discovery is not worth failing a run over: the heuristic path covers it.
    return { journeys: rankJourneys(heuristic, limit), source: 'heuristic', model: null }
  }
}

function describe(observation: PageObservation, goal: string | null): string {
  const lines = [
    `URL: ${observation.url}`,
    `Title: ${observation.title || '(none)'}`,
    `HTTP status: ${observation.status}`,
  ]
  if (goal) lines.push(`Stated application goal: ${goal}`)
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
 * Derives journeys from what the page actually offers. Deliberately boring:
 * its job is to keep a run useful when the model is unavailable, not to be
 * clever.
 */
function heuristicJourneys(observation: PageObservation): DiscoveredJourney[] {
  const found = new Map<string, DiscoveredJourney>()

  const candidates = observation.elements.filter(
    (e) => e.role === 'link' || e.role === 'button',
  )

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

  if (found.size === 0) {
    found.set(
      'Load the entry page',
      discoveredJourneySchema.parse({
        name: 'Load the entry page',
        goal: 'The entry page loads without server or client errors.',
        priority: 0.5,
        entryPath: new URL(observation.url).pathname || '/',
      }),
    )
  }

  return [...found.values()]
}
