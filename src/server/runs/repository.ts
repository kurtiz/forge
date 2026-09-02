/**
 * Run data access and authorization.
 *
 * Every read is scoped by owner. Nothing above this module is allowed to load a
 * run, journey, finding, or artifact by id alone: `assert*Access` is the only
 * door, so a client-supplied id can never reach data it does not own.
 *
 * Row shapes come from the Drizzle schema, so a column rename is a type error
 * here rather than a runtime surprise. The mapping functions exist because the
 * database row and the API contract are allowed to diverge: `affectedFiles` is
 * JSON text in D1 and a string array on the wire.
 */
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db, newId, nowIso, parseJson, tables } from '../db'
import type {
  Classification,
  FailureClass,
  Finding,
  ProjectCredential,
  ProjectJourney,
  ProjectSampleValue,
  Journey,
  JourneyStatus,
  JsonValue,
  Project,
  Run,
  RunEvent,
  RunStatus,
  Severity,
} from '../contracts'


export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found.`)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('You do not have access to that resource.')
    this.name = 'ForbiddenError'
  }
}

type ProjectRow = typeof tables.projects.$inferSelect
type RunRow = typeof tables.runs.$inferSelect
type JourneyRow = typeof tables.journeys.$inferSelect
type FindingRow = typeof tables.findings.$inferSelect
type EventRow = typeof tables.runEvents.$inferSelect

export type JourneyStepRow = typeof tables.journeySteps.$inferSelect
export type FixAttemptRow = typeof tables.fixAttempts.$inferSelect

/* -------------------------------------------------------------- projects */

/**
 * Row to contract. `authPasswordEncrypted` is deliberately not carried across:
 * the ciphertext has no field in `Project`, so it cannot escape through an API
 * response. Only the run engine reads it, via `readProjectCredentials`.
 */
/**
 * A project awaiting deletion is gone as far as everything above this module is
 * concerned. Applied to every query that can reach one, including the ones that
 * spend money - scheduled runs and webhook-triggered runs - so a delete stops
 * the billing immediately rather than when the last artifact is swept up.
 */
const live = isNull(tables.projects.deletedAt)

/**
 * Row to contract.
 *
 * Credentials live in their own table with their own contract, and neither has
 * a field for a ciphertext, so a password cannot escape through an API response
 * by being forgotten in a mapper. Only the run engine reads one, by name, via
 * `readProjectCredentials`.
 */
const toProject = (r: ProjectRow, credentialCount = 0): Project => ({
  id: r.id,
  userId: r.userId,
  name: r.name,
  targetUrl: r.targetUrl,
  repoUrl: r.repoUrl,
  goal: r.goal,
  credentialCount,
  previewUrlTemplate: r.previewUrlTemplate,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

/** How many test accounts each of these projects holds. */
async function credentialCounts(
  projectIds: string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map()

  const rows = await db()
    .select({
      projectId: tables.projectCredentials.projectId,
      total: count(),
    })
    .from(tables.projectCredentials)
    .where(inArray(tables.projectCredentials.projectId, projectIds))
    .groupBy(tables.projectCredentials.projectId)

  return new Map(rows.map((r) => [r.projectId, r.total]))
}

export async function createProject(input: {
  userId: string
  name: string
  targetUrl: string
  repoUrl: string | null
  goal: string | null
}): Promise<Project> {
  const at = nowIso()
  const [row] = await db()
    .insert(tables.projects)
    .values({ ...input, id: newId('prj'), createdAt: at, updatedAt: at })
    .returning()

  return toProject(row)
}

export type StoredCredentials = {
  id: string
  label: string
  loginPath: string
  username: string
  passwordEncrypted: string
  profileId: string | null
}

type CredentialRow = typeof tables.projectCredentials.$inferSelect

/**
 * Row to contract, for credentials. `passwordEncrypted` is deliberately not
 * carried across: `ProjectCredential` has no field for it.
 */
const toCredential = (r: CredentialRow): ProjectCredential => ({
  id: r.id,
  projectId: r.projectId,
  label: r.label,
  loginPath: r.loginPath,
  username: r.username,
  isDefault: r.isDefault,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

export async function listProjectCredentials(
  projectId: string,
): Promise<ProjectCredential[]> {
  const rows = await db()
    .select()
    .from(tables.projectCredentials)
    .where(eq(tables.projectCredentials.projectId, projectId))
    .orderBy(desc(tables.projectCredentials.isDefault), tables.projectCredentials.createdAt)

  return rows.map(toCredential)
}

/**
 * The one path that reads a stored ciphertext.
 *
 * Separate from every other read on purpose: a caller has to ask for
 * credentials by name, so they cannot be returned by accident. Called only from
 * the run engine, and decrypted only inside the run Durable Object.
 *
 * A project may hold several accounts, one per role. A run signs in with the
 * one marked default, falling back to the oldest so a project whose default was
 * deleted still signs in.
 */
export async function readProjectCredentials(
  projectId: string,
): Promise<StoredCredentials | null> {
  const [project] = await db()
    .select({ id: tables.projects.id })
    .from(tables.projects)
    .where(and(eq(tables.projects.id, projectId), live))
    .limit(1)

  if (!project) return null

  const [row] = await db()
    .select()
    .from(tables.projectCredentials)
    .where(eq(tables.projectCredentials.projectId, projectId))
    .orderBy(desc(tables.projectCredentials.isDefault), tables.projectCredentials.createdAt)
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    label: row.label,
    loginPath: row.loginPath,
    username: row.username,
    passwordEncrypted: row.passwordEncrypted,
    profileId: row.profileId,
  }
}

export async function insertProjectCredential(input: {
  projectId: string
  label: string
  loginPath: string
  username: string
  passwordEncrypted: string
  isDefault: boolean
}): Promise<ProjectCredential> {
  const at = nowIso()

  // One default per project, so the run engine never has to choose.
  if (input.isDefault) await clearDefaultCredential(input.projectId)

  const [row] = await db()
    .insert(tables.projectCredentials)
    .values({ ...input, id: newId('pcr'), createdAt: at, updatedAt: at })
    .returning()

  return toCredential(row)
}

export async function updateProjectCredential(
  credentialId: string,
  patch: Partial<{
    label: string
    loginPath: string
    username: string
    passwordEncrypted: string
  }>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await db()
    .update(tables.projectCredentials)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(tables.projectCredentials.id, credentialId))
}

export async function deleteProjectCredential(credentialId: string): Promise<void> {
  await db()
    .delete(tables.projectCredentials)
    .where(eq(tables.projectCredentials.id, credentialId))
}

/* ------------------------------------------------------- the project's plan */

const toPlannedJourney = (
  r: typeof tables.projectJourneys.$inferSelect,
): ProjectJourney => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  goal: r.goal,
  entryPath: r.entryPath,
  priority: r.priority,
  enabled: r.enabled,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

export async function listProjectJourneys(
  projectId: string,
): Promise<ProjectJourney[]> {
  const rows = await db()
    .select()
    .from(tables.projectJourneys)
    .where(eq(tables.projectJourneys.projectId, projectId))
    .orderBy(desc(tables.projectJourneys.priority), tables.projectJourneys.createdAt)

  return rows.map(toPlannedJourney)
}

export async function insertProjectJourney(input: {
  projectId: string
  name: string
  goal: string
  entryPath: string
  priority: number
  enabled: boolean
}): Promise<ProjectJourney> {
  const at = nowIso()
  const [row] = await db()
    .insert(tables.projectJourneys)
    .values({ ...input, id: newId('pjy'), createdAt: at, updatedAt: at })
    .returning()

  return toPlannedJourney(row)
}

export async function updateProjectJourney(
  journeyId: string,
  patch: Partial<{
    name: string
    goal: string
    entryPath: string
    priority: number
    enabled: boolean
  }>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await db()
    .update(tables.projectJourneys)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(tables.projectJourneys.id, journeyId))
}

export async function deleteProjectJourney(journeyId: string): Promise<void> {
  await db()
    .delete(tables.projectJourneys)
    .where(eq(tables.projectJourneys.id, journeyId))
}

/** Ownership for a planned journey, through the project that holds it. */
export async function assertPlannedJourneyAccess(
  journeyId: string,
  userId: string,
): Promise<{ journey: ProjectJourney; project: Project }> {
  const [row] = await db()
    .select()
    .from(tables.projectJourneys)
    .where(eq(tables.projectJourneys.id, journeyId))
    .limit(1)

  if (!row) throw new NotFoundError('Journey')
  const project = await assertProjectAccess(row.projectId, userId)
  return { journey: toPlannedJourney(row), project }
}

const toSampleValue = (
  r: typeof tables.projectSampleValues.$inferSelect,
): ProjectSampleValue => ({
  id: r.id,
  projectId: r.projectId,
  label: r.label,
  value: r.value,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

export async function listProjectSampleValues(
  projectId: string,
): Promise<ProjectSampleValue[]> {
  const rows = await db()
    .select()
    .from(tables.projectSampleValues)
    .where(eq(tables.projectSampleValues.projectId, projectId))
    .orderBy(tables.projectSampleValues.createdAt)

  return rows.map(toSampleValue)
}

export async function insertProjectSampleValue(input: {
  projectId: string
  label: string
  value: string
}): Promise<ProjectSampleValue> {
  const at = nowIso()
  const [row] = await db()
    .insert(tables.projectSampleValues)
    .values({ ...input, id: newId('psv'), createdAt: at, updatedAt: at })
    .returning()

  return toSampleValue(row)
}

export async function updateProjectSampleValue(
  sampleValueId: string,
  patch: Partial<{ label: string; value: string }>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await db()
    .update(tables.projectSampleValues)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(tables.projectSampleValues.id, sampleValueId))
}

export async function deleteProjectSampleValue(
  sampleValueId: string,
): Promise<void> {
  await db()
    .delete(tables.projectSampleValues)
    .where(eq(tables.projectSampleValues.id, sampleValueId))
}

export async function assertSampleValueAccess(
  sampleValueId: string,
  userId: string,
): Promise<{ sampleValue: ProjectSampleValue; project: Project }> {
  const [row] = await db()
    .select()
    .from(tables.projectSampleValues)
    .where(eq(tables.projectSampleValues.id, sampleValueId))
    .limit(1)

  if (!row) throw new NotFoundError('Sample value')
  const project = await assertProjectAccess(row.projectId, userId)
  return { sampleValue: toSampleValue(row), project }
}

async function clearDefaultCredential(projectId: string): Promise<void> {
  await db()
    .update(tables.projectCredentials)
    .set({ isDefault: false })
    .where(eq(tables.projectCredentials.projectId, projectId))
}

export async function setDefaultCredential(
  projectId: string,
  credentialId: string,
): Promise<void> {
  await clearDefaultCredential(projectId)
  await db()
    .update(tables.projectCredentials)
    .set({ isDefault: true, updatedAt: nowIso() })
    .where(eq(tables.projectCredentials.id, credentialId))
}

/**
 * Resolves a credential to its project, scoped by owner. The only door to a
 * credential, for the same reason `assertProjectAccess` is the only door to a
 * project.
 */
export async function assertCredentialAccess(
  credentialId: string,
  userId: string,
): Promise<{ credential: ProjectCredential; project: Project }> {
  const [row] = await db()
    .select({ credential: tables.projectCredentials, project: tables.projects })
    .from(tables.projectCredentials)
    .innerJoin(
      tables.projects,
      eq(tables.projects.id, tables.projectCredentials.projectId),
    )
    .where(and(eq(tables.projectCredentials.id, credentialId), live))
    .limit(1)

  if (!row) throw new NotFoundError('Credential')
  if (row.project.userId !== userId) throw new ForbiddenError()

  return {
    credential: toCredential(row.credential),
    project: toProject(row.project),
  }
}

/** Records the Solari profile that now holds a signed-in state between runs. */
export async function saveCredentialProfileId(
  credentialId: string,
  profileId: string,
): Promise<void> {
  await db()
    .update(tables.projectCredentials)
    .set({ profileId, updatedAt: nowIso() })
    .where(eq(tables.projectCredentials.id, credentialId))
}

/**
 * The project a user already has for a target, if any. Used by the REST API so
 * `forge verify --url X` twice does not create two projects for one site.
 */
export async function findProjectByTarget(
  userId: string,
  targetUrl: string,
): Promise<Project | null> {
  const [row] = await db()
    .select()
    .from(tables.projects)
    .where(
      and(
        eq(tables.projects.userId, userId),
        eq(tables.projects.targetUrl, targetUrl),
        live,
      ),
    )
    .orderBy(desc(tables.projects.createdAt))
    .limit(1)

  return row ? toProject(row) : null
}

/**
 * Projects owned by `userId` that point at a GitHub repository. Matched by the
 * normalised URL, case-insensitively, since GitHub names are.
 */
export async function listProjectsForRepo(
  userId: string,
  repoFullName: string,
): Promise<Project[]> {
  const rows = await db()
    .select()
    .from(tables.projects)
    .where(
      and(
        eq(tables.projects.userId, userId),
        sql`lower(${tables.projects.repoUrl}) = ${`https://github.com/${repoFullName.toLowerCase()}`}`,
        live,
      ),
    )

  return rows.map(toProject)
}

export async function updateProject(
  projectId: string,
  patch: Partial<{ previewUrlTemplate: string | null }>,
): Promise<void> {
  await db()
    .update(tables.projects)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(tables.projects.id, projectId))
}

export async function listProjects(userId: string): Promise<Project[]> {
  const rows = await db()
    .select()
    .from(tables.projects)
    .where(and(eq(tables.projects.userId, userId), live))
    .orderBy(desc(tables.projects.createdAt))
    .limit(100)

  const counts = await credentialCounts(rows.map((r) => r.id))
  return rows.map((r) => toProject(r, counts.get(r.id) ?? 0))
}

export async function assertProjectAccess(
  projectId: string,
  userId: string,
): Promise<Project> {
  const [row] = await db()
    .select()
    .from(tables.projects)
    .where(and(eq(tables.projects.id, projectId), live))
    .limit(1)

  if (!row) throw new NotFoundError('Project')
  if (row.userId !== userId) throw new ForbiddenError()

  const counts = await credentialCounts([row.id])
  return toProject(row, counts.get(row.id) ?? 0)
}

/**
 * Marks a project deleted. The row and its artifacts are removed by the
 * cleanup queue; until then nothing can read it, run it, or bill for it.
 */
export async function markProjectDeleted(projectId: string): Promise<void> {
  const at = nowIso()
  await db()
    .update(tables.projects)
    .set({ deletedAt: at, updatedAt: at })
    .where(eq(tables.projects.id, projectId))
}

/** Projects marked deleted, oldest first, for the cleanup consumer to finish. */
export async function listDeletedProjectIds(limit = 50): Promise<string[]> {
  const rows = await db()
    .select({ id: tables.projects.id })
    .from(tables.projects)
    .where(sql`${tables.projects.deletedAt} IS NOT NULL`)
    .orderBy(tables.projects.deletedAt)
    .limit(limit)

  return rows.map((r) => r.id)
}

/**
 * The next runs still holding artifacts for a project.
 *
 * Bounded on purpose: cleanup walks a project a few runs at a time so one
 * enormous project cannot exceed a queue consumer's time budget, and the work
 * left to do is simply the runs that are still there.
 */
export async function listRunIdsForProject(
  projectId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db()
    .select({ id: tables.runs.id })
    .from(tables.runs)
    .where(eq(tables.runs.projectId, projectId))
    .orderBy(tables.runs.createdAt)
    .limit(limit)

  return rows.map((r) => r.id)
}

/** Removes runs and everything that cascades from them: journeys, findings, evidence, events. */
export async function hardDeleteRuns(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return
  await db().delete(tables.runs).where(inArray(tables.runs.id, runIds))
}

/** The last step of a deletion, once no artifact of the project remains. */
export async function hardDeleteProject(projectId: string): Promise<void> {
  await db().delete(tables.projects).where(eq(tables.projects.id, projectId))
}

/* --------------------------------------------------------------- accounts */

/**
 * The parts of an account the profile page shows. Better Auth owns these rows;
 * this reads them rather than duplicating the information elsewhere.
 */
export async function readAccount(userId: string): Promise<{
  image: string | null
  createdAt: string
  providers: string[]
} | null> {
  const [row] = await db()
    .select()
    .from(tables.user)
    .where(eq(tables.user.id, userId))
    .limit(1)

  if (!row) return null

  const linked = await db()
    .select({ providerId: tables.account.providerId })
    .from(tables.account)
    .where(eq(tables.account.userId, userId))

  return {
    image: row.image,
    createdAt: row.createdAt.toISOString(),
    // "credential" is Better Auth's name for email and password; the profile
    // page says that in words rather than showing the internal id.
    providers: [
      ...new Set(
        linked
          .map((a) => a.providerId)
          .filter((id) => id !== 'credential')
          .map((id) => id[0].toUpperCase() + id.slice(1)),
      ),
    ],
  }
}

export async function accountStats(userId: string): Promise<{
  projects: number
  runs: number
  openFindings: number
}> {
  const [projectRow] = await db()
    .select({ total: count() })
    .from(tables.projects)
    .where(and(eq(tables.projects.userId, userId), live))

  const [runRow] = await db()
    .select({ total: count() })
    .from(tables.runs)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.runs.projectId))
    .where(and(eq(tables.projects.userId, userId), live))

  return {
    projects: projectRow?.total ?? 0,
    runs: runRow?.total ?? 0,
    openFindings: await countOpenBugs(userId),
  }
}

/* ------------------------------------------------------------------ runs */

const toRun = (r: RunRow): Run => ({
  id: r.id,
  projectId: r.projectId,
  status: r.status,
  trigger: r.trigger,
  executor: r.executor,
  targetUrl: r.targetUrl,
  repoUrl: r.repoUrl,
  sessionId: r.sessionId,
  replayUrl: r.replayUrl,
  verifiesFindingId: r.verifiesFindingId,
  commitSha: r.commitSha,
  pullRequestNumber: r.pullRequestNumber,
  summary: r.summary,
  startedAt: r.startedAt,
  completedAt: r.completedAt,
  createdAt: r.createdAt,
})

/** The GitHub columns, read only by the check publisher. */
export type RunGitHubRow = Pick<
  RunRow,
  'commitSha' | 'pullRequestNumber' | 'githubInstallationId' | 'checkRunId'
>

export async function createRun(input: {
  projectId: string
  targetUrl: string
  repoUrl: string | null
  executor: Run['executor']
  trigger: Run['trigger']
  verifiesFindingId: string | null
  idempotencyKey: string | null
  commitSha?: string | null
  pullRequestNumber?: number | null
  githubInstallationId?: string | null
}): Promise<Run> {
  if (input.idempotencyKey) {
    const [existing] = await db()
      .select()
      .from(tables.runs)
      .where(
        and(
          eq(tables.runs.projectId, input.projectId),
          eq(tables.runs.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1)

    // A retried request must not create a second billable browser session.
    if (existing) return toRun(existing)
  }

  const [row] = await db()
    .insert(tables.runs)
    .values({
      ...input,
      id: newId('run'),
      status: 'queued',
      createdAt: nowIso(),
    })
    .returning()

  return toRun(row)
}

export async function getRun(runId: string): Promise<Run | null> {
  const [row] = await db()
    .select()
    .from(tables.runs)
    .where(eq(tables.runs.id, runId))
    .limit(1)

  return row ? toRun(row) : null
}

/** Whether a run already has a GitHub check open against it. */
export async function runCheckRunId(runId: string): Promise<string | null> {
  const [row] = await db()
    .select({ checkRunId: tables.runs.checkRunId })
    .from(tables.runs)
    .where(eq(tables.runs.id, runId))
    .limit(1)

  return row?.checkRunId ?? null
}

/** A run with its project and the GitHub columns, for post-run publishing. */
export async function getRunForCompletion(runId: string): Promise<{
  run: Run
  project: Project
  github: RunGitHubRow
} | null> {
  const [row] = await db()
    .select({ run: tables.runs, project: tables.projects })
    .from(tables.runs)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.runs.projectId))
    .where(eq(tables.runs.id, runId))
    .limit(1)

  if (!row) return null
  return {
    run: toRun(row.run),
    project: toProject(row.project),
    github: {
      commitSha: row.run.commitSha,
      pullRequestNumber: row.run.pullRequestNumber,
      githubInstallationId: row.run.githubInstallationId,
      checkRunId: row.run.checkRunId,
    },
  }
}

export async function assertRunAccess(
  runId: string,
  userId: string,
): Promise<{ run: Run; project: Project }> {
  const [row] = await db()
    .select({ run: tables.runs, project: tables.projects })
    .from(tables.runs)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.runs.projectId))
    .where(and(eq(tables.runs.id, runId), live))
    .limit(1)

  if (!row) throw new NotFoundError('Run')
  if (row.project.userId !== userId) throw new ForbiddenError()
  return { run: toRun(row.run), project: toProject(row.project) }
}

export async function listRuns(projectId: string, limit = 30): Promise<Run[]> {
  const rows = await db()
    .select()
    .from(tables.runs)
    .where(eq(tables.runs.projectId, projectId))
    .orderBy(desc(tables.runs.createdAt))
    .limit(limit)

  return rows.map(toRun)
}

export async function listRecentRunsForUser(
  userId: string,
  limit = 12,
): Promise<Array<Run & { projectName: string }>> {
  const rows = await db()
    .select({ run: tables.runs, projectName: tables.projects.name })
    .from(tables.runs)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.runs.projectId))
    .where(and(eq(tables.projects.userId, userId), live))
    .orderBy(desc(tables.runs.createdAt))
    .limit(limit)

  return rows.map((r) => ({ ...toRun(r.run), projectName: r.projectName }))
}

export async function updateRun(
  runId: string,
  patch: Partial<{
    status: RunStatus
    sessionId: string | null
    replayUrl: string | null
    summary: string | null
    error: string | null
    startedAt: string | null
    completedAt: string | null
    checkRunId: string | null
  }>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await db().update(tables.runs).set(patch).where(eq(tables.runs.id, runId))
}

/* -------------------------------------------------------------- journeys */

const toJourney = (r: JourneyRow): Journey => ({
  id: r.id,
  runId: r.runId,
  name: r.name,
  goal: r.goal,
  entryPath: r.entryPath,
  priority: r.priority,
  status: r.status,
  confidence: r.confidence,
  createdAt: r.createdAt,
})

export async function insertJourney(input: {
  runId: string
  name: string
  goal: string
  entryPath: string
  priority: number
}): Promise<Journey> {
  const [row] = await db()
    .insert(tables.journeys)
    .values({
      ...input,
      id: newId('jny'),
      status: 'pending',
      createdAt: nowIso(),
    })
    .returning()

  return toJourney(row)
}

export async function updateJourneyStatus(
  journeyId: string,
  status: JourneyStatus,
): Promise<void> {
  await db()
    .update(tables.journeys)
    .set({ status })
    .where(eq(tables.journeys.id, journeyId))
}

export async function listJourneys(runId: string): Promise<Journey[]> {
  const rows = await db()
    .select()
    .from(tables.journeys)
    .where(eq(tables.journeys.runId, runId))
    .orderBy(desc(tables.journeys.priority), tables.journeys.createdAt)

  return rows.map(toJourney)
}

export async function insertJourneySteps(
  journeyId: string,
  steps: Array<{
    sequence: number
    action: string
    target: string | null
    expected: string
    actual: string
    status: 'passed' | 'failed' | 'skipped'
  }>,
): Promise<void> {
  if (steps.length === 0) return
  const at = nowIso()
  await db()
    .insert(tables.journeySteps)
    .values(
      steps.map((step) => ({
        ...step,
        id: newId('stp'),
        journeyId,
        createdAt: at,
      })),
    )
}

export async function listJourneySteps(
  runId: string,
): Promise<JourneyStepRow[]> {
  const rows = await db()
    .select({ step: tables.journeySteps })
    .from(tables.journeySteps)
    .innerJoin(
      tables.journeys,
      eq(tables.journeys.id, tables.journeySteps.journeyId),
    )
    .where(eq(tables.journeys.runId, runId))
    .orderBy(tables.journeySteps.journeyId, tables.journeySteps.sequence)

  return rows.map((r) => r.step)
}

/* -------------------------------------------------------------- findings */

const toFinding = (r: FindingRow): Finding => ({
  id: r.id,
  runId: r.runId,
  journeyId: r.journeyId,
  title: r.title,
  description: r.description,
  failureClass: r.failureClass,
  classification: r.classification,
  severity: r.severity,
  confidence: r.confidence,
  reproductionAttempts: r.reproductionAttempts,
  reproductionFailures: r.reproductionFailures,
  rootCause: r.rootCause,
  rootCauseConfidence: r.rootCauseConfidence,
  affectedFiles: parseJson<string[]>(r.affectedFiles, []),
  status: r.status,
  createdAt: r.createdAt,
})

export async function insertFinding(input: {
  runId: string
  journeyId: string | null
  title: string
  description: string
  failureClass: FailureClass
  classification: Classification
  severity: Severity
  confidence: number
  reproductionAttempts: number
  reproductionFailures: number
  rootCause: string | null
  rootCauseConfidence: number | null
  affectedFiles: string[]
}): Promise<Finding> {
  const [row] = await db()
    .insert(tables.findings)
    .values({
      ...input,
      id: newId('fnd'),
      affectedFiles: JSON.stringify(input.affectedFiles),
      status: 'open',
      createdAt: nowIso(),
    })
    .returning()

  return toFinding(row)
}

/** Severity order for display. SQLite has no enum, so it is expressed here. */
const SEVERITY_RANK = sql`
  CASE ${tables.findings.severity}
    WHEN 'critical' THEN 0
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    ELSE 3
  END`

export async function listFindings(runId: string): Promise<Finding[]> {
  const rows = await db()
    .select()
    .from(tables.findings)
    .where(eq(tables.findings.runId, runId))
    .orderBy(SEVERITY_RANK, tables.findings.createdAt)

  return rows.map(toFinding)
}

export async function assertFindingAccess(
  findingId: string,
  userId: string,
): Promise<{ finding: Finding; run: Run; project: Project }> {
  const [row] = await db()
    .select({
      finding: tables.findings,
      run: tables.runs,
      project: tables.projects,
    })
    .from(tables.findings)
    .innerJoin(tables.runs, eq(tables.runs.id, tables.findings.runId))
    .innerJoin(tables.projects, eq(tables.projects.id, tables.runs.projectId))
    .where(and(eq(tables.findings.id, findingId), live))
    .limit(1)

  if (!row) throw new NotFoundError('Finding')
  if (row.project.userId !== userId) throw new ForbiddenError()

  return {
    finding: toFinding(row.finding),
    run: toRun(row.run),
    project: toProject(row.project),
  }
}

export async function updateFindingStatus(
  findingId: string,
  status: Finding['status'],
): Promise<void> {
  await db()
    .update(tables.findings)
    .set({ status })
    .where(eq(tables.findings.id, findingId))
}

export async function countOpenBugs(userId: string): Promise<number> {
  const [row] = await db()
    .select({ total: count() })
    .from(tables.findings)
    .innerJoin(tables.runs, eq(tables.runs.id, tables.findings.runId))
    .innerJoin(tables.projects, eq(tables.projects.id, tables.runs.projectId))
    .where(
      and(
        eq(tables.projects.userId, userId),
        eq(tables.findings.status, 'open'),
        eq(tables.findings.classification, 'confirmed_bug'),
        live,
      ),
    )

  return row?.total ?? 0
}

/* ---------------------------------------------------------------- events */

const toEvent = (r: EventRow): RunEvent => ({
  id: r.id,
  runId: r.runId,
  sequence: r.sequence,
  type: r.type,
  message: r.message,
  data: parseJson<Record<string, JsonValue>>(r.data, {}),
  createdAt: r.createdAt,
})

export async function appendEvent(input: {
  runId: string
  sequence: number
  type: string
  message: string
  data?: Record<string, JsonValue>
}): Promise<RunEvent> {
  const data = input.data ?? {}
  const [row] = await db()
    .insert(tables.runEvents)
    .values({
      ...input,
      id: newId('evt'),
      data: JSON.stringify(data),
      createdAt: nowIso(),
    })
    // The engine can retry a step; the sequence number keeps events unique.
    .onConflictDoNothing({
      target: [tables.runEvents.runId, tables.runEvents.sequence],
    })
    .returning()

  return row
    ? toEvent(row)
    : {
        id: `dup_${input.sequence}`,
        runId: input.runId,
        sequence: input.sequence,
        type: input.type,
        message: input.message,
        data,
        createdAt: nowIso(),
      }
}

export async function listEvents(runId: string): Promise<RunEvent[]> {
  const rows = await db()
    .select()
    .from(tables.runEvents)
    .where(eq(tables.runEvents.runId, runId))
    .orderBy(tables.runEvents.sequence)

  return rows.map(toEvent)
}

/* --------------------------------------------------------- fix attempts */

export async function recordFixAttempt(input: {
  findingId: string
  verificationRunId: string
  status: 'pending' | 'verified' | 'still_failing'
  summary: string | null
}): Promise<void> {
  await db()
    .insert(tables.fixAttempts)
    .values({ ...input, id: newId('fix'), createdAt: nowIso() })
}

export async function updateFixAttempt(
  verificationRunId: string,
  status: 'verified' | 'still_failing',
  summary: string,
): Promise<void> {
  await db()
    .update(tables.fixAttempts)
    .set({ status, summary })
    .where(eq(tables.fixAttempts.verificationRunId, verificationRunId))
}

export async function listFixAttempts(
  findingId: string,
): Promise<FixAttemptRow[]> {
  return db()
    .select()
    .from(tables.fixAttempts)
    .where(eq(tables.fixAttempts.findingId, findingId))
    .orderBy(desc(tables.fixAttempts.createdAt))
}

/* -------------------------------------------------------------- evidence */

/** Attaches already-recorded journey evidence to the finding it supports. */
export async function linkJourneyEvidence(
  journeyId: string,
  findingId: string,
): Promise<void> {
  await db()
    .update(tables.evidence)
    .set({ findingId })
    .where(
      and(
        eq(tables.evidence.journeyId, journeyId),
        isNull(tables.evidence.findingId),
      ),
    )
}
