/**
 * REST API, version 1.
 *
 * The surface the CLI and CI talk to. It is deliberately small and deliberately
 * separate from the server functions the console uses: server functions are a
 * private, typed transport between this application's own client and server,
 * while this is a public contract that has to stay stable across CLI versions.
 *
 * Authentication is a bearer token (`Authorization: Bearer forge_...`), resolved
 * by `currentUser` to exactly the same `SessionUser` the console cookie yields,
 * so every ownership check below is the one the console already uses. A cookie
 * is accepted too - `currentUser` does not care which door - so nothing here
 * may infer that a caller is the CLI from the fact that it is talking to this
 * module. Anything recording provenance asks `domain/provenance`.
 */
import { z } from 'zod'
import {
  apiCreateRunSchema,
  type Finding,
  type Journey,
  type Project,
  type Run,
  type RunRemediation,
  type RunReport,
} from '@/server/contracts'
import { currentUser } from '@/server/auth'
import { apiRunTrigger, usedApiToken } from '@/server/domain/provenance'
import { env } from 'cloudflare:workers'
import {
  assertSafeTargetUrl,
  limitApiRequest,
  normaliseRepoUrl,
  RateLimitError,
  UnsafeTargetError,
} from '@/server/security'
import { remediationFor } from '@/server/domain/remediation'
import * as repo from '@/server/runs/repository'
import { startRun } from '@/server/runs/service'
import { requestProjectDeletion } from '@/server/cleanup'

/** JSON with the status a client can branch on, and nothing else. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function apiError(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * 429, with the header a well-behaved client already knows how to obey.
 *
 * `Retry-After` is worth more than the message here: it is what turns a retry
 * loop in someone's CI script into a wait rather than into more of the traffic
 * that caused the limit.
 */
function tooManyRequests(error: RateLimitError): Response {
  const response = apiError(error.message, 429)
  response.headers.set('retry-after', String(error.retryAfterSeconds))
  return response
}

/**
 * The limit every request to this API passes through, counted before the token
 * is resolved so an unauthenticated flood cannot make the database work.
 * Returns the response to send, or null to carry on.
 */
async function withinApiLimit(request: Request): Promise<Response | null> {
  try {
    await limitApiRequest(request)
    return null
  } catch (error) {
    if (error instanceof RateLimitError) return tooManyRequests(error)
    throw error
  }
}

/**
 * Maps a thrown error onto a status.
 *
 * `NotFound` and `Forbidden` both become 404, the same way the evidence route
 * does it: a token that names someone else's run must not be able to tell the
 * difference between "not yours" and "does not exist".
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof RateLimitError) return tooManyRequests(error)
  if (error instanceof UnsafeTargetError) return apiError(error.message, 400)
  if (error instanceof repo.NotFoundError) return apiError('Not found.', 404)
  if (error instanceof repo.ForbiddenError) return apiError('Not found.', 404)
  if (error instanceof z.ZodError) {
    return apiError(error.issues[0]?.message ?? 'Invalid request.', 400)
  }
  const message = error instanceof Error ? error.message : 'Request failed.'
  return apiError(message, 400)
}

export type ApiUser = {
  id: string
  /**
   * True when a bearer token was presented, which means the caller is outside
   * the browser. False means the console's own session cookie.
   */
  viaToken: boolean
}

/** Resolves the caller, or returns the 401 to send back. */
export async function authenticate(
  request: Request,
): Promise<ApiUser | Response> {
  const limited = await withinApiLimit(request)
  if (limited) return limited

  const user = await currentUser(request)
  if (!user) {
    return apiError(
      'Provide an API token: Authorization: Bearer forge_... Create one in the console under Settings.',
      401,
    )
  }
  return { id: user.id, viaToken: usedApiToken(request.headers) }
}

function consoleUrl(path: string): string {
  return `${(env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}${path}`
}

/* ------------------------------------------------------------------ runs */

/**
 * `POST /api/v1/runs` - start a verification.
 *
 * A URL is enough. The project is found or created from it, because the
 * terminal should not have to know Forge's object model to verify a
 * deployment. Passing `projectId` instead targets an existing project, which is
 * what CI does once a project is configured.
 */
export async function createRunHandler(request: Request): Promise<Response> {
  const user = await authenticate(request)
  if (user instanceof Response) return user

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('Request body must be JSON.', 400)
  }

  const input = apiCreateRunSchema.parse(body)
  if (!input.url && !input.projectId) {
    return apiError('Provide either "url" or "projectId".', 400)
  }

  const project = input.projectId
    ? await repo.assertProjectAccess(input.projectId, user.id)
    : await findOrCreateProject(user.id, input)

  const run = await startRun({
    userId: user.id,
    projectId: project.id,
    /*
     * Provenance comes from the credential, not from the route. This endpoint
     * accepts the console's session cookie as well as a bearer token, so
     * hardcoding `cli` here tagged browser-started runs "CLI" in a history
     * whose whole job is telling a hand-started run from an automated one.
     */
    trigger: apiRunTrigger(request.headers),
    idempotencyKey: input.idempotencyKey ?? null,
  })

  return json(
    {
      run,
      project,
      url: consoleUrl(`/runs/${run.id}`),
    },
    201,
  )
}

/**
 * Reuses the project already pointing at this URL rather than accumulating one
 * per invocation: `forge verify --url X` run daily should produce a history on
 * one project, not a hundred projects with one run each.
 */
async function findOrCreateProject(
  userId: string,
  input: z.infer<typeof apiCreateRunSchema>,
): Promise<Project> {
  const target = assertSafeTargetUrl(input.url ?? '').toString()
  const existing = await repo.findProjectByTarget(userId, target)
  if (existing) return existing

  return repo.createProject({
    userId,
    name: input.name ?? defaultProjectName(target),
    targetUrl: target,
    repoUrl: normaliseRepoUrl(input.repo ?? null),
    goal: input.goal ?? null,
  })
}

function defaultProjectName(target: string): string {
  try {
    return new URL(target).hostname.replace(/^www\./, '').slice(0, 60)
  } catch {
    return 'Verification'
  }
}

/**
 * `GET /api/v1/runs/:runId` - the report.
 *
 * Everything the CLI needs to print a verdict and everything CI needs to decide
 * an exit code, in one request, so a poll loop is one round trip per tick.
 */
export async function getRunHandler(
  request: Request,
  runId: string,
): Promise<Response> {
  const user = await authenticate(request)
  if (user instanceof Response) return user

  const { run, project } = await repo.assertRunAccess(runId, user.id)
  const [journeys, findings, steps, headers] = await Promise.all([
    repo.listJourneys(run.id),
    repo.listFindings(run.id),
    repo.listJourneySteps(run.id),
    repo.listProjectHeaders(project.id),
  ])

  const report: RunReport = {
    run,
    project,
    journeys,
    findings,
    remediation: leadingRemediation({
      findings,
      journeys,
      steps,
      run,
      headerNames: headers.map((header) => header.name),
      baseUrl: consoleUrl(''),
    }),
    url: consoleUrl(`/runs/${run.id}`),
  }

  return json(report)
}

/**
 * The fix instructions for the finding that decided this run.
 *
 * A confirmed defect first, and otherwise whatever else was recorded - because
 * the finding a CI log most needs to explain is often the one classified
 * `environment`: a run blocked by bot protection verified nothing at all, and
 * printing only "1 further failure" leaves the reader with no idea what to do.
 */
function leadingRemediation(input: {
  findings: Finding[]
  journeys: Journey[]
  steps: Array<{
    journeyId: string
    action: string
    target: string | null
    expected: string | null
    actual: string | null
    status: 'passed' | 'failed' | 'skipped'
  }>
  run: Run
  headerNames: string[]
  baseUrl: string
}): RunRemediation | null {
  const finding =
    input.findings.find((f) => f.classification === 'confirmed_bug') ??
    input.findings[0]
  if (!finding) return null

  const journey =
    input.journeys.find((j) => j.id === finding.journeyId) ?? null

  const remediation = remediationFor({
    finding,
    run: { targetUrl: input.run.targetUrl, executor: input.run.executor },
    journey: journey
      ? { name: journey.name, goal: journey.goal, entryPath: journey.entryPath }
      : null,
    steps: input.steps.filter((s) => s.journeyId === finding.journeyId),
    verificationHeaders: input.headerNames,
  })

  return {
    findingId: finding.id,
    findingUrl: `${input.baseUrl}/findings/${finding.id}`,
    headline: remediation.headline,
    owner: remediation.owner,
    steps: remediation.steps,
    prompt: remediation.prompt,
  }
}

/** `GET /api/v1/projects` - what this token can verify. */
export async function listProjectsHandler(request: Request): Promise<Response> {
  const user = await authenticate(request)
  if (user instanceof Response) return user

  return json({ projects: await repo.listProjects(user.id) })
}

/**
 * `DELETE /api/v1/projects/:projectId`
 *
 * Answers as soon as the project is invisible. Its evidence in R2 is removed by
 * the cleanup queue afterwards, which is why this is a 202 and not a 204: the
 * project is gone from every view, and the storage is on its way out.
 */
export async function deleteProjectHandler(
  request: Request,
  projectId: string,
): Promise<Response> {
  const user = await authenticate(request)
  if (user instanceof Response) return user

  await repo.assertProjectAccess(projectId, user.id)
  await requestProjectDeletion(projectId)

  return json({ deleted: projectId, artifacts: 'queued' }, 202)
}

/** `GET /api/v1/whoami` - what `forge login` calls to confirm a token works. */
export async function whoamiHandler(request: Request): Promise<Response> {
  const limited = await withinApiLimit(request)
  if (limited) return limited

  const user = await currentUser(request)
  if (!user) return apiError('That token is not valid.', 401)

  return json({
    user: { id: user.id, email: user.email, name: user.name },
    console: consoleUrl('/dashboard'),
  })
}
