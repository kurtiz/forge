/**
 * Run service.
 *
 * The only path that creates or cancels a run. It validates the target, checks
 * ownership, writes the run row, then hands execution to the run's Durable
 * Object. HTTP requests never execute a run inline: they return a run id and
 * the client subscribes to live progress.
 */
import { env } from 'cloudflare:workers'
import type { Run } from '@/server/contracts'
import { plannedExecutorKind } from '@/server/execution'
import { assertSafeTargetUrl, limitRunStart } from '@/server/security'
import * as repo from './repository'

function stub(runId: string): DurableObjectStub {
  return env.RUN_SESSION.get(env.RUN_SESSION.idFromName(runId))
}

export async function startRun(input: {
  userId: string
  projectId: string
  trigger: Run['trigger']
  verifiesFindingId?: string | null
  idempotencyKey?: string | null
  /**
   * Verify somewhere other than the project's configured target: a pull
   * request's preview deployment. Validated like any other target.
   */
  targetUrl?: string | null
  github?: {
    commitSha: string
    pullRequestNumber: number | null
    installationId: string
  } | null
}): Promise<Run> {
  const project = await repo.assertProjectAccess(input.projectId, input.userId)

  /*
   * A run buys a browser session and model calls, so the account that will be
   * billed for them is what the limit counts. Machine triggers are exempt:
   * their rate is already bounded by the cadence a project chose and by how
   * often a branch is pushed, and refusing one of those would read as Forge
   * missing a deployment rather than as a limit doing its job.
   */
  if (input.trigger !== 'scheduled' && input.trigger !== 'pull_request') {
    await limitRunStart(input.userId)
  }

  // Re-validated at run time as well as at project creation, because the stored
  // value could have been written before a rule changed.
  const targetUrl = assertSafeTargetUrl(
    input.targetUrl ?? project.targetUrl,
  ).toString()

  const run = await repo.createRun({
    projectId: project.id,
    targetUrl,
    repoUrl: project.repoUrl,
    executor: plannedExecutorKind(),
    trigger: input.trigger,
    verifiesFindingId: input.verifiesFindingId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    commitSha: input.github?.commitSha ?? null,
    pullRequestNumber: input.github?.pullRequestNumber ?? null,
    githubInstallationId: input.github?.installationId ?? null,
  })

  // An idempotent replay returns the existing run without starting it twice.
  if (run.status !== 'queued') return run

  if (input.verifiesFindingId) {
    await repo.recordFixAttempt({
      findingId: input.verifiesFindingId,
      verificationRunId: run.id,
      status: 'pending',
      summary: null,
    })
  }

  await stub(run.id).fetch('https://run/start', {
    method: 'POST',
    body: JSON.stringify({
      runId: run.id,
      projectId: project.id,
      targetUrl,
      repoUrl: project.repoUrl,
      goal: project.goal,
      verifiesFindingId: input.verifiesFindingId ?? null,
    }),
  })

  return run
}

export async function cancelRun(runId: string, userId: string): Promise<void> {
  const { run } = await repo.assertRunAccess(runId, userId)
  if (['completed', 'failed', 'canceled'].includes(run.status)) return

  await stub(runId).fetch('https://run/cancel', { method: 'POST' })
  await repo.updateRun(runId, {
    status: 'canceled',
    completedAt: new Date().toISOString(),
    summary: 'Canceled by the user.',
  })
}

export function streamRun(runId: string): Promise<Response> {
  return stub(runId).fetch('https://run/stream')
}
