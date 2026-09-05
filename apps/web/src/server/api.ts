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
  createCredentialInputSchema,
  createProjectHeaderInputSchema,
  createProjectInputSchema,
  createProjectJourneyInputSchema,
  createSampleValueInputSchema,
  updateCredentialInputSchema,
  updateProjectInputSchema,
  updateProjectJourneyInputSchema,
  updateSampleValueInputSchema,
  upsertScheduleInputSchema,
  type ApiToken,
  type Evidence,
  type Finding,
  type GitHubInstallation,
  type Journey,
  type Project,
  type ProjectCredential,
  type ProjectHeader,
  type ProjectJourney,
  type ProjectSampleValue,
  type Run,
  type RunEvent,
  type Schedule,
} from './contracts'
import {
  currentUser,
  githubLoginAvailable,
  guestAccessAvailable,
  requireUser,
  type SessionUser,
} from './auth'
import { plannedExecutorKind } from './execution'
import { remediationFor, type Remediation } from './domain/remediation'
import {
  assertSafeTargetUrl,
  CredentialError,
  encryptCredential,
  normaliseHeaderName,
  normaliseHeaderValue,
  normaliseLoginPath,
  normaliseRepoUrl,
} from './security'
import * as repo from './runs/repository'
import { cancelRun, startRun } from './runs/service'
import { listRunEvidence } from './evidence/store'
import { requestProjectDeletion } from './cleanup'
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
  /**
   * Sign-in methods this deployment can actually complete. Both are decided by
   * the server: the page renders what is offered rather than deciding policy.
   */
  providers: { github: boolean; guest: boolean }
  /**
   * Whether the GitHub App is configured. Pull request verification is built
   * on it, so a deployment without it does not offer that feature anywhere in
   * the console rather than describing something that cannot happen.
   */
  githubApp: boolean
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
    providers: {
      github: githubLoginAvailable(),
      guest: guestAccessAvailable(),
    },
    githubApp: githubConfigured(),
    development: env.FORGE_ENV === 'development',
  }),
)

/* ----------------------------------------------------------------- profile */

export type ProfilePayload = {
  user: SessionUser & {
    image: string | null
    createdAt: string
    /** Social providers linked to this account, for display. */
    providers: string[]
  }
  stats: { projects: number; runs: number; openFindings: number }
}

export const getProfile = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProfilePayload> => {
    const me = await user()
    const [account, stats] = await Promise.all([
      repo.readAccount(me.id),
      repo.accountStats(me.id),
    ])

    return {
      user: {
        ...me,
        image: account?.image ?? null,
        createdAt: account?.createdAt ?? new Date().toISOString(),
        providers: account?.providers ?? [],
      },
      stats,
    }
  },
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

    const project = await repo.createProject({
      userId: me.id,
      name: data.name,
      targetUrl: target.toString(),
      repoUrl,
      goal: data.goal,
    })

    if (wantsAuth && data.authUsername && data.authPassword) {
      await repo.insertProjectCredential({
        projectId: project.id,
        label: data.authLabel ?? 'Test account',
        loginPath: normaliseLoginPath(data.authLoginPath),
        username: data.authUsername,
        // Encrypted at the boundary: the plaintext never reaches a query.
        passwordEncrypted: await encryptCredential(data.authPassword),
        isDefault: true,
      })
      return { ...project, credentialCount: 1 }
    }

    return project
  })

/* ------------------------------------------------------- test accounts */

/**
 * Adds a test account to a project.
 *
 * An application worth verifying usually has more than one kind of user, and
 * what an administrator can reach is not what a member can reach. A project
 * holds one account per role; runs sign in with the one marked default.
 */
export const addCredential = createServerFn({ method: 'POST' })
  .validator(createCredentialInputSchema)
  .handler(async ({ data }): Promise<ProjectCredential> => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)

    const existing = await repo.listProjectCredentials(data.projectId)

    return repo.insertProjectCredential({
      projectId: data.projectId,
      label: data.label,
      loginPath: normaliseLoginPath(data.loginPath),
      username: data.username,
      passwordEncrypted: await encryptCredential(data.password),
      // The first account a project gets is its default whether or not the
      // form said so, because a project with accounts and no default would
      // leave the run engine picking one arbitrarily.
      isDefault: data.isDefault === true || existing.length === 0,
    })
  })

/**
 * Edits a test account. A blank password keeps the stored one, which is what
 * makes it possible to correct a label or a login path later.
 */
export const editCredential = createServerFn({ method: 'POST' })
  .validator(updateCredentialInputSchema)
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertCredentialAccess(data.credentialId, me.id)

    await repo.updateProjectCredential(data.credentialId, {
      label: data.label,
      loginPath: normaliseLoginPath(data.loginPath),
      username: data.username,
      ...(data.password
        ? { passwordEncrypted: await encryptCredential(data.password) }
        : {}),
    })

    return { ok: true }
  })

export const removeCredential = createServerFn({ method: 'POST' })
  .validator(z.object({ credentialId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    const { credential, project } = await repo.assertCredentialAccess(
      data.credentialId,
      me.id,
    )
    await repo.deleteProjectCredential(data.credentialId)

    /*
     * Deleting the default promotes whatever is left, so a project never ends
     * up with accounts but no default and a run signing in as nobody in
     * particular.
     */
    if (credential.isDefault) {
      const [next] = await repo.listProjectCredentials(project.id)
      if (next) await repo.setDefaultCredential(project.id, next.id)
    }

    return { ok: true }
  })

export const makeCredentialDefault = createServerFn({ method: 'POST' })
  .validator(z.object({ credentialId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    const { project } = await repo.assertCredentialAccess(data.credentialId, me.id)
    await repo.setDefaultCredential(project.id, data.credentialId)
    return { ok: true }
  })

/* ------------------------------------------------------- the project's plan */

/**
 * Adds a journey the project wants verified every run.
 *
 * Discovery is a guess, and the journey a team actually cares about is not
 * always the one a model ranks first. A planned journey runs before any
 * discovered one and is never re-invented under a different name.
 */
export const addProjectJourney = createServerFn({ method: 'POST' })
  .validator(createProjectJourneyInputSchema)
  .handler(async ({ data }): Promise<ProjectJourney> => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)

    return repo.insertProjectJourney({
      projectId: data.projectId,
      name: data.name,
      // A journey with no goal is still a journey: the name is what the
      // Operator matches on, and the goal only sharpens it.
      goal: data.goal || data.name,
      entryPath: data.entryPath,
      priority: data.priority,
      enabled: data.enabled ?? true,
    })
  })

export const editProjectJourney = createServerFn({ method: 'POST' })
  .validator(updateProjectJourneyInputSchema)
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertPlannedJourneyAccess(data.journeyId, me.id)

    await repo.updateProjectJourney(data.journeyId, {
      name: data.name,
      goal: data.goal || data.name,
      entryPath: data.entryPath,
      priority: data.priority,
      ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
    })

    return { ok: true }
  })

export const removeProjectJourney = createServerFn({ method: 'POST' })
  .validator(z.object({ journeyId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertPlannedJourneyAccess(data.journeyId, me.id)
    await repo.deleteProjectJourney(data.journeyId)
    return { ok: true }
  })

/**
 * Adds a value that is true of the target application.
 *
 * The agent invents what it types, and invented data is right up until the
 * application checks it against itself - a form that looks a patient up by
 * phone number will not find one for a number Forge made up. Never a
 * credential: these are shown back in the console and written into evidence.
 */
export const addSampleValue = createServerFn({ method: 'POST' })
  .validator(createSampleValueInputSchema)
  .handler(async ({ data }): Promise<ProjectSampleValue> => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)
    return repo.insertProjectSampleValue({
      projectId: data.projectId,
      label: data.label,
      value: data.value,
    })
  })

export const editSampleValue = createServerFn({ method: 'POST' })
  .validator(updateSampleValueInputSchema)
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertSampleValueAccess(data.sampleValueId, me.id)
    await repo.updateProjectSampleValue(data.sampleValueId, {
      label: data.label,
      value: data.value,
    })
    return { ok: true }
  })

export const removeSampleValue = createServerFn({ method: 'POST' })
  .validator(z.object({ sampleValueId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertSampleValueAccess(data.sampleValueId, me.id)
    await repo.deleteProjectSampleValue(data.sampleValueId)
    return { ok: true }
  })

/* ------------------------------------------------------- request headers */

/**
 * Stores one header Forge will send to this project's target.
 *
 * The value takes the same path as a stored password: validated, encrypted
 * here, and never returned. A name that already exists has its value replaced,
 * so rotating a secret is one paste rather than a delete and an add.
 */
export const addProjectHeader = createServerFn({ method: 'POST' })
  .validator(createProjectHeaderInputSchema)
  .handler(async ({ data }): Promise<ProjectHeader> => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)

    return repo.upsertProjectHeader({
      projectId: data.projectId,
      name: normaliseHeaderName(data.name),
      valueEncrypted: await encryptCredential(normaliseHeaderValue(data.value)),
    })
  })

export const removeProjectHeader = createServerFn({ method: 'POST' })
  .validator(z.object({ headerId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertHeaderAccess(data.headerId, me.id)
    await repo.deleteProjectHeader(data.headerId)
    return { ok: true }
  })

/**
 * Deletes a project and everything it produced.
 *
 * Returns as soon as the project is invisible. Its evidence in R2 is removed by
 * the cleanup queue, which can take a while for a project with a long history
 * and must not hold up the request that asked for it.
 */
export const deleteProject = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }) => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)
    await requestProjectDeletion(data.projectId)
    return { ok: true }
  })

export type ProjectPayload = {
  project: Project
  runs: Run[]
  schedule: Schedule | null
  credentials: ProjectCredential[]
  plannedJourneys: ProjectJourney[]
  sampleValues: ProjectSampleValue[]
  /** Names only. The values never leave the server. */
  headers: ProjectHeader[]
}

export const getProject = createServerFn({ method: 'GET' })
  .validator(z.object({ projectId: idSchema }))
  .handler(async ({ data }): Promise<ProjectPayload> => {
    const me = await user()
    const project = await repo.assertProjectAccess(data.projectId, me.id)
    const [runs, schedule, credentials, plannedJourneys, sampleValues, headers] =
      await Promise.all([
        repo.listRuns(project.id),
        monitor.getSchedule(project.id),
        repo.listProjectCredentials(project.id),
        repo.listProjectJourneys(project.id),
        repo.listProjectSampleValues(project.id),
        repo.listProjectHeaders(project.id),
      ])
    return {
      project,
      runs,
      schedule,
      credentials,
      plannedJourneys,
      sampleValues,
      headers,
    }
  })

export const updateProject = createServerFn({ method: 'POST' })
  .validator(updateProjectInputSchema)
  .handler(async ({ data }): Promise<Project> => {
    const me = await user()
    await repo.assertProjectAccess(data.projectId, me.id)
    await repo.updateProject(data.projectId, {
      previewUrlTemplate: data.previewUrlTemplate,
      // Absent means "leave it": the preview pattern and the stated priority
      // are edited from different places on the page.
      ...(data.goal === undefined ? {} : { goal: data.goal }),
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
  /**
   * What to do about it, derived here rather than in the page.
   *
   * It is a function of the finding and its evidence, so it belongs next to
   * them and not in a component - and computing it on the server keeps the
   * whole rule set out of the browser bundle.
   */
  remediation: Remediation
}

export const getFinding = createServerFn({ method: 'GET' })
  .validator(z.object({ findingId: idSchema }))
  .handler(async ({ data }): Promise<FindingPayload> => {
    const me = await user()
    const { finding, run, project } = await repo.assertFindingAccess(
      data.findingId,
      me.id,
    )

    const [journeys, allSteps, evidence, fixAttempts, headers] =
      await Promise.all([
        repo.listJourneys(run.id),
        repo.listJourneySteps(run.id),
        listRunEvidence(run.id),
        repo.listFixAttempts(finding.id),
        // Names only, and only to shape the advice: a project that already
        // sends a header gets told to write the rule, not to invent a secret.
        repo.listProjectHeaders(project.id),
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
      remediation: remediationFor({
        finding,
        run: { targetUrl: run.targetUrl, executor: run.executor },
        journey: journey
          ? { name: journey.name, goal: journey.goal, entryPath: journey.entryPath }
          : null,
        steps: journey
          ? allSteps.filter((s) => s.journeyId === journey.id)
          : [],
        verificationHeaders: headers.map((header) => header.name),
      }),
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
