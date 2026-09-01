/**
 * Failure analysis: classification, severity, confidence, journey ranking.
 *
 * These are deterministic rules applied to observed evidence. The model can
 * refine the result, but it can never be the only thing that produced it -
 * a finding always has a defensible non-model baseline.
 */
import type {
  Classification,
  DiscoveredJourney,
  FailureClass,
  Severity,
} from '../contracts'

export type FailureSignal = {
  /** HTTP status of the last response, when one was observed. */
  status?: number
  /** Network-level error, e.g. DNS failure or connection reset. */
  transportError?: boolean
  /** The action timed out. */
  timedOut?: boolean
  /** Uncaught errors seen on the page. */
  consoleErrors: string[]
  /** Failed subresource loads and 4xx/5xx responses seen during the step. */
  networkErrors?: string[]
  /** The executor itself broke, rather than the application. */
  executorError?: boolean
  /** The step could not proceed because the app demanded credentials. */
  authWall?: boolean
}

export function classifyFailure(signal: FailureSignal): FailureClass {
  if (signal.executorError) return 'BROWSER_FAILURE'
  if (signal.authWall) return 'AUTH_FAILURE'
  if (signal.transportError) return 'NETWORK_FAILURE'
  if (signal.timedOut) return 'TIMEOUT'
  if (signal.status !== undefined) {
    if (signal.status >= 500) return 'APPLICATION_BUG'
    if (signal.status === 401 || signal.status === 403) return 'AUTH_FAILURE'
    if (signal.status === 429) return 'ENVIRONMENT_FAILURE'
    if (signal.status >= 400) return 'APPLICATION_BUG'
  }
  if (signal.consoleErrors.length > 0) return 'APPLICATION_BUG'
  return 'UNKNOWN'
}

/** Whether a failure class is worth spending reproduction budget on. */
export function shouldReproduce(failureClass: FailureClass): boolean {
  return failureClass === 'APPLICATION_BUG' || failureClass === 'UNKNOWN'
}

export function severityFor(
  failureClass: FailureClass,
  journeyPriority: number,
  reproductionRate: number,
): Severity {
  if (failureClass !== 'APPLICATION_BUG') {
    return journeyPriority >= 0.8 ? 'medium' : 'low'
  }
  const weight = journeyPriority * 0.6 + reproductionRate * 0.4
  if (weight >= 0.85) return 'critical'
  if (weight >= 0.65) return 'high'
  if (weight >= 0.4) return 'medium'
  return 'low'
}

export function classificationFor(
  failureClass: FailureClass,
  attempts: number,
  failures: number,
): Classification {
  if (failureClass === 'BROWSER_FAILURE' || failureClass === 'SOLARI_FAILURE') {
    return 'agent_error'
  }
  if (
    failureClass === 'ENVIRONMENT_FAILURE' ||
    failureClass === 'NETWORK_FAILURE' ||
    failureClass === 'AUTH_FAILURE'
  ) {
    return 'environment'
  }
  if (attempts === 0) return 'unknown'
  if (failures === attempts) return 'confirmed_bug'
  if (failures === 0) return 'unknown'
  return 'flaky'
}

/**
 * Confidence in the finding itself, not in the root cause. Driven by how
 * consistently the failure reproduced and how strong the runtime signal was.
 */
export function confidenceFor(
  failureClass: FailureClass,
  attempts: number,
  failures: number,
  signal: FailureSignal,
): number {
  if (attempts === 0) return 0.3
  const rate = failures / attempts
  let score = 0.35 + rate * 0.45
  if (failureClass === 'APPLICATION_BUG') score += 0.1
  if (signal.status !== undefined && signal.status >= 500) score += 0.08
  if (signal.consoleErrors.length > 0) score += 0.04
  if (rate > 0 && rate < 1) score -= 0.15
  return Math.max(0.05, Math.min(0.99, Number(score.toFixed(2))))
}

/** Keywords that indicate a journey touches something users actually care about. */
const HIGH_VALUE = [
  'checkout',
  'payment',
  'purchase',
  'billing',
  'sign up',
  'signup',
  'register',
  'sign in',
  'login',
  'invite',
  'create',
  'upload',
  'delete',
  'submit',
  'onboard',
]

const LOW_VALUE = ['theme', 'about', 'legal', 'privacy', 'terms', 'changelog']

/**
 * Re-score model-proposed priorities against business-value keywords so a
 * confident-but-wrong model cannot spend the whole budget on a settings page.
 */
export function rankJourneys(
  journeys: readonly DiscoveredJourney[],
  limit: number,
): DiscoveredJourney[] {
  return journeys
    .map((j) => {
      const haystack = `${j.name} ${j.goal}`.toLowerCase()
      let priority = j.priority
      if (HIGH_VALUE.some((k) => haystack.includes(k))) priority += 0.15
      if (LOW_VALUE.some((k) => haystack.includes(k))) priority -= 0.2
      return { ...j, priority: Math.max(0, Math.min(1, Number(priority.toFixed(2)))) }
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit)
}
