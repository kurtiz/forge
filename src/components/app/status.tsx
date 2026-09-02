/**
 * Status vocabulary.
 *
 * Run state, journey state, severity, and classification all get read at a
 * glance, so they share one visual language: a semantic colour plus a word.
 * Colour never carries meaning on its own - every badge has a label, and every
 * dot sits next to text.
 */
import type {
  Classification,
  FailureClass,
  JourneyStatus,
  RunStatus,
  RunTrigger,
  Severity,
} from '#/server/contracts'

type Tone = 'pass' | 'fail' | 'warn' | 'live' | 'idle'

const TONE_TEXT: Record<Tone, string> = {
  pass: 'text-[var(--forge-pass)]',
  fail: 'text-[var(--forge-fail)]',
  warn: 'text-[var(--forge-warn)]',
  live: 'text-[var(--forge-live)]',
  idle: 'text-kumo-subtle',
}

const TONE_DOT: Record<Tone, string> = {
  pass: 'bg-[var(--forge-pass)]',
  fail: 'bg-[var(--forge-fail)]',
  warn: 'bg-[var(--forge-warn)]',
  live: 'bg-[var(--forge-live)]',
  idle: 'bg-[var(--forge-idle)]',
}

const RUN_TONE: Record<RunStatus, Tone> = {
  queued: 'idle',
  starting: 'live',
  discovering: 'live',
  testing: 'live',
  investigating: 'live',
  reporting: 'live',
  completed: 'pass',
  failed: 'fail',
  canceled: 'idle',
}

const RUN_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  starting: 'Starting',
  discovering: 'Discovering',
  testing: 'Testing',
  investigating: 'Investigating',
  reporting: 'Reporting',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: 'fail',
  high: 'fail',
  medium: 'warn',
  low: 'idle',
}

const JOURNEY_TONE: Record<JourneyStatus, Tone> = {
  pending: 'idle',
  running: 'live',
  passed: 'pass',
  failed: 'fail',
  skipped: 'idle',
}

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  confirmed_bug: 'Confirmed bug',
  flaky: 'Flaky',
  environment: 'Environment',
  agent_error: 'Agent error',
  unknown: 'Unconfirmed',
}

export const FAILURE_CLASS_LABEL: Record<FailureClass, string> = {
  APPLICATION_BUG: 'Application bug',
  AUTH_FAILURE: 'Authentication',
  NETWORK_FAILURE: 'Network',
  TIMEOUT: 'Timeout',
  ENVIRONMENT_FAILURE: 'Environment',
  BROWSER_FAILURE: 'Browser',
  SOLARI_FAILURE: 'Solari',
  AGENT_ERROR: 'Agent',
  UNKNOWN: 'Unknown',
}

export const isRunLive = (status: RunStatus) =>
  RUN_TONE[status] === 'live' || status === 'queued'

function Dot({ tone, live }: { tone: Tone; live?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]} ${
        live ? 'pulse-live' : ''
      }`}
    />
  )
}

function Pill({
  tone,
  children,
  live,
}: {
  tone: Tone
  children: React.ReactNode
  live?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-kumo-hairline bg-kumo-base px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_TEXT[tone]}`}
    >
      <Dot tone={tone} live={live} />
      {children}
    </span>
  )
}

export function RunStatusPill({ status }: { status: RunStatus }) {
  const tone = RUN_TONE[status]
  return (
    <Pill tone={tone} live={tone === 'live'}>
      {RUN_LABEL[status]}
    </Pill>
  )
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <Pill tone={SEVERITY_TONE[severity]}>
      {severity[0].toUpperCase() + severity.slice(1)}
    </Pill>
  )
}

export function JourneyStatusPill({ status }: { status: JourneyStatus }) {
  const tone = JOURNEY_TONE[status]
  const label = status[0].toUpperCase() + status.slice(1)
  return (
    <Pill tone={tone} live={tone === 'live'}>
      {label}
    </Pill>
  )
}

export function ClassificationPill({
  classification,
}: {
  classification: Classification
}) {
  const tone: Tone =
    classification === 'confirmed_bug'
      ? 'fail'
      : classification === 'flaky'
        ? 'warn'
        : 'idle'
  return <Pill tone={tone}>{CLASSIFICATION_LABEL[classification]}</Pill>
}

/**
 * Why a run exists.
 *
 * A manual run needs no explanation, so it gets no tag. The others do: a
 * reader scanning a project's history has to be able to tell a nightly monitor
 * from a pull request check from a fix verification without opening any of
 * them.
 */
const TRIGGER_LABEL: Record<Exclude<RunTrigger, 'manual'>, string> = {
  verify_fix: 'Fix check',
  scheduled: 'Scheduled',
  pull_request: 'Pull request',
  cli: 'CLI',
}

export function TriggerTag({
  trigger,
  pullRequestNumber,
}: {
  trigger: RunTrigger
  pullRequestNumber?: number | null
}) {
  if (trigger === 'manual') return null

  const label =
    trigger === 'pull_request' && pullRequestNumber
      ? `PR #${pullRequestNumber}`
      : TRIGGER_LABEL[trigger]

  return (
    <span className="rounded border border-kumo-hairline px-1.5 py-0.5 text-[11px] whitespace-nowrap text-kumo-subtle">
      {label}
    </span>
  )
}

export { RUN_LABEL }
