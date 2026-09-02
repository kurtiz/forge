/**
 * Schedule storage.
 *
 * One schedule per project, enforced by a unique constraint rather than by
 * checking first, so two concurrent writes cannot produce two monitors on one
 * project.
 */
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm'
import type { Schedule, ScheduleOutcome } from '../contracts'
import { db, newId, nowIso, tables } from '../db'
import { nextRunAt } from './schedule'

type ScheduleRow = typeof tables.schedules.$inferSelect

const toSchedule = (r: ScheduleRow): Schedule => ({
  id: r.id,
  projectId: r.projectId,
  cadenceMinutes: r.cadenceMinutes,
  enabled: r.enabled,
  notifyUrl: r.notifyUrl,
  nextRunAt: r.nextRunAt,
  lastRunId: r.lastRunId,
  lastRunAt: r.lastRunAt,
  lastOutcome: r.lastOutcome ?? null,
  consecutiveFailures: r.consecutiveFailures,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

export async function getSchedule(projectId: string): Promise<Schedule | null> {
  const [row] = await db()
    .select()
    .from(tables.schedules)
    .where(eq(tables.schedules.projectId, projectId))
    .limit(1)

  return row ? toSchedule(row) : null
}

export async function upsertSchedule(input: {
  projectId: string
  cadenceMinutes: number
  enabled: boolean
  notifyUrl: string | null
}): Promise<Schedule> {
  const at = nowIso()
  // A disabled schedule has no due time, so it cannot be picked up by the cron
  // even if the query changes shape later.
  const due = input.enabled ? nextRunAt(new Date(), input.cadenceMinutes) : null

  const [row] = await db()
    .insert(tables.schedules)
    .values({
      ...input,
      id: newId('sch'),
      nextRunAt: due,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: tables.schedules.projectId,
      set: {
        cadenceMinutes: input.cadenceMinutes,
        enabled: input.enabled,
        notifyUrl: input.notifyUrl,
        nextRunAt: due,
        updatedAt: at,
      },
    })
    .returning()

  return toSchedule(row)
}

export async function deleteSchedule(projectId: string): Promise<void> {
  await db().delete(tables.schedules).where(eq(tables.schedules.projectId, projectId))
}

export type DueSchedule = {
  schedule: Schedule
  projectName: string
  userId: string
  targetUrl: string
}

/**
 * Schedules whose next run is in the past.
 *
 * Bounded: a cron tick that has fallen behind starts a handful of runs and
 * lets the next tick take the rest, rather than launching every overdue
 * monitor at once and blowing through the Solari concurrency limit.
 */
export async function listDueSchedules(limit = 10): Promise<DueSchedule[]> {
  const rows = await db()
    .select({ schedule: tables.schedules, project: tables.projects })
    .from(tables.schedules)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.schedules.projectId))
    .where(
      and(
        eq(tables.schedules.enabled, true),
        isNotNull(tables.schedules.nextRunAt),
        lte(tables.schedules.nextRunAt, nowIso()),
      ),
    )
    .orderBy(asc(tables.schedules.nextRunAt))
    .limit(limit)

  return rows.map((r) => ({
    schedule: toSchedule(r.schedule),
    projectName: r.project.name,
    userId: r.project.userId,
    targetUrl: r.project.targetUrl,
  }))
}

/**
 * Moves a schedule's pointer forward.
 *
 * Called before the run is started, not after: if starting throws, the pointer
 * has already advanced, so a persistently failing project cannot pin the cron
 * to one row and starve every other schedule.
 */
export async function claimSchedule(
  scheduleId: string,
  cadenceMinutes: number,
): Promise<void> {
  const at = nowIso()
  await db()
    .update(tables.schedules)
    .set({ nextRunAt: nextRunAt(new Date(), cadenceMinutes), updatedAt: at })
    .where(eq(tables.schedules.id, scheduleId))
}

export async function recordScheduleOutcome(input: {
  scheduleId: string
  runId: string
  outcome: ScheduleOutcome
  consecutiveFailures: number
}): Promise<void> {
  const at = nowIso()
  await db()
    .update(tables.schedules)
    .set({
      lastRunId: input.runId,
      lastRunAt: at,
      lastOutcome: input.outcome,
      consecutiveFailures: input.consecutiveFailures,
      updatedAt: at,
    })
    .where(eq(tables.schedules.id, input.scheduleId))
}

/** The schedule a finished run belongs to, if it was a scheduled run. */
export async function scheduleForRun(runId: string): Promise<Schedule | null> {
  const [row] = await db()
    .select({ schedule: tables.schedules })
    .from(tables.runs)
    .innerJoin(tables.schedules, eq(tables.schedules.projectId, tables.runs.projectId))
    .where(eq(tables.runs.id, runId))
    .limit(1)

  return row ? toSchedule(row.schedule) : null
}
