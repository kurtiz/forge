/**
 * Cleanup queue messages.
 *
 * Pure, and validated on the way out and the way in. A queue message is a
 * boundary like any other: it is written by one deployment and read by another,
 * possibly a version later, and a message that no longer parses must be
 * rejected rather than acted on half-understood.
 */
import { z } from 'zod'

export const cleanupMessageSchema = z.object({
  type: z.literal('project.delete'),
  projectId: z.string().min(3).max(64),
  /**
   * How many times this project's deletion has been handed back to the queue
   * to continue. Not a retry count: each pass finishes real work and enqueues
   * the remainder, so this only exists to stop a bug from cycling forever.
   */
  pass: z.number().int().min(0).max(200).default(0),
})

export type CleanupMessage = z.infer<typeof cleanupMessageSchema>

/**
 * Runs whose artifacts are purged in one pass.
 *
 * A queue consumer has a wall-clock budget and a project can hold hundreds of
 * runs, each with its own R2 prefix to list and delete. Walking a few runs per
 * message and handing the rest back keeps every pass short, so a large project
 * is slower to disappear but never stalls the queue.
 */
export const RUNS_PER_PASS = 15

/** Objects deleted in one R2 call. The API's own ceiling is 1000. */
export const KEYS_PER_DELETE = 1000

/**
 * A ceiling on how many times one project may be handed back.
 *
 * At the pass size above this is thousands of runs, far past any real project.
 * Reaching it means something is not making progress, and the message goes to
 * the dead-letter queue with the project still marked deleted rather than
 * looping.
 */
export const MAX_PASSES = 200
