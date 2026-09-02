/**
 * Project deletion.
 *
 * Deleting a project means deleting rows in D1 and objects in R2, and there is
 * no transaction that spans the two. The order is chosen so that no failure
 * leaves something visible:
 *
 *   1. mark the project deleted        - it vanishes from every query at once
 *   2. queue the cleanup               - returns immediately, nothing blocks
 *   3. purge each run's R2 prefix,     - a few runs per message, so one huge
 *      then delete the run rows          project cannot exhaust a consumer
 *   4. delete the project row          - only once nothing of it remains
 *
 * Artifacts are addressed by R2 prefix rather than by the storage keys D1
 * holds, because the prefix is authoritative: an object whose metadata row was
 * lost is still under `runs/<id>/`, and that is exactly the object a
 * key-driven cleanup would strand forever.
 *
 * A message that keeps failing ends up on the dead-letter queue. The project
 * stays marked deleted there, so a stuck cleanup is invisible to its owner and
 * still recoverable by an operator - the opposite of hard-deleting the row and
 * leaving unreferenced objects nobody can find.
 */
import { env } from 'cloudflare:workers'
import {
  cleanupMessageSchema,
  KEYS_PER_DELETE,
  MAX_PASSES,
  RUNS_PER_PASS,
  type CleanupMessage,
} from './messages'
import * as repo from '../runs/repository'

/** Whether the deletion queue is configured on this deployment. */
export function cleanupQueueAvailable(): boolean {
  return Boolean(env.CLEANUP_QUEUE)
}

/**
 * Hands a deletion to the queue.
 *
 * Falls back to doing the work inline when no queue is bound, because leaving
 * a user's artifacts in R2 is not an acceptable degradation. The inline path is
 * bounded the same way a pass is; anything left over stays marked deleted and
 * is finished by the next sweep.
 */
export async function requestProjectDeletion(projectId: string): Promise<void> {
  await repo.markProjectDeleted(projectId)

  const message: CleanupMessage = { type: 'project.delete', projectId, pass: 0 }

  if (!cleanupQueueAvailable()) {
    await purgeProject(message).catch((error: unknown) => {
      console.error(
        `[cleanup] inline deletion of ${projectId} failed:`,
        error instanceof Error ? error.message : error,
      )
    })
    return
  }

  await env.CLEANUP_QUEUE.send(message)
}

/**
 * One pass over a project.
 *
 * Returns whether the project is now completely gone. When it is not, the
 * caller enqueues the next pass; the remaining work is simply the runs that
 * are still in the database.
 */
export async function purgeProject(message: CleanupMessage): Promise<boolean> {
  const runIds = await repo.listRunIdsForProject(message.projectId, RUNS_PER_PASS)

  for (const runId of runIds) {
    await purgePrefix(`runs/${runId}/`)
  }

  // Rows go after the objects they point at. The reverse order would lose the
  // only record of which artifacts existed if this pass died halfway.
  await repo.hardDeleteRuns(runIds)

  if (runIds.length === RUNS_PER_PASS) return false

  await repo.hardDeleteProject(message.projectId)
  return true
}

/** Deletes every object under a prefix, a page at a time. */
async function purgePrefix(prefix: string): Promise<void> {
  let cursor: string | undefined

  do {
    const listed = await env.EVIDENCE.list({
      prefix,
      limit: KEYS_PER_DELETE,
      cursor,
    })

    if (listed.objects.length > 0) {
      await env.EVIDENCE.delete(listed.objects.map((object) => object.key))
    }

    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
}

/**
 * Queue consumer.
 *
 * Each message is acknowledged or retried on its own, so one project that
 * cannot be purged does not drag the rest of the batch back onto the queue.
 */
export async function handleCleanupBatch(
  batch: MessageBatch<unknown>,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = cleanupMessageSchema.safeParse(message.body)

    if (!parsed.success) {
      // Unparseable, and retrying will not change that. Acknowledged so it
      // stops circulating; the body is logged so it is not simply lost.
      console.error('[cleanup] discarding malformed message:', message.body)
      message.ack()
      continue
    }

    if (parsed.data.pass >= MAX_PASSES) {
      console.error(
        `[cleanup] ${parsed.data.projectId} exceeded ${MAX_PASSES} passes; sending it to the dead-letter queue.`,
      )
      message.retry()
      continue
    }

    try {
      const finished = await purgeProject(parsed.data)

      if (!finished) {
        await env.CLEANUP_QUEUE.send({
          ...parsed.data,
          pass: parsed.data.pass + 1,
        } satisfies CleanupMessage)
      }

      message.ack()
    } catch (error) {
      // Retried, and eventually dead-lettered. The project stays marked
      // deleted throughout, so nobody sees a project that failed to delete.
      console.error(
        `[cleanup] pass ${parsed.data.pass} for ${parsed.data.projectId} failed:`,
        error instanceof Error ? error.message : error,
      )
      message.retry()
    }
  }
}

/**
 * Dead-letter consumer.
 *
 * Records what could not be finished and acknowledges it. Retrying here would
 * put the message back into the same loop that already failed; what is needed
 * instead is a visible record. The project row survives, still marked deleted,
 * which is what makes the leftover objects findable later.
 */
export function handleCleanupDeadLetter(batch: MessageBatch<unknown>): void {
  for (const message of batch.messages) {
    const parsed = cleanupMessageSchema.safeParse(message.body)
    const id = parsed.success ? parsed.data.projectId : 'unknown'

    console.error(
      `[cleanup:dlq] deletion of project ${id} could not be completed after ${message.attempts} attempts. Its row is still marked deleted and its artifacts remain under runs/<runId>/ in R2.`,
      message.body,
    )

    message.ack()
  }
}
