/**
 * What a report means, separated from how it is drawn.
 *
 * The same run has to render twice: as an Ink panel on a terminal, and as
 * plain lines in a CI log. Deciding "seven journeys, one failed, two findings
 * that are not bugs" in one place is what stops the two from disagreeing about
 * a run someone is being asked to trust.
 */
import type { Finding, RunReport } from './types.js'

export type Tone = 'pass' | 'fail' | 'warn' | 'info'

export type Row = { tone: Tone; text: string }

export type Summary = {
  /** `canceled` and `failed` mean there is no result to show, only a reason. */
  state: 'canceled' | 'failed' | 'complete'
  reason: string | null
  rows: Row[]
  bugs: Finding[]
  others: Finding[]
  /** The one-line answer, or null when the run never got far enough to have one. */
  verdict: { tone: Tone; text: string } | null
  url: string
  replayUrl: string | null
}

export function summarise(report: RunReport): Summary {
  const { run, journeys, findings } = report

  const bugs = findings.filter((f) => f.classification === 'confirmed_bug')
  const others = findings.filter((f) => f.classification !== 'confirmed_bug')

  if (run.status === 'canceled' || run.status === 'failed') {
    return {
      state: run.status,
      reason:
        run.status === 'canceled'
          ? (run.summary ?? 'The run was canceled.')
          : 'The run could not complete.',
      rows: [],
      bugs: [],
      others: [],
      verdict: null,
      url: report.url,
      replayUrl: run.replayUrl,
    }
  }

  const passed = journeys.filter((j) => j.status === 'passed')
  const failed = journeys.filter((j) => j.status === 'failed')
  const skipped = journeys.filter((j) => j.status === 'skipped')

  /** "1 journeys failed" reads as a bug in the tool, not a bug in the app. */
  const journeyCount = (n: number) => `${n} journey${n === 1 ? '' : 's'}`

  const rows: Row[] = [
    { tone: 'pass', text: 'Application reachable' },
    {
      tone: 'pass',
      text:
        run.executor === 'solari'
          ? 'Browser session'
          : 'HTTP executor (no JavaScript)',
    },
    { tone: 'pass', text: `${journeyCount(journeys.length)} discovered` },
  ]

  if (passed.length > 0) {
    rows.push({ tone: 'pass', text: `${journeyCount(passed.length)} passed` })
  }
  if (failed.length > 0) {
    rows.push({ tone: 'fail', text: `${journeyCount(failed.length)} failed` })
  }
  // Neither a pass nor a failure: nothing on the page matched, so nothing was
  // verified. Kept so a green run cannot be read as more than it is.
  if (skipped.length > 0) {
    rows.push({
      tone: 'warn',
      text: `${journeyCount(skipped.length)} could not be attempted`,
    })
  }

  return {
    state: 'complete',
    reason: null,
    rows,
    bugs,
    others,
    verdict:
      bugs.length > 0
        ? {
            tone: 'fail',
            text: `${bugs.length} confirmed defect${bugs.length === 1 ? '' : 's'}.`,
          }
        : passed.length > 0
          ? { tone: 'pass', text: 'No confirmed defects.' }
          : {
              tone: 'warn',
              text: 'No confirmed defects, but no journey was actually exercised.',
            },
    url: report.url,
    replayUrl: run.replayUrl,
  }
}

/** How far along a run is, for a progress bar that has something to fill. */
export function journeyProgress(report: RunReport): {
  done: number
  total: number
} {
  const total = report.journeys.length
  const done = report.journeys.filter(
    (j) =>
      j.status === 'passed' || j.status === 'failed' || j.status === 'skipped',
  ).length
  return { done, total }
}
