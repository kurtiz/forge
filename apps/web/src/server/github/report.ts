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
import { remediationFor, type RemediationStep } from '@/server/domain/remediation'

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
  /** Every step of the run, so the agent brief can carry the failing ones. */
  steps?: readonly (RemediationStep & { journeyId: string })[]
  /** Names of the project's verification headers, which shape the fix advice. */
  verificationHeaders?: readonly string[]
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

  /*
   * The fix instructions, for the one finding that decides this check.
   *
   * One, not all of them: the check summary is read in a diff view, and a
   * reviewer handed five briefs pastes none of them. The rest are on the
   * finding pages, which is what the links above are for.
   */
  const leading = bugs[0] ?? others[0]
  if (leading) {
    lines.push(renderFixSection(leading, input), '')
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

/**
 * Renders the remediation as a collapsed block.
 *
 * Collapsed because the check summary is skimmed and this is not the part a
 * reviewer skims - it is the part they open once they have decided to act, and
 * then copy whole into an agent.
 */
function renderFixSection(
  finding: Finding,
  input: {
    run: Run
    journeys: Journey[]
    steps?: readonly (RemediationStep & { journeyId: string })[]
    verificationHeaders?: readonly string[]
  },
): string {
  const journey = input.journeys.find((j) => j.id === finding.journeyId) ?? null
  const remediation = remediationFor({
    finding,
    run: { targetUrl: input.run.targetUrl, executor: input.run.executor },
    journey: journey
      ? { name: journey.name, goal: journey.goal, entryPath: journey.entryPath }
      : null,
    steps: (input.steps ?? []).filter((s) => s.journeyId === finding.journeyId),
    verificationHeaders: input.verificationHeaders,
  })

  const body: string[] = [
    '<details>',
    `<summary><b>How to fix: ${escapeHtml(finding.title)}</b></summary>`,
    '',
    remediation.headline,
    '',
  ]
  remediation.steps.forEach((step, index) => body.push(`${index + 1}. ${step}`))

  if (remediation.prompt) {
    body.push(
      '',
      'Paste this into your coding agent:',
      '',
      '```text',
      remediation.prompt,
      '```',
    )
  }

  body.push('', '</details>')
  return body.join('\n')
}

/** A `summary` line is HTML, not Markdown. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Table cells cannot contain a raw pipe. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}
