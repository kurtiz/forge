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
 * so every ownership check below is the one the console already uses.
 */
import { z } from 'zod'
import {
  apiCreateRunSchema,
  type Project,
  type RunReport,
} from '../contracts'
import { currentUser } from '../auth'
import { env } from 'cloudflare:workers'
import {
  assertSafeTargetUrl,
  normaliseRepoUrl,
  UnsafeTargetError,
} from '../security'
import * as repo from '../runs/repository'
import { startRun } from '../runs/service'
import { requestProjectDeletion } from '../cleanup'

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
 * Maps a thrown error onto a status.
 *
 * `NotFound` and `Forbidden` both become 404, the same way the evidence route
 * does it: a token that names someone else's run must not be able to tell the
 * difference between "not yours" and "does not exist".
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof UnsafeTargetError) return apiError(error.message, 400)
  if (error instanceof repo.NotFoundError) return apiError('Not found.', 404)
  if (error instanceof repo.ForbiddenError) return apiError('Not found.', 404)
  if (error instanceof z.ZodError) {
    return apiError(error.issues[0]?.message ?? 'Invalid request.', 400)
  }
  const message = error instanceof Error ? error.message : 'Request failed.'
  return apiError(message, 400)
}

export type ApiUser = { id: string }

/** Resolves the caller, or returns the 401 to send back. */
export async function authenticate(
  request: Request,
): Promise<ApiUser | Response> {
  const user = await currentUser(request)
  if (!user) {
    return apiError(
      'Provide an API token: Authorization: Bearer forge_... Create one in the console under Settings.',
      401,
    )
  }
  return { id: user.id }
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
    trigger: 'cli',
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
  const [journeys, findings] = await Promise.all([
    repo.listJourneys(run.id),
    repo.listFindings(run.id),
  ])

  const report: RunReport = {
    run,
    project,
    journeys,
    findings,
    url: consoleUrl(`/runs/${run.id}`),
  }

  return json(report)
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
  const user = await currentUser(request)
  if (!user) return apiError('That token is not valid.', 401)

  return json({
    user: { id: user.id, email: user.email, name: user.name },
    console: consoleUrl('/dashboard'),
  })
}
