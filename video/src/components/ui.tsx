/**
 * Forge's UI vocabulary, rebuilt for the camera.
 *
 * These mirror `apps/web/src/components/app/` closely enough that a frame
 * grabbed from the film and a screenshot of the product should be hard to tell
 * apart - same pill geometry, same console row, same phase rail, same stat
 * block. What they add is a `progress` input, so every one of them can arrive
 * rather than simply exist.
 */
import type { CSSProperties, ReactNode } from 'react'
import {
  BracketsCurlyIcon,
  FileTextIcon,
  FilmSlateIcon,
  ImageIcon,
  NetworkIcon,
  TerminalWindowIcon,
} from '@phosphor-icons/react'
import { color, font } from '../theme'
import { enter, wipeRight } from '../motion'
import type { Step } from '../data/demoRun'

export type Tone = 'pass' | 'fail' | 'warn' | 'live' | 'idle' | 'accent'

const TONE_COLOR: Record<Tone, string> = {
  pass: color.pass,
  fail: color.fail,
  warn: color.warn,
  live: color.live,
  idle: color.idle,
  accent: color.accent,
}

/**
 * Status pill. Colour never carries meaning alone: every pill has a word next
 * to its dot, which is the product's rule and survives being frozen on a poster.
 */
export function Pill({
  tone,
  children,
  pulse = 0,
  style,
}: {
  tone: Tone
  children: ReactNode
  /** 0..1, drives the live dot's breathing. */
  pulse?: number
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 6,
        border: `1px solid ${color.hairline}`,
        background: color.base,
        padding: '2px 8px',
        fontFamily: font.sans,
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        color: TONE_COLOR[tone],
        ...style,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: TONE_COLOR[tone],
          opacity: pulse > 0 ? 0.4 + 0.6 * pulse : 1,
        }}
      />
      {children}
    </span>
  )
}

/**
 * The phase rail.
 *
 * Six labelled segments; `current` may be fractional so a phase can be caught
 * mid-fill rather than snapping. Done phases go green, the active one blue,
 * everything ahead stays hairline - the product's exact reading.
 */
export function PhaseRail({
  phases,
  current,
  style,
}: {
  phases: readonly string[]
  /** Fractional index. 2.4 means Discovering, 40% filled. */
  current: number
  style?: CSSProperties
}) {
  return (
    <ol
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${phases.length}, 1fr)`,
        gap: 16,
        listStyle: 'none',
        margin: 0,
        padding: 0,
        ...style,
      }}
    >
      {phases.map((phase, i) => {
        const done = current >= i + 1
        const active = current > i && current < i + 1
        const fill = Math.min(1, Math.max(0, current - i))
        return (
          <li key={phase} style={{ minWidth: 0 }}>
            <div
              style={{
                height: 2,
                borderRadius: 999,
                background: color.consoleLine,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${fill * 100}%`,
                  borderRadius: 999,
                  background: done ? color.pass : color.live,
                }}
              />
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: font.sans,
                fontSize: 12,
                fontWeight: active ? 500 : 400,
                color: active ? color.strong : done ? color.subtle : color.inactive,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {phase}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Section header: title left, meta right, hairline under. As in the product. */
export function SectionHeader({
  title,
  meta,
  progress = 1,
}: {
  title: string
  meta?: ReactNode
  progress?: number
}) {
  return (
    <div style={{ opacity: progress }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          paddingBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 14,
            fontWeight: 600,
            color: color.strong,
          }}
        >
          {title}
        </span>
        {meta ? (
          <span
            style={{
              fontFamily: font.sans,
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              color: color.subtle,
            }}
          >
            {meta}
          </span>
        ) : null}
      </div>
      <div style={{ height: 1, background: color.hairline, ...wipeRight(progress) }} />
    </div>
  )
}

/**
 * A journey, as the run page lists it: status pill, name, priority right-aligned,
 * goal underneath. `dim` desaturates the ones the film is not looking at, which
 * is how scene 5 isolates the failure without cutting away from the list.
 */
export function JourneyRow({
  name,
  goal,
  priority,
  status,
  progress,
  dim = 0,
  emphasis = 0,
  children,
}: {
  name: string
  goal: string
  priority: number
  status: 'passed' | 'failed' | 'skipped' | 'running' | 'pending'
  progress: number
  dim?: number
  /** 0..1, adds the red edge the failing card gets. */
  emphasis?: number
  children?: ReactNode
}) {
  const tone: Tone =
    status === 'passed' ? 'pass'
    : status === 'failed' ? 'fail'
    : status === 'running' ? 'live'
    : 'idle'
  const label = status[0].toUpperCase() + status.slice(1)

  return (
    <div
      style={{
        ...enter(progress),
        opacity: progress * (1 - dim * 0.72),
        filter: dim > 0 ? `saturate(${1 - dim * 0.9})` : undefined,
        padding: '15px 14px',
        margin: '0 -14px',
        borderRadius: 10,
        border: `1px solid ${emphasis > 0 ? blend(color.hairline, color.fail, emphasis) : 'transparent'}`,
        background: emphasis > 0 ? `oklch(70% 0.19 24 / ${emphasis * 0.05})` : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Pill tone={tone}>{label}</Pill>
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 14,
            fontWeight: 500,
            color: color.strong,
          }}
        >
          {name}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: font.sans,
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
            color: color.subtle,
          }}
        >
          priority {priority.toFixed(2)}
        </span>
      </div>
      <p
        style={{
          margin: '6px 0 0',
          fontFamily: font.sans,
          fontSize: 14,
          color: color.subtle,
        }}
      >
        {goal}
      </p>
      {children}
    </div>
  )
}

/** Crude but sufficient two-colour mix for an animated border. */
function blend(a: string, b: string, t: number) {
  return t > 0.5 ? b : a
}

/**
 * The console block under a journey: monospace, hairline-separated, no card
 * chrome per row. `visible` is a float so the last row can be mid-type.
 */
export function ConsoleBlock({
  steps,
  visible,
  style,
  showDetail = false,
}: {
  steps: Step[]
  /** How many rows are on screen; fractional reveals the last one. */
  visible: number
  style?: CSSProperties
  /** Expected/actual lines, as the finding page shows them. */
  showDetail?: boolean
}) {
  const shown = steps.slice(0, Math.ceil(visible))

  return (
    <ol
      style={{
        listStyle: 'none',
        margin: '12px 0 0',
        padding: 0,
        borderRadius: 10,
        background: color.console,
        border: `1px solid ${color.consoleLine}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      {shown.map((step, i) => {
        const rowProgress = Math.min(1, Math.max(0, visible - i))
        const c =
          step.status === 'fail' ? color.fail
          : step.status === 'skip' ? color.subtle
          : color.pass
        return (
          <li
            key={i}
            style={{
              display: 'flex',
              gap: 12,
              padding: '8px 12px',
              borderTop: i === 0 ? 'none' : `1px solid ${color.consoleLine}`,
              fontFamily: font.mono,
              fontSize: 11.5,
              lineHeight: 1.5,
              opacity: rowProgress,
              background:
                step.status === 'fail' && rowProgress > 0
                  ? `oklch(70% 0.19 24 / ${0.07 * rowProgress})`
                  : undefined,
            }}
          >
            <span style={{ color: c, flexShrink: 0, fontWeight: 500 }}>
              {step.status === 'fail' ? 'FAIL' : step.status === 'skip' ? 'SKIP' : ' OK '}
            </span>
            <span style={{ minWidth: 0, flex: 1, color: color.subtle }}>
              <span style={{ color: color.strong }}>
                {step.action}
                {step.target ? ` "${step.target}"` : ''}
              </span>
              {!showDetail && step.actual ? `: ${step.actual}` : ''}
              {showDetail && step.expected ? (
                <span style={{ display: 'block', color: color.subtle }}>
                  expected: {step.expected}
                </span>
              ) : null}
              {showDetail && step.actual ? (
                <span style={{ display: 'block', color: color.subtle }}>
                  actual: {step.actual}
                </span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * A stat, as the finding page's four-across band renders one: small label,
 * large tabular value, hint underneath.
 */
export function Stat({
  label,
  value,
  hint,
  progress = 1,
  tone,
}: {
  label: string
  value: ReactNode
  hint: string
  progress?: number
  tone?: Tone
}) {
  return (
    <div style={{ ...enter(progress, 10) }}>
      <div
        style={{
          fontFamily: font.sans,
          fontSize: 12,
          color: color.subtle,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: font.sans,
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: tone ? TONE_COLOR[tone] : color.strong,
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 2,
          fontFamily: font.sans,
          fontSize: 12,
          color: color.subtle,
        }}
      >
        {hint}
      </div>
    </div>
  )
}

const EVIDENCE_ICON = {
  screenshot: ImageIcon,
  recording: FilmSlateIcon,
  console: TerminalWindowIcon,
  network: NetworkIcon,
  page: BracketsCurlyIcon,
  action: FileTextIcon,
  source: FileTextIcon,
} as const

/** One artifact row, icon + label + size, exactly as `EvidenceList` renders it. */
export function EvidenceRow({
  kind,
  label,
  size,
  progress,
  offset = [0, 0],
}: {
  kind: keyof typeof EVIDENCE_ICON
  label: string
  size: string
  progress: number
  /** Where the card flies in from, in px. */
  offset?: [number, number]
}) {
  const Icon = EVIDENCE_ICON[kind]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderTop: `1px solid ${color.hairline}`,
        fontFamily: font.sans,
        fontSize: 14,
        color: color.strong,
        opacity: progress,
        transform: `translate(${offset[0] * (1 - progress)}px, ${offset[1] * (1 - progress)}px)`,
      }}
    >
      <Icon size={15} color={color.subtle} />
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          color: color.subtle,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {size}
      </span>
    </div>
  )
}

export { TONE_COLOR }
