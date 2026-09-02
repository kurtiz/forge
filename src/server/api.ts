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
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import {
  createApiTokenInputSchema,
  createProjectInputSchema,
  updateProjectInputSchema,
  upsertScheduleInputSchema,
  type ApiToken,
  type Evidence,
  type Finding,
  type GitHubInstallation,
  type Journey,
  type Project,
  type Run,
  type RunEvent,
  type Schedule,
} from './contracts'
import {
  currentUser,
  githubLoginAvailable,
  requireUser,
  type SessionUser,
} from './auth'
import { plannedExecutorKind } from './execution'
import {
  assertSafeTargetUrl,
  CredentialError,
  encryptCredential,
  normaliseLoginPath,
  normaliseRepoUrl,
} from './security'
import * as repo from './runs/repository'
import { cancelRun, startRun } from './runs/service'
import { listRunEvidence } from './evidence/store'
import * as tokens from './tokens/repository'
import * as monitor from './monitoring/repository'
import { githubAppSlug, githubConfigured } from './github/app'
import { listInstallations, unlinkInstallation } from './github/installations'

const idSchema = z.string().min(3).max(64)

async function user(): Promise<SessionUser> {
  return requireUser(getRequest())
}

/* ----------------------------------------------------------------- session */

export type SessionPayload = {
  user: SessionUser | null
  /** Which executor a run started right now would use. */
  executor: 'solari' | 'fetch'
  /** Sign-in methods this deployment can actually complete. */
  providers: { github: boolean }
  /**
   * Whether this is a development deployment. Used only to explain a feature
   * that is switched off for want of configuration, which is a thing worth
   * saying to whoever is building the deployment and nobody else.
   */
  development: boolean
}

export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionPayload> => ({
    user: await currentUser(getRequest()),
    executor: plannedExecutorKind(),
    providers: { github: githubLoginAvailable() },
    development: env.FORGE_ENV === 'development',
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

    // Credentials are optional, but a username without a password (or the
    // reverse) is a half-configured login that would fail confusingly at run
    // time, so it is rejected here rather than discovered later.
    const wantsAuth = Boolean(data.authUsername || data.authPassword)
    if (wantsAuth && !(data.authUsername && data.authPassword)) {
      throw new CredentialError(
        'A test account needs both a username and a password.',
      )
    }

    // Encrypted at the boundary: the plaintext never reaches a query.
    const authPasswordEncrypted = data.authPassword
      ? await encryptCredential(data.authPassword)
      : null

    return repo.createProject({
      userId: me.id,
      name: data.name,
      targetUrl: target.toString(),
      repoUrl,
      goal: data.goal,
      authLoginPath: wantsAuth ? normaliseLoginPath(data.authLoginPath) : null,
      authUsername: data.authUsername,
      authPasswordEncrypted,
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
  schedule: Schedule | null
}

export const getProject = createServerFn({ method: 'GET' })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }): Promise<ProjectPayload> => {
    const me = await user()
    const project = await repo.assertProjectAccess(data.projectId, me.id)
    const [runs, schedule] = await Promise.all([
      repo.listRuns(project.id),
      monitor.getSchedule(project.id),
    ])
    return { project, runs, schedule }
  })

export const updateProject = createServerFn({ method: 'POST' })
  .validator(updateProjectInputSchema)
  .handler(async ({ data }): Promise<Project> => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)
    await repo.updateProject(data.projectId, {
      previewUrlTemplate: data.previewUrlTemplate,
    })
    return repo.assertProjectAccess(data.projectId, me.id)
  })

/* --------------------------------------------------------------- monitoring */

/**
 * Scheduled monitoring for one project. Disabling clears the due time rather
 * than deleting the row, so the cadence and the webhook survive being paused.
 */
export const saveSchedule = createServerFn({ method: 'POST' })
  .validator(upsertScheduleInputSchema)
  .handler(async ({ data }): Promise<Schedule> => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)

    // A notification URL is fetched by the Worker, so it gets the same policy
    // as a verification target rather than being trusted because it is ours.
    if (data.notifyUrl) assertSafeTargetUrl(data.notifyUrl)

    return monitor.upsertSchedule({
      projectId: data.projectId,
      cadenceMinutes: data.cadenceMinutes,
      enabled: data.enabled,
      notifyUrl: data.notifyUrl,
    })
  })

export const removeSchedule = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)
    await monitor.deleteSchedule(data.projectId)
    return { ok: true }
  })

/* ------------------------------------------------------------- settings */

export type SettingsPayload = {
  tokens: ApiToken[]
  installations: GitHubInstallation[]
  github: {
    configured: boolean
    /** Where to send someone to install the app, when there is one. */
    installUrl: string | null
  }
  /** Guests cannot hold tokens; the UI explains why rather than failing. */
  isAnonymous: boolean
}

export const getSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SettingsPayload> => {
    const me = await user()
    const slug = githubAppSlug()

    const [list, installations] = await Promise.all([
      me.isAnonymous ? Promise.resolve([]) : tokens.listTokens(me.id),
      me.isAnonymous ? Promise.resolve([]) : listInstallations(me.id),
    ])

    return {
      tokens: list,
      installations,
      github: {
        configured: githubConfigured(),
        installUrl: slug ? `https://github.com/apps/${slug}/installations/new` : null,
      },
      isAnonymous: me.isAnonymous,
    }
  },
)

/**
 * Creates a token and returns it once. The plaintext exists in this response
 * and nowhere else: only its hash is stored, so a lost token is replaced, not
 * recovered.
 */
export const createApiToken = createServerFn({ method: 'POST' })
  .validator(createApiTokenInputSchema)
  .handler(async ({ data }): Promise<{ token: string; record: ApiToken }> => {
    const me = await user()
    if (me.isAnonymous) {
      throw new tokens.TokenError(
        'Create an account before issuing API tokens. A guest session is deleted along with its tokens.',
      )
    }
    return tokens.createToken({ userId: me.id, name: data.name })
  })

export const revokeApiToken = createServerFn({ method: 'POST' })
  .validator(z.object({ tokenId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await tokens.revokeToken(data.tokenId, me.id)
    return { ok: true }
  })

export const disconnectInstallation = createServerFn({ method: 'POST' })
  .validator(z.object({ installationId: z.string().min(1).max(40) }))
  .handler(async ({ data }) => {
    const me = await user()
    await unlinkInstallation(data.installationId, me.id)
    return { ok: true }
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
