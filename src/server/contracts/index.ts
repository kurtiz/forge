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
  authLoginPath: z.string().nullable(),
  authUsername: z.string().nullable(),
  /**
   * Whether a password is stored, never the password. The ciphertext has no
   * representation in this contract at all, so it cannot reach a response by
   * being forgotten in a mapper.
   */
  hasCredentials: z.boolean(),
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
   * Test-account credentials for a login-gated target. Dedicated test accounts
   * only - this is stated in the form copy and in the security docs.
   */
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
  /** Console URL for this run. */
  url: string
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
