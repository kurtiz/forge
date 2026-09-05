/**
 * Application chrome, rebuilt.
 *
 * The mark, the top bar, and the two windows the film moves between: a browser
 * showing the target application, and a terminal standing in for the Solari
 * sandbox. Each is a component rather than a screenshot so the camera can push
 * into it at full resolution.
 */
import type { CSSProperties, ReactNode } from 'react'
import { color, font, gridField } from '../theme'
import { ramp, wipeRight } from '../motion'

/**
 * The mark: an F, and a tick in the accent.
 *
 * Paths and view box copied verbatim from `apps/web/src/components/app/shell.tsx`,
 * including its unusual `1.4 -0.5 25 25` box - the framing there is deliberate
 * and reproducing the mark with a tidier box would clip the tick's cap.
 *
 * `draw` runs 0..1: the F strokes draw first and the amber tick last, which is
 * the whole reason the mark is worth animating rather than fading in.
 */
export function ForgeMark({
  size = 18,
  draw = 1,
  style,
}: {
  size?: number
  draw?: number
  style?: CSSProperties
}) {
  /* Path lengths, measured once, so dashoffset can be driven in user units. */
  const F_VERT = 29
  const F_BAR = 9
  const TICK = 11

  const seg = (start: number, end: number) =>
    Math.min(1, Math.max(0, (draw - start) / (end - start)))

  return (
    <svg
      width={size}
      height={size}
      viewBox="1.4 -0.5 25 25"
      fill="none"
      style={{ flexShrink: 0, overflow: 'visible', ...style }}
    >
      <path
        d="M4 20V4h13"
        stroke={color.strong}
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeDasharray={F_VERT}
        strokeDashoffset={F_VERT * (1 - seg(0, 0.45))}
      />
      <path
        d="M4 12h9"
        stroke={color.strong}
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeDasharray={F_BAR}
        strokeDashoffset={F_BAR * (1 - seg(0.35, 0.62))}
      />
      <path
        d="m15.5 15.5 2.8 2.8 5-5"
        stroke={color.accent}
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeLinejoin="round"
        strokeDasharray={TICK}
        strokeDashoffset={TICK * (1 - seg(0.6, 1))}
      />
    </svg>
  )
}

/**
 * The product's top bar: 56px, hairline underneath, mark and wordmark left,
 * navigation right. Nothing in the film interacts with it - it is there because
 * a Forge page without it is not a Forge page.
 */
export function TopBar({ right }: { right?: ReactNode }) {
  return (
    <header
      style={{
        height: 56,
        borderBottom: `1px solid ${color.hairline}`,
        background: color.base,
        flexShrink: 0,
      }}
    >
      {/*
       * The bar's contents sit in the product's own 1180px column rather than
       * running edge to edge. That is what the product does, and it is also
       * what keeps the bar intact under a camera push: at 1.05 scale a
       * full-bleed bar loses the mark off the left edge, and the mark is the
       * one thing in this film that must never be half a mark.
       */}
      <div
        style={{
          height: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px',
        }}
      >
      <ForgeMark size={18} />
      <span
        style={{
          fontFamily: font.sans,
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: color.strong,
        }}
      >
        Forge
      </span>
      <nav
        style={{
          marginLeft: 'auto',
          display: 'flex',
          gap: 16,
          fontFamily: font.sans,
          fontSize: 13,
          color: color.subtle,
        }}
      >
        <span>Docs</span>
        <span>Settings</span>
        {right}
      </nav>
      </div>
    </header>
  )
}

/**
 * A browser window around the target application.
 *
 * Chrome is deliberately quiet - three dots, one address field, no tab strip.
 * The tab strip would be four more rectangles competing with the Forge UI for
 * the eye, and the film never has two tabs.
 */
export function BrowserWindow({
  url,
  caret = false,
  children,
  style,
  status,
}: {
  url: string
  caret?: boolean
  children?: ReactNode
  style?: CSSProperties
  status?: number
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${color.hairline}`,
        background: color.base,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <div
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 18px',
          borderBottom: `1px solid ${color.consoleLine}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                background: color.hairline,
              }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            height: 30,
            borderRadius: 6,
            background: color.recessed,
            border: `1px solid ${color.consoleLine}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            fontFamily: font.mono,
            fontSize: 15,
            color: color.subtle,
          }}
        >
          {url}
          {caret ? (
            <span
              style={{
                display: 'inline-block',
                width: 1.5,
                height: 13,
                background: color.accent,
                marginLeft: 1,
              }}
            />
          ) : null}
          {status ? (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 14,
                color: status >= 400 ? color.fail : color.pass,
              }}
            >
              {status}
            </span>
          ) : null}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  )
}

/**
 * The Solari sandbox, as a terminal.
 *
 * `lines` are revealed by `visible`, a float, so the last line can be
 * half-typed. Commands carry a prompt, output does not - the distinction is the
 * only structure a reader gets at this speed.
 */
export function TerminalWindow({
  title,
  lines,
  style,
}: {
  title: string
  lines: Array<{ prompt?: boolean; text: string; tone?: keyof typeof TONE }>
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${color.hairline}`,
        background: color.console,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <div
        style={{
          height: 46,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 14px',
          borderBottom: `1px solid ${color.consoleLine}`,
          fontFamily: font.mono,
          fontSize: 15,
          color: color.subtle,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: color.live,
          }}
        />
        {title}
      </div>
      <div style={{ padding: '20px 24px', display: 'grid', gap: 10 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: font.mono,
              fontSize: 19,
              lineHeight: 1.5,
              color: line.tone ? TONE[line.tone] : line.prompt ? color.strong : color.subtle,
              display: 'flex',
              gap: 8,
            }}
          >
            {line.prompt ? <span style={{ color: color.accent }}>$</span> : null}
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const TONE = {
  pass: color.pass,
  fail: color.fail,
  live: color.live,
  idle: color.idle,
  accent: color.accent,
} as const

/**
 * Blueprint grid backdrop. `sweep` slides the grid slowly so title cards are
 * not dead still, at a rate low enough that nobody consciously sees it move.
 */
export function GridBackdrop({
  opacity = 1,
  frame = 0,
}: {
  opacity?: number
  frame?: number
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: -56,
        ...gridField(opacity),
        backgroundPosition: `${(frame * 0.12) % 56}px ${(frame * 0.06) % 56}px`,
      }}
    />
  )
}

/**
 * Vignette and a single soft accent bloom. The only lighting in the film. It
 * sits above the grid and below the content, so type never picks up a halo.
 */
export function Ambience({
  frame,
  bloom = 0,
  hue = color.accent,
}: {
  frame: number
  bloom?: number
  hue?: string
}) {
  const drift = Math.sin(frame / 90) * 4
  return (
    <>
      {bloom > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(60% 45% at ${50 + drift}% 42%, ${hue.replace(')', ' / 0.10)')}, transparent 70%)`,
            opacity: bloom,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(120% 100% at 50% 45%, transparent 45%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />
    </>
  )
}

/** A hairline that draws itself. Used under section titles and scene headers. */
export function Rule({ progress, color: c = color.hairline }: { progress: number; color?: string }) {
  return (
    <div style={{ height: 1, background: c, ...wipeRight(progress) }} />
  )
}

export { ramp }
