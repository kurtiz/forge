/**
 * Scheduled monitoring tick.
 *
 * Cloudflare's cron trigger calls this every fifteen minutes. It does not
 * decide anything about cadence: it asks which schedules are due, claims them,
 * and starts a run. The cadence lives on the row, so a project checked twice a
 * day and a project checked twice an hour share one trigger.
 *
 * Pre-deployment verification and post-deployment monitoring end up being the
 * same engine, the same evidence, and the same findings. Only the trigger is
 * different.
 */
import { startRun } from '../runs/service'
import * as monitor from './repository'

export type TickResult = {
  due: number
  started: number
  failed: number
}

export async function runScheduledMonitors(): Promise<TickResult> {
  const due = await monitor.listDueSchedules()
  let started = 0
  let failed = 0

  for (const entry of due) {
    /*
     * Claimed before the attempt. If starting throws - an unreachable target, a
     * project whose URL policy changed under it - the pointer has already moved
     * on, so one broken project cannot hold the queue and starve the others.
     */
    await monitor.claimSchedule(entry.schedule.id, entry.schedule.cadenceMinutes)

    try {
      await startRun({
        userId: entry.userId,
        projectId: entry.schedule.projectId,
        trigger: 'scheduled',
        // One run per schedule per due time, so an overlapping tick or a retry
        // cannot create a second billable session.
        idempotencyKey: `sch:${entry.schedule.id}:${entry.schedule.nextRunAt ?? ''}`,
      })
      started++
    } catch {
      failed++
    }
  }

  return { due: due.length, started, failed }
}
