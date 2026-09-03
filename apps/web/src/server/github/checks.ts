/**
 * GitHub checks.
 *
 * A verification run becomes a check run on the commit: queued when the run
 * starts, and concluded when it finishes with the findings written into the
 * check summary. The check is the only artifact most reviewers will read, so
 * it carries the numbers and links back to the evidence rather than restating
 * the narrative.
 *
 * Conclusion policy: a run only fails the check on findings the deterministic
 * classifier called `confirmed_bug`. Flaky, environmental, and agent-error
 * findings are reported as neutral. Blocking a pull request on a rate limit or
 * on Forge's own hiccup would teach people to ignore the check, which is worse
 * than not having one.
 */
import { env } from 'cloudflare:workers'
import type { Finding, Journey, Run } from '@/server/contracts'
import { installationFetch } from './app'
import {
  renderCheckReport as render,
  type CheckConclusion,
  type CheckReport,
} from './report'

export type { CheckConclusion, CheckReport } from './report'

/** Wraps the pure renderer with this deployment's console URL. */
export function renderCheckReport(input: {
  run: Run
  journeys: Journey[]
  findings: Finding[]
}): CheckReport {
  return render({ ...input, baseUrl: env.APP_URL || 'http://localhost:3000' })
}

function consoleUrl(path: string): string {
  const base = (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}${path}`
}

/** Opens an in-progress check run and returns its id. */
export async function openCheckRun(input: {
  installationId: string
  repoFullName: string
  commitSha: string
  runId: string
}): Promise<string | null> {
  const body = await installationFetch(
    input.installationId,
    `/repos/${input.repoFullName}/check-runs`,
    {
      method: 'POST',
      body: {
        name: 'Forge verification',
        head_sha: input.commitSha,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        details_url: consoleUrl(`/runs/${input.runId}`),
        external_id: input.runId,
        output: {
          title: 'Verifying the preview deployment',
          summary:
            'Forge is exploring the deployment in a browser, running the journeys that matter, and reproducing anything that fails.',
        },
      },
    },
  )

  const id = (body as { id?: number } | null)?.id
  return id === undefined ? null : String(id)
}

/** Concludes a check run with the report. */
export async function concludeCheckRun(input: {
  installationId: string
  repoFullName: string
  checkRunId: string
  conclusion: CheckConclusion
  title: string
  summary: string
}): Promise<void> {
  await installationFetch(
    input.installationId,
    `/repos/${input.repoFullName}/check-runs/${input.checkRunId}`,
    {
      method: 'PATCH',
      body: {
        status: 'completed',
        completed_at: new Date().toISOString(),
        conclusion: input.conclusion,
        output: { title: input.title, summary: input.summary },
      },
    },
  )
}
