/**
 * The verify view: a live panel while the run is going, the result when it is
 * not.
 *
 * Only reached on a terminal. A CI log gets the plain renderer in output.ts,
 * because a redrawing panel in a log file is thousands of escape sequences and
 * no information.
 */
import { Box, Text, render } from 'ink'
import type { Finding, Journey, RunReport, RunStatus } from '../types.js'
import { journeyProgress, summarise } from '../summary.js'
import { Bar, Elapsed, Icon, Severity, Spinner } from './theme.js'

/** What the phases are called, in the order a run moves through them. */
const PHASE: Record<RunStatus, string> = {
  queued: 'Queued',
  starting: 'Starting the browser',
  discovering: 'Discovering journeys',
  testing: 'Running journeys',
  investigating: 'Reproducing failures',
  reporting: 'Writing the report',
  completed: 'Complete',
  failed: 'Failed',
  canceled: 'Canceled',
}

const JOURNEY_TONE = {
  passed: 'pass',
  failed: 'fail',
  skipped: 'warn',
  running: 'info',
  pending: 'info',
} as const

function Header({ target, runUrl }: { target: string; runUrl: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text backgroundColor="cyan" color="black" bold>
          {' FORGE '}
        </Text>
        <Text bold> {target}</Text>
      </Box>
      <Text dimColor>{runUrl}</Text>
    </Box>
  )
}

function JourneyLine({ journey }: { journey: Journey }) {
  if (journey.status === 'running') {
    return (
      <Box>
        <Spinner />
        <Text> {journey.name}</Text>
      </Box>
    )
  }

  if (journey.status === 'pending') {
    return (
      <Box>
        <Text dimColor>·</Text>
        <Text dimColor> {journey.name}</Text>
      </Box>
    )
  }

  const tone = JOURNEY_TONE[journey.status]
  return (
    <Box>
      <Icon tone={tone} />
      <Text> {journey.name}</Text>
    </Box>
  )
}

function Live({
  report,
  startedAt,
}: {
  report: RunReport | null
  startedAt: number
}) {
  const status = report?.run.status ?? 'queued'
  const { done, total } = report
    ? journeyProgress(report)
    : { done: 0, total: 0 }

  return (
    <Box flexDirection="column">
      <Box>
        <Spinner />
        <Text bold> {PHASE[status]}</Text>
        <Text> </Text>
        <Elapsed since={startedAt} />
      </Box>

      {total > 0 && (
        <Box marginTop={1}>
          <Bar done={done} total={total} />
          <Text dimColor>
            {' '}
            {done}/{total}
          </Text>
        </Box>
      )}

      {report && report.journeys.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {report.journeys.map((journey) => (
            <JourneyLine key={journey.id} journey={journey} />
          ))}
        </Box>
      )}
    </Box>
  )
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Severity level={finding.severity} />
        <Text bold> {finding.title}</Text>
      </Box>
      {finding.reproductionAttempts > 0 && (
        <Text dimColor>
          {'  '}reproduced {finding.reproductionFailures}/
          {finding.reproductionAttempts} times
        </Text>
      )}
      {finding.rootCause && <Text dimColor>{'  '}{finding.rootCause}</Text>}
      {finding.affectedFiles.slice(0, 3).map((file) => (
        <Text key={file} dimColor>
          {'  '}
          {file}
        </Text>
      ))}
    </Box>
  )
}

function Result({ report }: { report: RunReport }) {
  const summary = summarise(report)

  if (summary.state !== 'complete') {
    return (
      <Box flexDirection="column">
        <Box>
          <Icon tone={summary.state === 'canceled' ? 'warn' : 'fail'} />
          <Text bold> {summary.reason}</Text>
        </Box>
        <Text dimColor>{summary.url}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {summary.rows.map((row) => (
        <Box key={row.text}>
          <Icon tone={row.tone} />
          <Text> {row.text}</Text>
        </Box>
      ))}

      {summary.bugs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>
            {summary.bugs.length === 1 ? 'Finding' : 'Findings'}
          </Text>
          {summary.bugs.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </Box>
      )}

      {summary.others.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {summary.others.length} further failure
            {summary.others.length === 1 ? '' : 's'} classified as flaky or
            environmental:
          </Text>
          {summary.others.map((finding) => (
            <Text key={finding.id} dimColor>
              {'  '}
              {finding.title} ({finding.classification})
            </Text>
          ))}
        </Box>
      )}

      {summary.fix && summary.fix.owner !== 'none' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>
            How to fix
          </Text>
          <Text>{summary.fix.headline}</Text>
          {summary.fix.steps.map((step, index) => (
            <Text key={step} dimColor>
              {'  '}
              {index + 1}. {step}
            </Text>
          ))}
          {summary.fix.prompt && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>
                A prompt for your coding agent is on the finding page:
              </Text>
              <Text color="cyan">{summary.fix.findingUrl}</Text>
            </Box>
          )}
        </Box>
      )}

      {summary.verdict && (
        <Box marginTop={1}>
          <Text
            color={
              summary.verdict.tone === 'pass'
                ? 'green'
                : summary.verdict.tone === 'warn'
                  ? 'yellow'
                  : 'red'
            }
            bold
          >
            {summary.verdict.text}
          </Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>View:</Text>
        <Text color="cyan">{summary.url}</Text>
        {summary.replayUrl && (
          <>
            <Text dimColor>Replay:</Text>
            <Text color="cyan">{summary.replayUrl}</Text>
          </>
        )}
      </Box>
    </Box>
  )
}

function Verify({
  target,
  runUrl,
  report,
  startedAt,
  finished,
}: {
  target: string
  runUrl: string
  report: RunReport | null
  startedAt: number
  finished: boolean
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={finished ? 'gray' : 'cyan'}
      paddingX={1}
      paddingY={0}
    >
      <Header target={target} runUrl={runUrl} />
      {finished && report ? (
        <Result report={report} />
      ) : (
        <Live report={report} startedAt={startedAt} />
      )}
    </Box>
  )
}

/**
 * Drives the panel from outside React: the polling loop already exists and owns
 * the run, so it pushes reports in rather than the view fetching its own.
 */
export function startVerifyView(target: string, runUrl: string) {
  const startedAt = Date.now()
  let latest: RunReport | null = null

  const draw = (finished: boolean) =>
    instance.rerender(
      <Verify
        target={target}
        runUrl={runUrl}
        report={latest}
        startedAt={startedAt}
        finished={finished}
      />,
    )

  const instance = render(
    <Verify
      target={target}
      runUrl={runUrl}
      report={null}
      startedAt={startedAt}
      finished={false}
    />,
  )

  return {
    update(report: RunReport) {
      latest = report
      draw(false)
    },
    /** Draws the result into the same panel, then stops re-rendering. */
    finish(report: RunReport) {
      latest = report
      draw(true)
      instance.unmount()
    },
    /** Leaves whatever was on screen; the error is printed by the caller. */
    stop() {
      instance.unmount()
    },
  }
}
