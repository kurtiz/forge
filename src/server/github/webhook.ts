/**
 * GitHub webhook handling.
 *
 * The flow this implements:
 *
 *   pull request opened or updated
 *          ↓
 *   a preview deployment exists           ← reported by the host, or derived
 *          ↓                                 from the project's URL template
 *   Forge verification run
 *          ↓
 *   GitHub check on the head commit
 *
 * Three rules hold the whole thing together:
 *
 *   - Nothing runs for an installation nobody has claimed. A webhook cannot
 *     name the account it runs on behalf of; only the console link can.
 *   - Nothing runs without a target URL that passes the same SSRF policy as a
 *     URL typed into the console. A deployment payload is user-controlled.
 *   - Every run carries an idempotency key derived from the commit, so the
 *     several events that describe one deployment produce one billable run.
 */
import { assertSafeTargetUrl, UnsafeTargetError } from '../security'
import * as repo from '../runs/repository'
import { startRun } from '../runs/service'
import { openCheckRun } from './checks'
import {
  installationOwner,
  markInstallationDeleted,
  recordInstallation,
} from './installations'
import { resolvePreviewTemplate } from './preview-url'

/** What a delivery did, for the response body and the logs. */
export type WebhookOutcome = {
  handled: boolean
  detail: string
  runId?: string
}

const ignored = (detail: string): WebhookOutcome => ({ handled: false, detail })

type Payload = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null
const obj = (value: unknown): Payload | null =>
  typeof value === 'object' && value !== null ? (value as Payload) : null
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export async function handleWebhook(
  event: string,
  payload: Payload,
): Promise<WebhookOutcome> {
  switch (event) {
    case 'ping':
      return { handled: true, detail: 'pong' }
    case 'installation':
      return handleInstallation(payload)
    case 'pull_request':
      return handlePullRequest(payload)
    case 'deployment_status':
      return handleDeploymentStatus(payload)
    default:
      return ignored(`No handler for "${event}".`)
  }
}

/* -------------------------------------------------------- installations */

async function handleInstallation(payload: Payload): Promise<WebhookOutcome> {
  const action = str(payload.action)
  const installation = obj(payload.installation)
  const id = installation ? String(installation.id ?? '') : ''
  if (!id) return ignored('Installation payload had no id.')

  if (action === 'deleted' || action === 'suspend') {
    await markInstallationDeleted(id)
    return { handled: true, detail: `Installation ${id} removed.` }
  }

  const account = obj(installation?.account)
  await recordInstallation({
    id,
    accountLogin: str(account?.login) ?? 'unknown',
    accountType: str(account?.type) ?? 'User',
  })

  return {
    handled: true,
    detail: `Installation ${id} recorded. It stays inactive until a Forge user links it.`,
  }
}

/* --------------------------------------------------------- pull requests */

const PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review'])

async function handlePullRequest(payload: Payload): Promise<WebhookOutcome> {
  const action = str(payload.action)
  if (!action || !PR_ACTIONS.has(action)) {
    return ignored(`Pull request action "${action}" needs no verification.`)
  }

  const pull = obj(payload.pull_request)
  if (!pull) return ignored('Pull request payload was malformed.')
  if (pull.draft === true) return ignored('Draft pull requests are not verified.')

  const head = obj(pull.head)
  const commitSha = str(head?.sha)
  const branch = str(head?.ref)
  const number = num(pull.number)
  if (!commitSha) return ignored('Pull request payload had no head commit.')

  const context = await resolveContext(payload)
  if ('detail' in context) return ignored(context.detail)

  /*
   * Without a template there is nothing to verify yet: the preview does not
   * exist at the moment the pull request opens. The `deployment_status` event
   * carries the URL once the host has published it, and that is what starts
   * the run.
   */
  const target = resolvePreviewTemplate(context.project.previewUrlTemplate, {
    number,
    branch,
    sha: commitSha,
  })

  if (!target) {
    return ignored(
      'No preview URL template on the project; waiting for a deployment event.',
    )
  }

  return startVerification({
    userId: context.userId,
    projectId: context.project.id,
    installationId: context.installationId,
    repoFullName: context.repoFullName,
    targetUrl: target,
    commitSha,
    pullRequestNumber: number,
  })
}

/* ----------------------------------------------------------- deployments */

async function handleDeploymentStatus(payload: Payload): Promise<WebhookOutcome> {
  const status = obj(payload.deployment_status)
  if (str(status?.state) !== 'success') {
    return ignored('Deployment is not successful yet.')
  }

  const environmentUrl = str(status?.environment_url) ?? str(status?.target_url)
  if (!environmentUrl) return ignored('Deployment reported no environment URL.')

  const deployment = obj(payload.deployment)
  const commitSha = str(deployment?.sha)
  if (!commitSha) return ignored('Deployment payload had no commit.')

  // Production deployments are not what this integration is for: a check on a
  // commit that already shipped helps nobody, and it would double every merge.
  const environment = str(deployment?.environment)?.toLowerCase() ?? ''
  if (environment === 'production' || environment === 'prod') {
    return ignored('Production deployments are not verified.')
  }

  const context = await resolveContext(payload)
  if ('detail' in context) return ignored(context.detail)

  return startVerification({
    userId: context.userId,
    projectId: context.project.id,
    installationId: context.installationId,
    repoFullName: context.repoFullName,
    targetUrl: environmentUrl,
    commitSha,
    // A deployment does not name its pull request. The check lands on the
    // commit, which is what GitHub renders on the pull request anyway.
    pullRequestNumber: null,
  })
}

/* ------------------------------------------------------------- resolving */

type Context = {
  userId: string
  installationId: string
  repoFullName: string
  project: Awaited<ReturnType<typeof repo.listProjectsForRepo>>[number]
}

/**
 * Resolves a delivery to the account and project it acts on, or explains why
 * it does not act at all.
 */
async function resolveContext(
  payload: Payload,
): Promise<Context | { detail: string }> {
  const installation = obj(payload.installation)
  const installationId = installation ? String(installation.id ?? '') : ''
  if (!installationId) return { detail: 'Delivery carried no installation.' }

  const userId = await installationOwner(installationId)
  if (!userId) {
    return {
      detail: `Installation ${installationId} is not linked to a Forge account.`,
    }
  }

  const repository = obj(payload.repository)
  const repoFullName = str(repository?.full_name)
  if (!repoFullName) return { detail: 'Delivery carried no repository.' }

  const projects = await repo.listProjectsForRepo(userId, repoFullName)
  if (projects.length === 0) {
    return { detail: `No Forge project points at ${repoFullName}.` }
  }

  // One project per repository is the case that matters; if there are several,
  // the oldest is the canonical one rather than fanning out billable runs.
  return { userId, installationId, repoFullName, project: projects[0] }
}

/* -------------------------------------------------------------- starting */

async function startVerification(input: {
  userId: string
  projectId: string
  installationId: string
  repoFullName: string
  targetUrl: string
  commitSha: string
  pullRequestNumber: number | null
}): Promise<WebhookOutcome> {
  let safeTarget: string
  try {
    safeTarget = assertSafeTargetUrl(input.targetUrl).toString()
  } catch (error) {
    // A deployment URL is user-controlled input arriving over a public
    // endpoint, so it gets the same policy as one typed into the console.
    const detail =
      error instanceof UnsafeTargetError ? error.message : 'Preview URL rejected.'
    return ignored(`Preview URL was not verifiable: ${detail}`)
  }

  const run = await startRun({
    userId: input.userId,
    projectId: input.projectId,
    trigger: 'pull_request',
    targetUrl: safeTarget,
    // One run per commit, however many events describe that commit.
    idempotencyKey: `gh:${input.commitSha}`,
    github: {
      commitSha: input.commitSha,
      pullRequestNumber: input.pullRequestNumber,
      installationId: input.installationId,
    },
  })

  /*
   * A pull request event and a deployment event commonly describe the same
   * commit, and both reach here. The idempotency key already collapses them
   * into one run; this collapses them into one check, which the run status
   * alone would not do while that run is still queued.
   */
  if (await repo.runCheckRunId(run.id)) {
    return {
      handled: true,
      runId: run.id,
      detail: `Commit ${input.commitSha.slice(0, 7)} is already being verified.`,
    }
  }

  /*
   * The check is opened here rather than inside the engine so it appears on the
   * commit immediately, while the browser is still starting. A failure to open
   * it must not sink the run: the verification is the product, the check is the
   * notification.
   */
  try {
    const checkRunId = await openCheckRun({
      installationId: input.installationId,
      repoFullName: input.repoFullName,
      commitSha: input.commitSha,
      runId: run.id,
    })
    if (checkRunId) await repo.updateRun(run.id, { checkRunId })
  } catch {
    // Reported on the run itself; the verification continues regardless.
  }

  return {
    handled: true,
    runId: run.id,
    detail: `Verifying ${safeTarget} for ${input.commitSha.slice(0, 7)}.`,
  }
}
