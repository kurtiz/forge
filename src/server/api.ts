/**
 * Server functions.
 *
 * These are the typed boundary the UI calls. Each one resolves the caller from
 * the request, checks ownership through `repository.assert*Access`, and returns
 * plain serialisable data. Input is validated with the shared contracts, so an
 * invalid payload never reaches a query.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
  createProjectInputSchema,
  type Evidence,
  type Finding,
  type Journey,
  type Project,
  type Run,
  type RunEvent,
} from './contracts'
import { currentUser, requireUser, type SessionUser } from './auth'
import { plannedExecutorKind } from './execution'
import { assertSafeTargetUrl, normaliseRepoUrl } from './security'
import * as repo from './runs/repository'
import { cancelRun, startRun } from './runs/service'
import { listRunEvidence } from './evidence/store'

const idSchema = z.string().min(3).max(64)

async function user(): Promise<SessionUser> {
  return requireUser(getRequest())
}

/* ----------------------------------------------------------------- session */

export type SessionPayload = {
  user: SessionUser | null
  /** Which executor a run started right now would use. */
  executor: 'solari' | 'fetch'
}

export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionPayload> => ({
    user: await currentUser(getRequest()),
    executor: plannedExecutorKind(),
  }),
)

/* ---------------------------------------------------------------- projects */

export type DashboardPayload = {
  projects: Project[]
  recentRuns: Array<Run & { projectName: string }>
  stats: {
    totalRuns: number
    passRate: number | null
    openFindings: number
  }
}

export const getDashboard = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardPayload> => {
    const me = await user()
    const [projects, recentRuns, openFindings] = await Promise.all([
      repo.listProjects(me.id),
      repo.listRecentRunsForUser(me.id, 12),
      // One aggregate rather than a findings query per run.
      repo.countOpenBugs(me.id),
    ])

    const completed = recentRuns.filter((r) => r.status === 'completed')
    const clean = completed.filter(
      (r) => r.summary?.includes('No failures detected') ?? false,
    )

    return {
      projects,
      recentRuns,
      stats: {
        totalRuns: recentRuns.length,
        passRate:
          completed.length > 0
            ? Math.round((clean.length / completed.length) * 100)
            : null,
        openFindings,
      },
    }
  },
)

export const createProject = createServerFn({ method: 'POST' })
  .validator(createProjectInputSchema)
  .handler(async ({ data }): Promise<Project> => {
    const me = await user()
    // Validated here rather than only in the UI: the server function is the
    // real boundary and can be called directly.
    const target = assertSafeTargetUrl(data.targetUrl)
    const repoUrl = normaliseRepoUrl(data.repoUrl)

    return repo.createProject({
      userId: me.id,
      name: data.name,
      targetUrl: target.toString(),
      repoUrl,
      goal: data.goal,
    })
  })

export const deleteProject = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)
    await repo.deleteProject(data.projectId)
    return { ok: true }
  })

export type ProjectPayload = {
  project: Project
  runs: Run[]
}

export const getProject = createServerFn({ method: 'GET' })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }): Promise<ProjectPayload> => {
    const me = await user()
    const project = await repo.assertProjectAccess(data.projectId, me.id)
    return { project, runs: await repo.listRuns(project.id) }
  })

/* -------------------------------------------------------------------- runs */

export const startVerification = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: idSchema,
      idempotencyKey: z.string().max(80).optional(),
    }),
  )
  .handler(async ({ data }): Promise<Run> => {
    const me = await user()
    return startRun({
      userId: me.id,
      projectId: data.projectId,
      trigger: 'manual',
      idempotencyKey: data.idempotencyKey ?? null,
    })
  })

export const stopRun = createServerFn({ method: 'POST' })
  .validator(z.object({ runId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await cancelRun(data.runId, me.id)
    return { ok: true }
  })

export type RunPayload = {
  run: Run
  project: Project
  journeys: Journey[]
  steps: repo.JourneyStepRow[]
  findings: Finding[]
  evidence: Evidence[]
  events: RunEvent[]
}

export const getRun = createServerFn({ method: 'GET' })
  .validator(z.object({ runId: idSchema }))
  .handler(async ({ data }): Promise<RunPayload> => {
    const me = await user()
    const { run, project } = await repo.assertRunAccess(data.runId, me.id)

    const [journeys, steps, findings, evidence, events] = await Promise.all([
      repo.listJourneys(run.id),
      repo.listJourneySteps(run.id),
      repo.listFindings(run.id),
      listRunEvidence(run.id),
      repo.listEvents(run.id),
    ])

    return { run, project, journeys, steps, findings, evidence, events }
  })

/* ---------------------------------------------------------------- findings */

export type FindingPayload = {
  finding: Finding
  run: Run
  project: Project
  journey: Journey | null
  steps: repo.JourneyStepRow[]
  evidence: Evidence[]
  fixAttempts: repo.FixAttemptRow[]
}

export const getFinding = createServerFn({ method: 'GET' })
  .validator(z.object({ findingId: idSchema }))
  .handler(async ({ data }): Promise<FindingPayload> => {
    const me = await user()
    const { finding, run, project } = await repo.assertFindingAccess(
      data.findingId,
      me.id,
    )

    const [journeys, allSteps, evidence, fixAttempts] = await Promise.all([
      repo.listJourneys(run.id),
      repo.listJourneySteps(run.id),
      listRunEvidence(run.id),
      repo.listFixAttempts(finding.id),
    ])

    const journey = journeys.find((j) => j.id === finding.journeyId) ?? null

    return {
      finding,
      run,
      project,
      journey,
      steps: journey
        ? allSteps.filter((s) => s.journeyId === journey.id)
        : [],
      evidence: evidence.filter(
        (e) => e.findingId === finding.id || e.journeyId === finding.journeyId,
      ),
      fixAttempts,
    }
  })

export const verifyFix = createServerFn({ method: 'POST' })
  .validator(z.object({ findingId: idSchema }))
  .handler(async ({ data }): Promise<Run> => {
    const me = await user()
    const { finding, project } = await repo.assertFindingAccess(
      data.findingId,
      me.id,
    )

    return startRun({
      userId: me.id,
      projectId: project.id,
      trigger: 'verify_fix',
      verifiesFindingId: finding.id,
    })
  })

export const dismissFinding = createServerFn({ method: 'POST' })
  .validator(z.object({ findingId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertFindingAccess(data.findingId, me.id)
    await repo.updateFindingStatus(data.findingId, 'dismissed')
    return { ok: true }
  })
