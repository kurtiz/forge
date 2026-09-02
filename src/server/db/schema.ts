/**
 * Database schema.
 *
 * The single source of truth for the shape of D1. Migrations in
 * `infrastructure/migrations` are generated from this file by drizzle-kit, and
 * both Better Auth and Forge's own queries read it, so there is one definition
 * of every column rather than a schema plus a parallel set of hand-written SQL
 * that has to be kept in step.
 *
 * Two timestamp conventions, deliberately:
 *
 *   - Better Auth's tables store Unix timestamps (`integer`, mode `timestamp`).
 *     Its adapter hands Drizzle real `Date` objects, and D1 cannot bind those,
 *     so the column type has to be the one Drizzle knows how to convert.
 *   - Forge's own tables store ISO 8601 strings. They are written by this
 *     codebase and read straight into the UI, where an ISO string is what both
 *     the API contracts and `Intl.RelativeTimeFormat` expect.
 *
 * Booleans are 0/1 integers throughout; SQLite has no boolean type.
 *
 * Better Auth's tables also keep its own naming (singular tables, camelCase
 * columns) because its adapter resolves them by name. Forge's tables use
 * snake_case columns, which is what the rest of the SQL ecosystem expects.
 */
import { relations, sql } from 'drizzle-orm'
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type {
  Classification,
  EvidenceKind,
  FailureClass,
  Finding,
  JourneyStatus,
  Run,
  RunStatus,
  ScheduleOutcome,
  Severity,
} from '../contracts'

type RunTrigger = Run['trigger']
type ExecutorKind = Run['executor']
type FindingStatus = Finding['status']
type StepStatus = 'passed' | 'failed' | 'skipped'
type FixAttemptStatus = 'pending' | 'verified' | 'still_failing'

/* --------------------------------------------------------------- identity */

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  /** Set by the anonymous plugin. Guests are real users with real ownership. */
  isAnonymous: integer('isAnonymous', { mode: 'boolean' }).default(false),
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', {
      mode: 'timestamp',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

/* --------------------------------------------------------------- projects */

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetUrl: text('target_url').notNull(),
    repoUrl: text('repo_url'),
    goal: text('goal'),
    /**
     * Preview URL pattern for pull requests, e.g.
     * `https://pr-{number}.example.pages.dev`. Null: wait for a deployment.
     */
    previewUrlTemplate: text('preview_url_template'),
    /**
     * Set the moment a delete is requested, before any artifact is touched.
     *
     * A project's evidence lives in R2 and its rows live in D1, and the two
     * cannot be removed in one transaction. Marking the row first makes the
     * project invisible immediately - to every query, to scheduled runs, to
     * webhooks - while a queue works through the objects. The row is removed
     * for real once they are gone, so a half-deleted project is never a
     * half-visible one.
     */
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('projects_user_idx').on(table.userId, table.createdAt),
    index('projects_deleted_idx').on(table.deletedAt),
  ],
)

/**
 * Test accounts for a login-gated target.
 *
 * A table rather than columns on `projects`, because an application worth
 * verifying usually has more than one kind of user: what an administrator can
 * reach and what a member can reach are different applications in practice, and
 * a project that can only hold one login can only ever verify one of them.
 *
 * Exactly one credential per project is the default, and that is the one a run
 * signs in with.
 */
export const projectCredentials = sqliteTable(
  'project_credentials',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** What this account is for: "Administrator", "Member", "Read-only". */
    label: text('label').notNull(),
    /** Path on the target site carrying the login form, e.g. `/login`. */
    loginPath: text('login_path').notNull(),
    /** Not a secret; stored as given so it can be shown back in the UI. */
    username: text('username').notNull(),
    /**
     * AES-GCM ciphertext, base64. Written by `encryptCredential`, read only
     * inside the run Durable Object. Never leaves the server in any response.
     */
    passwordEncrypted: text('password_encrypted').notNull(),
    /** Solari browser profile holding the signed-in state between runs. */
    profileId: text('profile_id'),
    /** The account runs sign in with. Exactly one per project. */
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('project_credentials_project_idx').on(table.projectId, table.createdAt),
  ],
)

/* ------------------------------------------------------------- API tokens */

/**
 * Personal access tokens for the CLI and CI. The token is shown once and only
 * its SHA-256 lands here, so a database read cannot recover a usable secret.
 */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** First characters of the token, so a user can tell tokens apart. */
    prefix: text('prefix').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('api_tokens_user_idx').on(table.userId, table.createdAt)],
)

/* -------------------------------------------------------- GitHub App */

/**
 * One row per GitHub App installation. `userId` is set when a signed-in Forge
 * user completes the install flow; until then the installation exists but can
 * trigger nothing, because there is no account to run on behalf of.
 */
export const githubInstallations = sqliteTable(
  'github_installations',
  {
    /** GitHub's installation id, as text so it never overflows. */
    id: text('id').primaryKey(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [index('github_installations_user_idx').on(table.userId)],
)

/* ------------------------------------------------------------------- runs */

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').$type<RunStatus>().notNull(),
    trigger: text('trigger').$type<RunTrigger>().notNull(),
    /** Which provider produced this run's evidence. */
    executor: text('executor').$type<ExecutorKind>().notNull(),
    targetUrl: text('target_url').notNull(),
    repoUrl: text('repo_url'),
    sessionId: text('session_id'),
    replayUrl: text('replay_url'),
    verifiesFindingId: text('verifies_finding_id'),
    /** Pull-request runs: the commit under test and where the check is posted. */
    commitSha: text('commit_sha'),
    pullRequestNumber: integer('pull_request_number'),
    githubInstallationId: text('github_installation_id'),
    checkRunId: text('check_run_id'),
    /** Guards against a retried request creating a second billable session. */
    idempotencyKey: text('idempotency_key'),
    summary: text('summary'),
    error: text('error'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('runs_project_idx').on(table.projectId, table.createdAt),
    uniqueIndex('runs_idempotency_idx')
      .on(table.projectId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
)

/* --------------------------------------------------------------- journeys */

export const journeys = sqliteTable(
  'journeys',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    goal: text('goal').notNull(),
    entryPath: text('entry_path').notNull().default('/'),
    priority: real('priority').notNull().default(0.5),
    status: text('status').$type<JourneyStatus>().notNull().default('pending'),
    confidence: real('confidence'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('journeys_run_idx').on(table.runId, table.priority)],
)

export const journeySteps = sqliteTable(
  'journey_steps',
  {
    id: text('id').primaryKey(),
    journeyId: text('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    action: text('action').notNull(),
    target: text('target'),
    expected: text('expected'),
    actual: text('actual'),
    status: text('status').$type<StepStatus>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('journey_steps_journey_idx').on(table.journeyId, table.sequence),
  ],
)

/* --------------------------------------------------------------- findings */

export const findings = sqliteTable(
  'findings',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    journeyId: text('journey_id').references(() => journeys.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    failureClass: text('failure_class').$type<FailureClass>().notNull(),
    classification: text('classification').$type<Classification>().notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    confidence: real('confidence').notNull(),
    reproductionAttempts: integer('reproduction_attempts').notNull().default(0),
    reproductionFailures: integer('reproduction_failures').notNull().default(0),
    rootCause: text('root_cause'),
    rootCauseConfidence: real('root_cause_confidence'),
    /** JSON array of repository paths. Empty until sandbox investigation ships. */
    affectedFiles: text('affected_files').notNull().default('[]'),
    status: text('status').$type<FindingStatus>().notNull().default('open'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('findings_run_idx').on(table.runId, table.createdAt)],
)

/* --------------------------------------------------------------- evidence */

export const evidence = sqliteTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    findingId: text('finding_id').references(() => findings.id, {
      onDelete: 'set null',
    }),
    journeyId: text('journey_id').references(() => journeys.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<EvidenceKind>().notNull(),
    label: text('label').notNull(),
    /** R2 object key. Null for evidence that is metadata only, like a replay URL. */
    storageKey: text('storage_key'),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    metadata: text('metadata').notNull().default('{}'),
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('evidence_run_idx').on(table.runId, table.createdAt),
    index('evidence_finding_idx').on(table.findingId),
  ],
)

/* ----------------------------------------------------------------- events */

export const runEvents = sqliteTable(
  'run_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    message: text('message').notNull(),
    data: text('data').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('run_events_seq_idx').on(table.runId, table.sequence),
  ],
)

/* ----------------------------------------------------------- fix attempts */

export const fixAttempts = sqliteTable(
  'fix_attempts',
  {
    id: text('id').primaryKey(),
    findingId: text('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    verificationRunId: text('verification_run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    status: text('status').$type<FixAttemptStatus>().notNull(),
    summary: text('summary'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('fix_attempts_finding_idx').on(table.findingId, table.createdAt),
  ],
)

/* -------------------------------------------------------------- schedules */

/**
 * Scheduled monitoring. One schedule per project: the cron handler picks up
 * rows whose `nextRunAt` has passed, starts a run, and advances the pointer.
 * Outcome and streak are kept here so a notification can say "still failing"
 * rather than re-alerting on every tick.
 */
export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: 'cascade' }),
    cadenceMinutes: integer('cadence_minutes').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    notifyUrl: text('notify_url'),
    nextRunAt: text('next_run_at'),
    lastRunId: text('last_run_id'),
    lastRunAt: text('last_run_at'),
    lastOutcome: text('last_outcome').$type<ScheduleOutcome>(),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('schedules_due_idx').on(table.enabled, table.nextRunAt)],
)

/* -------------------------------------------------------------- relations */

export const projectRelations = relations(projects, ({ one, many }) => ({
  owner: one(user, { fields: [projects.userId], references: [user.id] }),
  runs: many(runs),
  credentials: many(projectCredentials),
  schedule: one(schedules, {
    fields: [projects.id],
    references: [schedules.projectId],
  }),
}))

export const runRelations = relations(runs, ({ one, many }) => ({
  project: one(projects, {
    fields: [runs.projectId],
    references: [projects.id],
  }),
  journeys: many(journeys),
  findings: many(findings),
  evidence: many(evidence),
  events: many(runEvents),
}))

export const journeyRelations = relations(journeys, ({ one, many }) => ({
  run: one(runs, { fields: [journeys.runId], references: [runs.id] }),
  steps: many(journeySteps),
}))

export const findingRelations = relations(findings, ({ one, many }) => ({
  run: one(runs, { fields: [findings.runId], references: [runs.id] }),
  journey: one(journeys, {
    fields: [findings.journeyId],
    references: [journeys.id],
  }),
  evidence: many(evidence),
  fixAttempts: many(fixAttempts),
}))

export const schema = {
  user,
  session,
  account,
  verification,
  projects,
  projectCredentials,
  runs,
  journeys,
  journeySteps,
  findings,
  evidence,
  runEvents,
  fixAttempts,
  apiTokens,
  githubInstallations,
  schedules,
}
