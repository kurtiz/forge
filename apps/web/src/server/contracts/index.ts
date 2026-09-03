/**
 * Shared domain contracts.
 *
 * Every boundary in Forge validates through these schemas: API input, model
 * output, tool arguments, event payloads. Nothing here may import Cloudflare
 * runtime types, so the same contracts can be reused by a future CLI or SDK.
 */
import { z } from 'zod'

/**
 * JSON that survives the server-function boundary. Metadata and event payloads
 * are stored as JSON text in D1 and handed straight to the UI, so their types
 * have to be provably serialisable rather than `unknown`.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

/* ------------------------------------------------------------------ runs */

export const RUN_STATUSES = [
  'queued',
  'starting',
  'discovering',
  'testing',
  'investigating',
  'reporting',
  'completed',
  'failed',
  'canceled',
] as const

export const runStatusSchema = z.enum(RUN_STATUSES)
export type RunStatus = z.infer<typeof runStatusSchema>

export const TERMINAL_RUN_STATUSES = [
  'completed',
  'failed',
  'canceled',
] as const satisfies readonly RunStatus[]

/**
 * How a run came to exist. `manual` is the console, `verify_fix` re-runs a
 * finding's journey, `scheduled` is the monitoring cron, `pull_request` is the
 * GitHub App reacting to a deployment, `cli` is the terminal.
 */
export const runTriggerSchema = z.enum([
  'manual',
  'verify_fix',
  'scheduled',
  'pull_request',
  'cli',
])
export type RunTrigger = z.infer<typeof runTriggerSchema>

export const runSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: runStatusSchema,
  trigger: runTriggerSchema,
  executor: z.enum(['solari', 'fetch']),
  targetUrl: z.string(),
  repoUrl: z.string().nullable(),
  sessionId: z.string().nullable(),
  replayUrl: z.string().nullable(),
  verifiesFindingId: z.string().nullable(),
  /** Set on runs the GitHub App started: the commit under test and its PR. */
  commitSha: z.string().nullable(),
  pullRequestNumber: z.number().nullable(),
  summary: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Run = z.infer<typeof runSchema>

/* -------------------------------------------------------------- journeys */

export const journeyStatusSchema = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
])
export type JourneyStatus = z.infer<typeof journeyStatusSchema>

/** What the Explorer agent is allowed to return. Validated before persistence. */
export const discoveredJourneySchema = z.object({
  name: z.string().min(3).max(80),
  goal: z.string().min(8).max(240),
  priority: z.number().min(0).max(1),
  entryPath: z.string().max(512).default('/'),
})
export type DiscoveredJourney = z.infer<typeof discoveredJourneySchema>

export const explorerOutputSchema = z.object({
  journeys: z.array(discoveredJourneySchema).min(1).max(12),
})
export type ExplorerOutput = z.infer<typeof explorerOutputSchema>

export const journeySchema = z.object({
  id: z.string(),
  runId: z.string(),
  name: z.string(),
  goal: z.string(),
  entryPath: z.string(),
  priority: z.number(),
  status: journeyStatusSchema,
  confidence: z.number().nullable(),
  createdAt: z.string(),
})
export type Journey = z.infer<typeof journeySchema>

export const journeyStepSchema = z.object({
  id: z.string(),
  journeyId: z.string(),
  sequence: z.number(),
  action: z.string(),
  target: z.string().nullable(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  status: z.enum(['passed', 'failed', 'skipped']),
  createdAt: z.string(),
})
export type JourneyStep = z.infer<typeof journeyStepSchema>

/* -------------------------------------------------------------- findings */

export const failureClassSchema = z.enum([
  'APPLICATION_BUG',
  'AUTH_FAILURE',
  'BOT_CHALLENGE',
  'NETWORK_FAILURE',
  'TIMEOUT',
  'ENVIRONMENT_FAILURE',
  'BROWSER_FAILURE',
  'SOLARI_FAILURE',
  'AGENT_ERROR',
  'UNKNOWN',
])
export type FailureClass = z.infer<typeof failureClassSchema>

export const classificationSchema = z.enum([
  'confirmed_bug',
  'flaky',
  'environment',
  'agent_error',
  'unknown',
])
export type Classification = z.infer<typeof classificationSchema>

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low'])
export type Severity = z.infer<typeof severitySchema>

/** What the Judge agent is allowed to return. */
export const judgeOutputSchema = z.object({
  classification: classificationSchema,
  severity: severitySchema,
  confidence: z.number().min(0).max(1),
  title: z.string().min(6).max(140),
  summary: z.string().min(10).max(1200),
  rootCause: z.string().max(1200).nullable().default(null),
  rootCauseConfidence: z.number().min(0).max(1).nullable().default(null),
})
export type JudgeOutput = z.infer<typeof judgeOutputSchema>

export const findingSchema = z.object({
  id: z.string(),
  runId: z.string(),
  journeyId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  failureClass: failureClassSchema,
  classification: classificationSchema,
  severity: severitySchema,
  confidence: z.number(),
  reproductionAttempts: z.number(),
  reproductionFailures: z.number(),
  rootCause: z.string().nullable(),
  rootCauseConfidence: z.number().nullable(),
  affectedFiles: z.array(z.string()),
  status: z.enum(['open', 'resolved', 'dismissed']),
  createdAt: z.string(),
})
export type Finding = z.infer<typeof findingSchema>

/* -------------------------------------------------------------- evidence */

export const evidenceKindSchema = z.enum([
  'screenshot',
  'recording',
  'console',
  'network',
  'page',
  'action',
  'source',
])
export type EvidenceKind = z.infer<typeof evidenceKindSchema>

export const evidenceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  findingId: z.string().nullable(),
  journeyId: z.string().nullable(),
  kind: evidenceKindSchema,
  label: z.string(),
  storageKey: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  metadata: z.record(z.string(), jsonValueSchema),
  createdAt: z.string(),
})
export type Evidence = z.infer<typeof evidenceSchema>

/* ---------------------------------------------------------------- events */

export const runEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sequence: z.number(),
  type: z.string(),
  message: z.string(),
  data: z.record(z.string(), jsonValueSchema),
  createdAt: z.string(),
})
export type RunEvent = z.infer<typeof runEventSchema>

/* -------------------------------------------------------------- projects */

export const projectSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  targetUrl: z.string(),
  repoUrl: z.string().nullable(),
  goal: z.string().nullable(),
  /**
   * How many test accounts this project holds. The credentials themselves are
   * a separate contract, and the ciphertext has no representation in either, so
   * a password cannot reach a response by being forgotten in a mapper.
   */
  credentialCount: z.number(),
  /**
   * Where a pull request's preview deployment lives, for projects whose host
   * does not report deployments to GitHub. Placeholders: `{number}`, `{branch}`,
   * `{sha}`, `{sha7}`. Null means Forge waits for a `deployment_status` event.
   */
  previewUrlTemplate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Project = z.infer<typeof projectSchema>

/* -------------------------------------------------------------- requests */

/* ---------------------------------------------------- project credentials */

/**
 * A stored test account, as the console shows it. There is no field for the
 * password: it goes in and is never read back out.
 */
export const projectCredentialSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  loginPath: z.string(),
  username: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProjectCredential = z.infer<typeof projectCredentialSchema>

const credentialFields = {
  label: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : 'Test account')),
  loginPath: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  username: z.string().trim().min(1, 'A username is required').max(200),
}

export const createCredentialInputSchema = z.object({
  projectId: z.string().min(3).max(64),
  ...credentialFields,
  password: z.string().min(1, 'A password is required').max(300),
  isDefault: z.boolean().optional(),
})
export type CreateCredentialInput = z.infer<typeof createCredentialInputSchema>

/**
 * Editing an account. The password is optional: leaving it blank keeps the
 * stored one, which is the only way to change a label or a login path without
 * having to know the password again.
 */
export const updateCredentialInputSchema = z.object({
  credentialId: z.string().min(3).max(64),
  ...credentialFields,
  password: z
    .string()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
})
export type UpdateCredentialInput = z.infer<typeof updateCredentialInputSchema>

/* -------------------------------------------------- the project's own plan */

/**
 * A journey the operator of a project named, rather than one Forge guessed.
 *
 * Same shape as a discovered journey plus an identity and an on/off switch, so
 * the run engine can hand it to the Operator without translating anything.
 */
export const projectJourneySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  goal: z.string(),
  entryPath: z.string(),
  priority: z.number(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProjectJourney = z.infer<typeof projectJourneySchema>

const journeyPlanFields = {
  name: z.string().trim().min(2, 'Give the journey a name').max(80),
  goal: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v ?? ''),
  entryPath: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => {
      const path = (v ?? '').trim()
      if (!path) return '/'
      return path.startsWith('/') ? path : `/${path}`
    }),
  /**
   * Clamped rather than rejected. This arrives from a slider, and a project
   * that typed 1.4 into the API meant "the most important one", not an error.
   */
  priority: z
    .number()
    .optional()
    .transform((v) => Math.max(0, Math.min(1, Number((v ?? 0.5).toFixed(2))))),
  enabled: z.boolean().optional(),
}

export const createProjectJourneyInputSchema = z.object({
  projectId: z.string().min(3).max(64),
  ...journeyPlanFields,
})
export type CreateProjectJourneyInput = z.infer<
  typeof createProjectJourneyInputSchema
>

export const updateProjectJourneyInputSchema = z.object({
  journeyId: z.string().min(3).max(64),
  ...journeyPlanFields,
})
export type UpdateProjectJourneyInput = z.infer<
  typeof updateProjectJourneyInputSchema
>

/**
 * A value that is true of the target application, for filling its forms.
 *
 * Never a credential. These are shown back in the console and written into run
 * evidence like any other typed value.
 */
export const projectSampleValueSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  value: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProjectSampleValue = z.infer<typeof projectSampleValueSchema>

const sampleValueFields = {
  label: z.string().trim().min(2, 'Name the field this is for').max(80),
  value: z.string().trim().min(1, 'Give a value to type').max(300),
}

export const createSampleValueInputSchema = z.object({
  projectId: z.string().min(3).max(64),
  ...sampleValueFields,
})
export type CreateSampleValueInput = z.infer<typeof createSampleValueInputSchema>

export const updateSampleValueInputSchema = z.object({
  sampleValueId: z.string().min(3).max(64),
  ...sampleValueFields,
})
export type UpdateSampleValueInput = z.infer<typeof updateSampleValueInputSchema>

/**
 * A header Forge attaches to every request it makes to this project's target.
 *
 * The value is never in this shape. Like a stored password it is encrypted at
 * rest and read only inside the run's Durable Object, so a header set cannot
 * escape through an API response by being forgotten in a mapper. Editing one
 * means replacing it.
 */
export const projectHeaderSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProjectHeader = z.infer<typeof projectHeaderSchema>

export const createProjectHeaderInputSchema = z.object({
  projectId: z.string().min(3).max(64),
  name: z.string().trim().min(1, 'Name the header').max(64),
  value: z.string().trim().min(1, 'Give the header a value').max(2048),
})
export type CreateProjectHeaderInput = z.infer<
  typeof createProjectHeaderInputSchema
>

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  targetUrl: z.string().trim().min(1, 'Target URL is required'),
  repoUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  goal: z
    .string()
    .trim()
    .max(400)
    .optional()
    .transform((v) => (v ? v : null)),
  /**
   * The first test account for a login-gated target, created with the project.
   * Dedicated test accounts only - this is stated in the form copy and in the
   * security docs. More can be added afterwards, one per role.
   */
  authLabel: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : null)),
  authLoginPath: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  authUsername: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null)),
  authPassword: z
    .string()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
})
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>

export const createRunInputSchema = z.object({
  idempotencyKey: z.string().max(80).optional(),
  verifiesFindingId: z.string().max(60).optional(),
})
export type CreateRunInput = z.infer<typeof createRunInputSchema>

export const updateProjectInputSchema = z.object({
  projectId: z.string().min(3).max(64),
  previewUrlTemplate: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  /**
   * What matters most about this application, in the project's own words. Set
   * when the project is created and editable afterwards, because what a team
   * cares about moves and the sentence that steers discovery should move with
   * it. Absent means "leave it as it is"; empty means "clear it".
   */
  goal: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
})
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>

/* ------------------------------------------------------------ API tokens */

/**
 * A personal access token as the console shows it. The token itself is shown
 * once at creation and never stored; only its hash and a display prefix are.
 */
export const apiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type ApiToken = z.infer<typeof apiTokenSchema>

export const createApiTokenInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the token a name').max(60),
})

/* -------------------------------------------------------------- REST API */

/**
 * Body of `POST /api/v1/runs`, the CLI's entry point. A URL is enough; the
 * project is found or created from it so the terminal never has to know
 * project ids.
 */
export const apiCreateRunSchema = z.object({
  url: z.string().trim().min(1).max(2000).optional(),
  projectId: z.string().min(3).max(64).optional(),
  repo: z.string().trim().max(300).optional(),
  goal: z.string().trim().max(400).optional(),
  name: z.string().trim().min(2).max(60).optional(),
  idempotencyKey: z.string().max(80).optional(),
})
export type ApiCreateRun = z.infer<typeof apiCreateRunSchema>

/** What `GET /api/v1/runs/:id` returns and what the CLI renders. */
export type RunReport = {
  run: Run
  project: Project
  journeys: Journey[]
  findings: Finding[]
  /**
   * What to do about the finding that decided this run, if there was one.
   *
   * One rather than all of them, for the same reason the GitHub check carries
   * one: this is read in a CI log, and a log that prints five briefs gets
   * scrolled past. The rest are on the finding pages.
   */
  remediation: RunRemediation | null
  /** Console URL for this run. */
  url: string
}

/** The fix instructions as they cross the API, flattened for a client. */
export type RunRemediation = {
  findingId: string
  /** Console URL for the finding this belongs to. */
  findingUrl: string
  headline: string
  owner: 'application' | 'infrastructure' | 'forge' | 'none'
  steps: string[]
  /** Paste-ready brief for a coding agent. Null when there is nothing to fix. */
  prompt: string | null
}

/* ----------------------------------------------------------- monitoring */

/** Cadences a schedule may use, in minutes. */
export const SCHEDULE_CADENCES = [30, 60, 180, 360, 720, 1440] as const
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number]

export const scheduleOutcomeSchema = z.enum(['passed', 'failed', 'error'])
export type ScheduleOutcome = z.infer<typeof scheduleOutcomeSchema>

export const scheduleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  cadenceMinutes: z.number(),
  enabled: z.boolean(),
  /** Webhook that receives a JSON notification. Slack-compatible payload. */
  notifyUrl: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastRunId: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastOutcome: scheduleOutcomeSchema.nullable(),
  consecutiveFailures: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Schedule = z.infer<typeof scheduleSchema>

export const upsertScheduleInputSchema = z.object({
  projectId: z.string().min(3).max(64),
  cadenceMinutes: z
    .number()
    .int()
    .refine(
      (v): v is ScheduleCadence =>
        (SCHEDULE_CADENCES as readonly number[]).includes(v),
      'Choose one of the supported cadences.',
    ),
  enabled: z.boolean(),
  notifyUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
})
export type UpsertScheduleInput = z.infer<typeof upsertScheduleInputSchema>

/* ---------------------------------------------------------------- GitHub */

export const githubInstallationSchema = z.object({
  id: z.string(),
  accountLogin: z.string(),
  accountType: z.string(),
  /** Whether a Forge user has claimed this installation. */
  linked: z.boolean(),
  createdAt: z.string(),
})
export type GitHubInstallation = z.infer<typeof githubInstallationSchema>

/* --------------------------------------------------------------- budgets */

export type AgentBudget = {
  maxJourneys: number
  maxAiCalls: number
  maxBrowserActions: number
  maxBrowserSeconds: number
  maxReproductionAttempts: number
  maxEvidenceBytes: number
  /** Sandbox wall time for repository investigation, across the whole run. */
  maxSandboxSeconds: number
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxJourneys: 6,
  maxAiCalls: 20,
  maxBrowserActions: 120,
  maxBrowserSeconds: 15 * 60,
  maxReproductionAttempts: 3,
  maxEvidenceBytes: 24 * 1024 * 1024,
  maxSandboxSeconds: 10 * 60,
}
