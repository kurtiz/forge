/**
 * Worker entry.
 *
 * Wraps the TanStack Start request handler so the run engine Durable Object and
 * the cron handler can be exported from the same Worker. `main` in
 * wrangler.jsonc points here instead of at
 * `@tanstack/react-start/server-entry`.
 */
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import {
  handleCleanupBatch,
  handleCleanupDeadLetter,
} from './server/cleanup'
import { runScheduledMonitors } from './server/monitoring/cron'

export { RunSessionDO } from './server/runs/run-session-do'

const fetch = createStartHandler(defaultStreamHandler)

/**
 * Scheduled monitoring. The trigger fires on a fixed interval; which projects
 * are actually due is decided per row, from the cadence each one carries.
 */
const scheduled: ExportedHandlerScheduledHandler = (_controller, _env, ctx) => {
  ctx.waitUntil(
    runScheduledMonitors().then((result) => {
      console.log(
        `monitoring tick: ${result.started} started, ${result.failed} failed, ${result.due} due`,
      )
    }),
  )
}

/**
 * Queue consumer.
 *
 * One handler serves both queues; `batch.queue` says which. The dead-letter
 * queue gets its own path because its job is the opposite of the main one: it
 * records a failure instead of retrying it.
 */
const queue: ExportedHandlerQueueHandler<Env, unknown> = async (batch) => {
  if (batch.queue === 'forge-cleanup-dlq') {
    handleCleanupDeadLetter(batch)
    return
  }
  await handleCleanupBatch(batch)
}

export default { fetch, scheduled, queue }
