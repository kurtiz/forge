#!/usr/bin/env node
/**
 * Forge CLI.
 *
 * `forge verify` is the whole point: start a run against a deployed URL, watch
 * it, print what Forge can prove, and exit non-zero when it proved a defect.
 * That exit code is what makes this usable as a CI gate without a wrapper
 * script, so the classification rule is stated in one place and honoured
 * everywhere:
 *
 *   confirmed_bug  → exit 1
 *   anything else  → exit 0, reported but not blocking
 *
 * A flaky or environmental failure is real information and worth printing, but
 * blocking a merge on one teaches people to pass `--no-verify`, which costs
 * more than it saves.
 */
import { boolFlag, numberFlag, parseArgs, stringFlag, type Args } from './args.js'
import { ApiError, ForgeClient } from './client.js'
import {
  clearConfig,
  DEFAULT_HOST,
  normaliseHost,
  readConfig,
  writeConfig,
} from './config.js'
import {
  bold,
  clearProgress,
  dim,
  FAIL,
  fatal,
  green,
  note,
  out,
  PASS,
  progress,
  red,
  yellow,
} from './output.js'
import { TERMINAL_STATUSES, type Finding, type RunReport } from './types.js'

const KNOWN_FLAGS = new Set([
  'url',
  'repo',
  'goal',
  'name',
  'project',
  'token',
  'host',
  'json',
  'no-wait',
  'timeout',
  'help',
  'version',
])

const VERSION = '0.1.0'

const HELP = `${bold('forge')} — AI writes the code. Forge proves it works.

${bold('Usage')}
  forge verify --url <url> [options]
  forge login [--token <token>] [--host <url>]
  forge logout
  forge whoami
  forge projects

${bold('Verify options')}
  --url <url>        the deployed URL to verify
  --repo <url>       public GitHub repository, to link failures to source
  --goal <text>      the workflow that matters most
  --name <text>      project name, when one is created
  --project <id>     verify an existing project instead of a URL
  --json             print the full report as JSON
  --no-wait          start the run and exit without waiting
  --timeout <secs>   give up waiting after this long (default 900)

${bold('Environment')}
  FORGE_TOKEN        API token, overrides the stored one
  FORGE_HOST         Forge deployment, overrides the stored one

${bold('Which host a command talks to')}
  1. --host <url>            this command only
  2. FORGE_HOST              this shell or CI job
  3. ~/.forge/config.json    written by "forge login --host <url>"
  4. the built-in default    ${DEFAULT_HOST}

  A host with no scheme is read as https, and a trailing slash is dropped, so
  --host forge.example.com works but --host localhost:8787 needs its http://.

${bold('Exit codes')}
  0  no confirmed defects
  1  confirmed defects, or the run failed
  2  bad usage, or no credentials
`

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2), KNOWN_FLAGS)
  } catch (error) {
    return fatal(error instanceof Error ? error.message : String(error))
  }

  if (boolFlag(args, 'version') || args.command === 'version') {
    out(VERSION)
    return 0
  }
  if (boolFlag(args, 'help') || args.command === 'help') {
    out(HELP)
    return 0
  }

  switch (args.command) {
    case 'login':
      return login(args)
    case 'logout':
      await clearConfig()
      note('Signed out.')
      return 0
    case 'whoami':
      return whoami(args)
    case 'verify':
      return verify(args)
    case 'projects':
      return projects(args)
    default:
      note(HELP)
      return fatal(`Unknown command "${args.command}".`)
  }
}

/* ----------------------------------------------------------------- client */

/** Resolves credentials, or explains exactly how to get them. */
async function client(args: Args): Promise<ForgeClient> {
  const stored = await readConfig()
  const host = normaliseHost(
    stringFlag(args, 'host') ?? stored.host ?? DEFAULT_HOST,
  )
  const token = stringFlag(args, 'token') ?? stored.token

  if (!token) {
    return fatal(
      'No API token. Run "forge login", or set FORGE_TOKEN. Create a token in the Forge console under Settings.',
    )
  }

  return new ForgeClient(host, token)
}

/* ------------------------------------------------------------------ login */

async function login(args: Args): Promise<number> {
  const host = normaliseHost(
    stringFlag(args, 'host') ?? (await readConfig()).host ?? DEFAULT_HOST,
  )
  const token = stringFlag(args, 'token') ?? (await promptForToken(host))

  if (!token) return fatal('No token was entered.')

  // Verified before it is written: a token stored without being checked turns
  // one typo into a confusing failure much later, in CI, on someone else's day.
  const forge = new ForgeClient(host, token)
  let account: Awaited<ReturnType<ForgeClient['whoami']>>
  try {
    account = await forge.whoami()
  } catch (error) {
    return fatal(
      error instanceof ApiError
        ? `That token was rejected: ${error.message}`
        : String(error),
    )
  }

  const path = await writeConfig({ host, token })
  note(`${PASS} Signed in as ${bold(account.user.email)}`)
  note(dim(`  Token stored in ${path}`))
  return 0
}

/**
 * Reads a token from the terminal.
 *
 * Deliberately paste-based rather than a browser OAuth dance: the console
 * already issues tokens, and a CLI that shells out to a browser is the part
 * that breaks over SSH and in containers.
 */
async function promptForToken(host: string): Promise<string> {
  note(`Create a token at ${bold(`${host}/settings`)}`)
  process.stderr.write('Paste it here: ')

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  note('')
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function whoami(args: Args): Promise<number> {
  const forge = await client(args)
  try {
    const account = await forge.whoami()
    out(account.user.email)
    note(dim(account.console))
    return 0
  } catch (error) {
    return fatal(error instanceof Error ? error.message : String(error))
  }
}

async function projects(args: Args): Promise<number> {
  const forge = await client(args)
  try {
    const { projects: list } = await forge.listProjects()
    if (list.length === 0) {
      note('No projects yet. Run "forge verify --url <url>" to create one.')
      return 0
    }
    for (const project of list) {
      out(`${project.id}  ${project.name}  ${dim(project.targetUrl)}`)
    }
    return 0
  } catch (error) {
    return fatal(error instanceof Error ? error.message : String(error))
  }
}

/* ----------------------------------------------------------------- verify */

async function verify(args: Args): Promise<number> {
  const forge = await client(args)
  const url = stringFlag(args, 'url') ?? args.positional[0]
  const projectId = stringFlag(args, 'project')

  if (!url && !projectId) {
    return fatal('Give a URL to verify: forge verify --url https://preview.example.com')
  }

  const asJson = boolFlag(args, 'json')
  const timeoutSeconds = numberFlag(args, 'timeout', 900)

  let started: Awaited<ReturnType<ForgeClient['createRun']>>
  try {
    started = await forge.createRun({
      url,
      projectId,
      repo: stringFlag(args, 'repo'),
      goal: stringFlag(args, 'goal'),
      name: stringFlag(args, 'name'),
    })
  } catch (error) {
    return fatal(
      error instanceof Error ? error.message : 'Could not start the run.',
      1,
    )
  }

  if (!asJson) {
    note(`${bold('Forge verification')}`)
    note(dim(started.url))
    note('')
  }

  if (boolFlag(args, 'no-wait')) {
    if (asJson) out(JSON.stringify(started, null, 2))
    else note(`Run ${started.run.id} started.`)
    return 0
  }

  let report: RunReport
  try {
    report = await waitForRun(forge, started.run.id, timeoutSeconds, !asJson)
  } catch (error) {
    return fatal(error instanceof Error ? error.message : String(error), 1)
  }

  if (asJson) {
    out(JSON.stringify(report, null, 2))
  } else {
    printReport(report)
  }

  const bugs = report.findings.filter((f) => f.classification === 'confirmed_bug')
  if (report.run.status === 'failed') return 1
  return bugs.length > 0 ? 1 : 0
}

/**
 * Polls until the run reaches a terminal state.
 *
 * Polling rather than the console's SSE stream: a poll survives a proxy that
 * buffers, a laptop that sleeps, and a CI runner that drops idle connections,
 * and one request every three seconds is nothing next to the cost of the run
 * it is watching.
 */
async function waitForRun(
  forge: ForgeClient,
  runId: string,
  timeoutSeconds: number,
  showProgress: boolean,
): Promise<RunReport> {
  const deadline = Date.now() + timeoutSeconds * 1000
  const tick = showProgress ? progress() : () => {}
  let consecutiveErrors = 0

  for (;;) {
    if (Date.now() > deadline) {
      clearProgress()
      throw new Error(
        `Timed out after ${timeoutSeconds}s. The run is still going: it will finish in the console.`,
      )
    }

    try {
      const report = await forge.getRun(runId)
      consecutiveErrors = 0

      const journeys = report.journeys.length
      const done = report.journeys.filter(
        (j) => j.status === 'passed' || j.status === 'failed',
      ).length
      tick(
        journeys > 0
          ? `${report.run.status} — ${done}/${journeys} journeys`
          : report.run.status,
      )

      if (TERMINAL_STATUSES.includes(report.run.status)) {
        clearProgress()
        return report
      }
    } catch (error) {
      // A transient network blip should not fail a run that is going fine, but
      // a token that has been revoked mid-run should not be retried forever.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        clearProgress()
        throw error
      }
      if (++consecutiveErrors >= 5) {
        clearProgress()
        throw error
      }
    }

    await sleep(3000)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ----------------------------------------------------------------- report */

function printReport(report: RunReport): void {
  const { run, journeys, findings } = report

  if (run.status === 'canceled') {
    note(`${yellow('Canceled')} ${run.summary ?? ''}`)
    note(dim(report.url))
    return
  }

  if (run.status === 'failed') {
    note(`${FAIL} The run could not complete.`)
    note(dim(report.url))
    return
  }

  const passed = journeys.filter((j) => j.status === 'passed')
  const failed = journeys.filter((j) => j.status === 'failed')
  const skipped = journeys.filter((j) => j.status === 'skipped')

  out(`${PASS} Application reachable`)
  out(
    `${PASS} ${run.executor === 'solari' ? 'Browser session' : 'HTTP executor (no JavaScript)'}`,
  )
  out(`${PASS} ${journeys.length} journeys discovered`)
  if (passed.length > 0) out(`${PASS} ${passed.length} journeys passed`)
  if (failed.length > 0) out(`${FAIL} ${failed.length} journeys failed`)
  // Neither a pass nor a failure: nothing on the page matched, so nothing was
  // verified. Printed so a green run cannot be read as more than it is.
  if (skipped.length > 0) {
    out(`${yellow('!')} ${skipped.length} journeys could not be attempted`)
  }

  const bugs = findings.filter((f) => f.classification === 'confirmed_bug')
  const others = findings.filter((f) => f.classification !== 'confirmed_bug')

  if (bugs.length > 0) {
    out('')
    out(bold(bugs.length === 1 ? 'Finding' : 'Findings'))
    for (const finding of bugs) printFinding(finding)
  }

  if (others.length > 0) {
    out('')
    out(
      dim(
        `${others.length} further failure${others.length === 1 ? '' : 's'} classified as flaky or environmental:`,
      ),
    )
    for (const finding of others) {
      out(dim(`  ${finding.title} (${finding.classification})`))
    }
  }

  out('')
  if (bugs.length === 0) {
    out(
      passed.length > 0
        ? green('No confirmed defects.')
        : yellow('No confirmed defects, but no journey was actually exercised.'),
    )
  }
  out(dim('View:'))
  out(report.url)
  if (run.replayUrl) {
    out(dim('Replay:'))
    out(run.replayUrl)
  }
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

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    fatal(error instanceof Error ? error.message : String(error))
  })
