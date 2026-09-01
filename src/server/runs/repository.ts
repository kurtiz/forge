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
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, newId, nowIso, parseJson, tables } from '../db'
import type {
  Classification,
  FailureClass,
  Finding,
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
const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  userId: r.userId,
  name: r.name,
  targetUrl: r.targetUrl,
  repoUrl: r.repoUrl,
  goal: r.goal,
  authLoginPath: r.authLoginPath,
  authUsername: r.authUsername,
  hasCredentials: Boolean(r.authPasswordEncrypted),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

export async function createProject(input: {
  userId: string
  name: string
  targetUrl: string
  repoUrl: string | null
  goal: string | null
  authLoginPath?: string | null
  authUsername?: string | null
  authPasswordEncrypted?: string | null
}): Promise<Project> {
  const at = nowIso()
  const [row] = await db()
    .insert(tables.projects)
    .values({ ...input, id: newId('prj'), createdAt: at, updatedAt: at })
    .returning()

  return toProject(row)
}

export type StoredCredentials = {
  loginPath: string
  username: string
  passwordEncrypted: string
  profileId: string | null
}

/**
 * The one path that reads the stored ciphertext.
 *
 * Separate from `toProject` on purpose: a caller has to ask for credentials by
 * name, so they cannot be returned by accident. Called only from the run
 * service, and decrypted only inside the run Durable Object.
 */
export async function readProjectCredentials(
  projectId: string,
): Promise<StoredCredentials | null> {
  const [row] = await db()
    .select()
    .from(tables.projects)
    .where(eq(tables.projects.id, projectId))
    .limit(1)

  if (!row?.authUsername || !row.authPasswordEncrypted) return null

  return {
    loginPath: row.authLoginPath ?? '/login',
    username: row.authUsername,
    passwordEncrypted: row.authPasswordEncrypted,
    profileId: row.authProfileId,
  }
}

/** Records the Solari profile that now holds this project's signed-in state. */
export async function saveProjectProfileId(
  projectId: string,
  profileId: string,
): Promise<void> {
  await db()
    .update(tables.projects)
    .set({ authProfileId: profileId, updatedAt: nowIso() })
    .where(eq(tables.projects.id, projectId))
}

export async function listProjects(userId: string): Promise<Project[]> {
  const rows = await db()
    .select()
    .from(tables.projects)
    .where(eq(tables.projects.userId, userId))
    .orderBy(desc(tables.projects.createdAt))
    .limit(100)

  return rows.map(toProject)
}

export async function assertProjectAccess(
  projectId: string,
  userId: string,
): Promise<Project> {
  const [row] = await db()
    .select()
    .from(tables.projects)
    .where(eq(tables.projects.id, projectId))
    .limit(1)

  if (!row) throw new NotFoundError('Project')
  if (row.userId !== userId) throw new ForbiddenError()
  return toProject(row)
}

export async function deleteProject(projectId: string): Promise<void> {
  await db().delete(tables.projects).where(eq(tables.projects.id, projectId))
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
  summary: r.summary,
  startedAt: r.startedAt,
  completedAt: r.completedAt,
  createdAt: r.createdAt,
})

export async function createRun(input: {
  projectId: string
  targetUrl: string
  repoUrl: string | null
  executor: Run['executor']
  trigger: Run['trigger']
  verifiesFindingId: string | null
  idempotencyKey: string | null
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

export async function assertRunAccess(
  runId: string,
  userId: string,
): Promise<{ run: Run; project: Project }> {
  const [row] = await db()
    .select({ run: tables.runs, project: tables.projects })
    .from(tables.runs)
    .innerJoin(tables.projects, eq(tables.projects.id, tables.runs.projectId))
    .where(eq(tables.runs.id, runId))
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
    .where(eq(tables.projects.userId, userId))
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
    .where(eq(tables.findings.id, findingId))
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
