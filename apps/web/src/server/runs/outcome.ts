/**
 * What happens after a run ends.
 *
 * Two outward-facing consequences, both of them optional and neither allowed to
 * affect the run itself: a GitHub check gets its conclusion, and a monitoring
 * schedule records the tick and may notify a webhook.
 *
 * This lives outside the engine on purpose. The engine's job finishes when the
 * evidence is written; publishing is a separate concern that must also happen
 * when the engine throws or the user cancels, which is exactly the shape of the
 * Durable Object's `finally`.
 */
import type {
  Finding,
  Run,
  RunRemediation,
  ScheduleOutcome,
} from '@/server/contracts'
import { concludeCheckRun, renderCheckReport } from '@/server/github/checks'
import { githubConfigured } from '@/server/github/app'
import * as monitor from '@/server/monitoring/repository'
import { notificationText, shouldNotify } from '@/server/monitoring/schedule'
import { remediationFor } from '@/server/domain/remediation'
import { assertSafeTargetUrl } from '@/server/security'
import { env } from 'cloudflare:workers'
import * as repo from './repository'

/**
 * Publishes everything a finished run owes the outside world.
 *
 * Never throws. A failed check update or an unreachable webhook is a delivery
 * problem, and the run and its evidence are already durable.
 */
export async function publishRunOutcome(runId: string): Promise<void> {
  const loaded = await repo.getRunForCompletion(runId).catch(() => null)
  if (!loaded) return

  await publishCheck(loaded).catch(() => undefined)
  await publishSchedule(loaded.run, loaded.project.name).catch(() => undefined)
}

/* --------------------------------------------------------------- GitHub */

async function publishCheck(loaded: {
  run: Run
  github: repo.RunGitHubRow
  project: { repoUrl: string | null }
}): Promise<void> {
  const { checkRunId, githubInstallationId } = loaded.github
  if (!checkRunId || !githubInstallationId || !githubConfigured()) return

  const repoFullName = loaded.project.repoUrl
    ?.replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
  if (!repoFullName) return

  const [journeys, findings, steps, headers] = await Promise.all([
    repo.listJourneys(loaded.run.id),
    repo.listFindings(loaded.run.id),
    // Carried so the check's fix instructions quote the steps as they ran,
    // rather than describing a failure in the abstract.
    repo.listJourneySteps(loaded.run.id),
    repo.listProjectHeaders(loaded.run.projectId),
  ])

  const report = renderCheckReport({
    run: loaded.run,
    journeys,
    findings,
    steps,
    verificationHeaders: headers.map((header) => header.name),
  })

  await concludeCheckRun({
    installationId: githubInstallationId,
    repoFullName,
    checkRunId,
    conclusion: report.conclusion,
    title: report.title,
    summary: report.summary,
  })
}

/* ----------------------------------------------------------- monitoring */

async function publishSchedule(run: Run, projectName: string): Promise<void> {
  if (run.trigger !== 'scheduled') return

  const schedule = await monitor.scheduleForRun(run.id)
  if (!schedule) return

  const findings = await repo.listFindings(run.id)
  const outcome = scheduleOutcome(run, findings)
  const consecutiveFailures =
    outcome === 'passed' ? 0 : schedule.consecutiveFailures + 1

  await monitor.recordScheduleOutcome({
    scheduleId: schedule.id,
    runId: run.id,
    outcome,
    consecutiveFailures,
  })

  const decision = shouldNotify({
    previousOutcome: schedule.lastOutcome,
    outcome,
    consecutiveFailures,
  })
  if (!decision.notify || !schedule.notifyUrl) return

  /*
   * The fix instructions for the finding that decided this tick.
   *
   * A monitor exists to be read by whoever is not looking at the console, so
   * the alert has to carry more than "nothing was verified". The headline and
   * the finding link go in the text a chat client renders; the steps and the
   * agent brief go in the JSON, for a webhook that does something with them.
   */
  const remediation = await leadingRemediation(run, findings)

  await notify(schedule.notifyUrl, {
    text: notificationText({
      reason: decision.reason,
      projectName,
      targetUrl: run.targetUrl,
      summary: run.summary ?? 'The run did not complete.',
      runUrl: consoleUrl(`/runs/${run.id}`),
      consecutiveFailures,
      fix: remediation
        ? { headline: remediation.headline, url: remediation.findingUrl }
        : null,
    }),
    project: projectName,
    outcome,
    runId: run.id,
    runUrl: consoleUrl(`/runs/${run.id}`),
    targetUrl: run.targetUrl,
    findings: findings
      .filter((f) => f.classification === 'confirmed_bug')
      .map((f) => ({ title: f.title, severity: f.severity })),
    remediation,
  })
}

/**
 * What to do about the finding that decided the tick, or nothing.
 *
 * A confirmed defect first, and otherwise whatever else was recorded - because
 * the finding a monitor most needs to explain is often the one classified
 * `environment`. A tick blocked by bot protection verified nothing at all, and
 * an alert that only says so leaves the reader with no next step.
 */
async function leadingRemediation(
  run: Run,
  findings: Finding[],
): Promise<RunRemediation | null> {
  const finding =
    findings.find((f) => f.classification === 'confirmed_bug') ?? findings[0]
  if (!finding) return null

  const [journeys, steps, headers] = await Promise.all([
    repo.listJourneys(run.id),
    repo.listJourneySteps(run.id),
    repo.listProjectHeaders(run.projectId),
  ])

  const journey = journeys.find((j) => j.id === finding.journeyId) ?? null

  const remediation = remediationFor({
    finding,
    run: { targetUrl: run.targetUrl, executor: run.executor },
    journey: journey
      ? { name: journey.name, goal: journey.goal, entryPath: journey.entryPath }
      : null,
    steps: steps.filter((s) => s.journeyId === finding.journeyId),
    verificationHeaders: headers.map((header) => header.name),
  })

  return {
    findingId: finding.id,
    findingUrl: consoleUrl(`/findings/${finding.id}`),
    headline: remediation.headline,
    owner: remediation.owner,
    steps: remediation.steps,
    prompt: remediation.prompt,
  }
}

/**
 * A scheduled tick is green only when the run completed with no confirmed
 * defect. A flaky or environmental failure is not a regression, and a run that
 * could not complete is `error` rather than a silent pass.
 */
function scheduleOutcome(
  run: Run,
  findings: Array<{ classification: string }>,
): ScheduleOutcome {
  if (run.status === 'failed') return 'error'
  if (run.status !== 'completed') return 'error'
  return findings.some((f) => f.classification === 'confirmed_bug')
    ? 'failed'
    : 'passed'
}

function consoleUrl(path: string): string {
  return `${(env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}${path}`
}

/**
 * Posts the notification.
 *
 * The URL is user-supplied and this fetch originates from the Worker, so it
 * goes through the same SSRF policy as a verification target. A webhook that
 * points at link-local space is not a notification, it is a probe.
 */
async function notify(url: string, body: unknown): Promise<void> {
  const safe = assertSafeTargetUrl(url)

  await fetch(safe.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
}
