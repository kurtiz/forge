/**
 * Plain terminal output.
 *
 * This is what a CI log, a redirected stdout, and `--json` get. Colour is
 * applied only when the stream is a TTY and `NO_COLOR` is unset, so piping the
 * output into a file or a CI log produces clean text. Progress is written to
 * stderr and results to stdout, which is what makes
 * `forge verify --json | jq` work while the run is still going.
 *
 * On an interactive terminal the same information is drawn by the Ink views in
 * `ui/`. Both read the same `summarise()` result, so the two renderers cannot
 * disagree about what a run found.
 */
import { summarise, type Tone } from './summary.js'
import type { Finding, Remediation, RunReport } from './types.js'
/** Written as an escape sequence so the source file stays printable. */
const ESC = '\u001b['

const useColor =
  process.stdout.isTTY === true &&
  !process.env.NO_COLOR &&
  process.env.TERM !== 'dumb'

const wrap = (code: string) => (text: string) =>
  useColor ? `${ESC}${code}m${text}${ESC}0m` : text

export const bold = wrap('1')
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')
export const blue = wrap('36')

export const PASS = green('✓')
export const FAIL = red('✗')

const TONE: Record<Tone, (text: string) => string> = {
  pass: green,
  fail: red,
  warn: yellow,
  info: blue,
}

const GLYPH: Record<Tone, string> = {
  pass: '✓',
  fail: '✗',
  warn: '!',
  info: '›',
}

export function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

export function note(line = ''): void {
  process.stderr.write(`${line}\n`)
}

export function fatal(message: string, code = 2): never {
  process.stderr.write(`${red('Error')} ${message}\n`)
  process.exit(code)
}

/**
 * A one-line status that rewrites itself on a TTY and prints one line per
 * change everywhere else, so a CI log gets a readable phase history instead of
 * thousands of escape sequences.
 */
export function progress(): (message: string) => void {
  let last = ''
  return (message: string) => {
    if (message === last) return
    last = message
    if (process.stderr.isTTY) {
      process.stderr.write(`\r${ESC}2K${dim(message)}`)
    } else {
      process.stderr.write(`${message}\n`)
    }
  }
}

export function clearProgress(): void {
  if (process.stderr.isTTY) process.stderr.write(`\r${ESC}2K`)
}

/* ----------------------------------------------------------------- report */

export function printReport(
  report: RunReport,
  options: { fixPrompt?: boolean } = {},
): void {
  const summary = summarise(report)

  if (summary.state !== 'complete') {
    const mark = summary.state === 'canceled' ? yellow('Canceled') : FAIL
    note(`${mark} ${summary.reason ?? ''}`)
    note(dim(summary.url))
    return
  }

  for (const row of summary.rows) {
    out(`${TONE[row.tone](GLYPH[row.tone])} ${row.text}`)
  }

  if (summary.bugs.length > 0) {
    out('')
    out(bold(summary.bugs.length === 1 ? 'Finding' : 'Findings'))
    for (const finding of summary.bugs) printFinding(finding)
  }

  if (summary.others.length > 0) {
    out('')
    out(
      dim(
        `${summary.others.length} further failure${summary.others.length === 1 ? '' : 's'} classified as flaky or environmental:`,
      ),
    )
    for (const finding of summary.others) {
      out(dim(`  ${finding.title} (${finding.classification})`))
    }
  }

  if (summary.fix) printFix(summary.fix, options.fixPrompt === true)

  out('')
  // The count is already implied by the findings above, so only a clean or an
  // unexercised run needs its verdict spelled out.
  if (summary.verdict && summary.bugs.length === 0) {
    out(TONE[summary.verdict.tone](summary.verdict.text))
  }
  out(dim('View:'))
  out(summary.url)
  if (summary.replayUrl) {
    out(dim('Replay:'))
    out(summary.replayUrl)
  }
}

/**
 * What to do about it.
 *
 * The steps always, the agent brief only when asked for. A CI log is read by
 * whoever is on shift, and two kilobytes of prompt in front of them every run
 * is how a log stops being read at all - so the default is the headline, the
 * steps, and where the prompt is. `--fix` puts the prompt itself in the log,
 * for anyone piping it straight into an agent.
 */
function printFix(fix: Remediation, withPrompt: boolean): void {
  if (fix.owner === 'none') return

  out('')
  out(bold('How to fix'))
  out(`  ${fix.headline}`)
  fix.steps.forEach((step, index) => out(dim(`  ${index + 1}. ${step}`)))

  if (!fix.prompt) return

  if (withPrompt) {
    out('')
    out(dim('  Prompt for a coding agent:'))
    // Verbatim and unindented: this gets piped into a file or an agent, and
    // leading spaces are the kind of thing that turns a heading into a code
    // block on the way there.
    out(fix.prompt)
    return
  }

  out('')
  out(dim('  A prompt for your coding agent is on the finding page (--fix prints it here):'))
  out(`  ${fix.findingUrl}`)
}

function printFinding(finding: Finding): void {
  const severity =
    finding.severity === 'critical' || finding.severity === 'high'
      ? red(finding.severity)
      : yellow(finding.severity)

  out(`  ${severity}  ${bold(finding.title)}`)
  if (finding.reproductionAttempts > 0) {
    out(
      dim(
        `    reproduced ${finding.reproductionFailures}/${finding.reproductionAttempts} times`,
      ),
    )
  }
  if (finding.rootCause) out(dim(`    ${finding.rootCause}`))
  for (const file of finding.affectedFiles.slice(0, 3)) {
    out(dim(`    ${file}`))
  }
}
