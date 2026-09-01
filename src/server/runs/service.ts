/**
 * Run service.
 *
 * The only path that creates or cancels a run. It validates the target, checks
 * ownership, writes the run row, then hands execution to the run's Durable
 * Object. HTTP requests never execute a run inline: they return a run id and
 * the client subscribes to live progress.
 */
import { env } from 'cloudflare:workers'
import type { Run } from '../contracts'
import { plannedExecutorKind } from '../execution'
import { assertSafeTargetUrl } from '../security'
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
}): Promise<Run> {
  const project = await repo.assertProjectAccess(input.projectId, input.userId)

  // Re-validated at run time as well as at project creation, because the stored
  // value could have been written before a rule changed.
  assertSafeTargetUrl(project.targetUrl)

  const run = await repo.createRun({
    projectId: project.id,
    targetUrl: project.targetUrl,
    repoUrl: project.repoUrl,
    executor: plannedExecutorKind(),
    trigger: input.trigger,
    verifiesFindingId: input.verifiesFindingId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
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
      targetUrl: project.targetUrl,
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
