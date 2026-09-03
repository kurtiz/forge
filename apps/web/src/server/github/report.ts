/**
 * The check body.
 *
 * Pure: the console base URL is passed in rather than read from the
 * environment, the same split as `security/target-url.ts` and its env-bound
 * wrapper. That is what makes the conclusion policy testable, and the policy is
 * the part worth testing:
 *
 *   confirmed defect  → failure, the pull request is blocked
 *   flaky / environment / agent error → neutral, reported but not blocking
 *   nothing at all    → success
 *
 * Blocking a merge on a rate limit or on Forge's own hiccup would teach people
 * to ignore the check, which is worse than not having one.
 */
import type { Finding, Journey, Run } from '@/server/contracts'

export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled'

export type CheckReport = {
  conclusion: CheckConclusion
  title: string
  summary: string
}

export function renderCheckReport(input: {
  run: Run
  journeys: Journey[]
  findings: Finding[]
  /** Console origin, without a trailing slash. */
  baseUrl: string
}): CheckReport {
  const { run, journeys, findings } = input
  const base = input.baseUrl.replace(/\/+$/, '')
  const runUrl = `${base}/runs/${run.id}`

  if (run.status === 'canceled') {
    return {
      conclusion: 'cancelled',
      title: 'Verification canceled',
      summary: `The verification run was canceled.\n\n[Open the run](${runUrl})`,
    }
  }

  if (run.status !== 'completed') {
    return {
      conclusion: 'neutral',
      title: 'Verification could not complete',
      summary: [
        'Forge could not finish verifying this deployment, so this check is inconclusive rather than failing.',
        '',
        `[Open the run](${runUrl})`,
      ].join('\n'),
    }
  }

  const passed = journeys.filter((j) => j.status === 'passed').length
  const failed = journeys.filter((j) => j.status === 'failed').length
  const skipped = journeys.filter((j) => j.status === 'skipped').length
  const bugs = findings.filter((f) => f.classification === 'confirmed_bug')
  const others = findings.filter((f) => f.classification !== 'confirmed_bug')

  const lines: string[] = []
  lines.push(
    `**${passed} of ${journeys.length} journeys passed**${failed > 0 ? ` · ${failed} failed` : ''}${skipped > 0 ? ` · ${skipped} could not be attempted` : ''}`,
  )
  lines.push('')

  if (bugs.length > 0) {
    lines.push('| Severity | Finding | Reproduced |')
    lines.push('| --- | --- | --- |')
    for (const finding of bugs) {
      lines.push(
        `| ${finding.severity} | [${escapeCell(finding.title)}](${base}/findings/${finding.id}) | ${finding.reproductionFailures}/${finding.reproductionAttempts} |`,
      )
    }
    lines.push('')
  }

  if (others.length > 0) {
    lines.push(
      `${others.length} further failure${others.length === 1 ? ' was' : 's were'} classified as flaky or environmental and did not fail this check.`,
    )
    lines.push('')
  }

  if (run.executor === 'fetch') {
    lines.push(
      '_Verified with the HTTP executor: no JavaScript ran, so client-side failures were not visible._',
      '',
    )
  }

  lines.push(`[Open the run](${runUrl})`)
  if (run.replayUrl) lines.push(`· [Watch the session replay](${run.replayUrl})`)

  const summary = lines.join('\n')

  if (bugs.length > 0) {
    return {
      conclusion: 'failure',
      title: `${bugs.length} confirmed defect${bugs.length === 1 ? '' : 's'}`,
      summary,
    }
  }

  if (others.length > 0) {
    return { conclusion: 'neutral', title: 'No confirmed defects', summary }
  }

  /*
   * A run that exercised nothing is not a pass. Reporting one as success is
   * how a green check comes to mean "Forge could not find anything to do",
   * which is the opposite of what a reviewer will read it as.
   */
  if (passed === 0) {
    return {
      conclusion: 'neutral',
      title:
        journeys.length === 0
          ? 'Nothing was discovered to verify'
          : 'No journey could be attempted',
      summary,
    }
  }

  return {
    conclusion: 'success',
    title: `${passed} of ${journeys.length} journeys passed`,
    summary,
  }
}

/** Table cells cannot contain a raw pipe. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}
