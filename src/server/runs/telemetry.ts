/**
 * Run telemetry.
 *
 * One datapoint per completed run, written to Analytics Engine. These are the
 * numbers that say whether the agent is getting better or worse: how often it
 * finds something, how often that something is confirmed rather than flaky, and
 * what a run costs in actions and model calls.
 *
 * Never fails a run. Losing a datapoint is not worth losing a verification.
 */
import { env } from 'cloudflare:workers'
import type { Finding, Run } from '../contracts'
import type { BudgetUsage } from '../domain/budget'

export function recordRunMetrics(input: {
  run: Pick<Run, 'id' | 'projectId' | 'executor' | 'status'>
  journeys: number
  failures: number
  findings: Pick<Finding, 'classification'>[]
  usage: BudgetUsage & { elapsedSeconds: number }
  discoverySource: 'model' | 'heuristic'
}): void {
  try {
    env.ANALYTICS?.writeDataPoint({
      indexes: [input.run.projectId],
      blobs: [
        input.run.id,
        input.run.status,
        input.run.executor,
        input.discoverySource,
      ],
      doubles: [
        input.journeys,
        input.failures,
        input.findings.length,
        input.findings.filter((f) => f.classification === 'confirmed_bug').length,
        input.findings.filter((f) => f.classification === 'flaky').length,
        input.usage.aiCalls,
        input.usage.browserActions,
        input.usage.elapsedSeconds,
      ],
    })
  } catch {
    // Telemetry is best effort by design.
  }
}
