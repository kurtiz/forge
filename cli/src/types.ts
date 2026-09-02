/**
 * The shapes this CLI reads from the API.
 *
 * Hand-written rather than imported from the server: the CLI ships separately
 * and has to keep working against a Forge that is a version or two ahead, so it
 * describes only the fields it actually uses and ignores everything else.
 */
export type RunStatus =
  | 'queued'
  | 'starting'
  | 'discovering'
  | 'testing'
  | 'investigating'
  | 'reporting'
  | 'completed'
  | 'failed'
  | 'canceled'

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'canceled',
]

export type Journey = {
  id: string
  name: string
  /** `skipped` means nothing on the page matched it, so nothing was verified. */
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
}

export type Finding = {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  classification: 'confirmed_bug' | 'flaky' | 'environment' | 'agent_error' | 'unknown'
  reproductionAttempts: number
  reproductionFailures: number
  rootCause: string | null
  affectedFiles: string[]
}

export type RunReport = {
  run: {
    id: string
    status: RunStatus
    executor: 'solari' | 'fetch'
    targetUrl: string
    summary: string | null
    replayUrl: string | null
  }
  project: { id: string; name: string }
  journeys: Journey[]
  findings: Finding[]
  url: string
}
