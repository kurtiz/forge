/**
 * Source view.
 *
 * Scene 7's job is to make one line of code the most important thing on screen
 * without turning the shot into a terminal dump. So the panel does three things
 * at once: the named line lifts toward the camera and picks up the accent, the
 * lines around it lose contrast and gain a little blur, and a stack-frame
 * annotation slides in beside it.
 *
 * Highlighting is by hand rather than by a tokeniser. The excerpt is thirteen
 * fixed lines from `data/demoRun.ts`, and a syntax-highlighting dependency for
 * thirteen lines would be a dependency to keep current for no picture.
 */
import type { CSSProperties } from 'react'
import { color, font } from '../theme'
import { ramp } from '../motion'

const KEYWORD = /\b(const|export|async|function|return|await|new|type|interface)\b/g
const STRING = /("[^"]*"|'[^']*')/g
const TYPE = /\b(Record|string|Transport|Invite|Promise)\b/g

/** Splits a line into coloured spans. Order matters: strings win over keywords. */
function paint(line: string, dim: number) {
  const parts: Array<{ text: string; c: string }> = []
  let rest = line
  let guard = 0

  const push = (text: string, c: string) => {
    if (text) parts.push({ text, c })
  }

  while (rest.length > 0 && guard++ < 200) {
    const m = rest.match(/("[^"]*"|'[^']*')/)
    if (!m || m.index === undefined) break
    push(rest.slice(0, m.index), color.strong)
    push(m[0], color.pass)
    rest = rest.slice(m.index + m[0].length)
  }
  push(rest, color.strong)

  /* Second pass over the non-string spans for keywords and types. */
  const out: Array<{ text: string; c: string }> = []
  for (const part of parts) {
    if (part.c !== color.strong) {
      out.push(part)
      continue
    }
    let cursor = 0
    const text = part.text
    const marks: Array<[number, number, string]> = []
    for (const re of [KEYWORD, TYPE]) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        marks.push([
          m.index,
          m.index + m[0].length,
          re === KEYWORD ? color.accent : color.live,
        ])
      }
    }
    marks.sort((a, b) => a[0] - b[0])
    for (const [start, end, c] of marks) {
      if (start < cursor) continue
      out.push({ text: text.slice(cursor, start), c: color.strong })
      out.push({ text: text.slice(start, end), c })
      cursor = end
    }
    out.push({ text: text.slice(cursor), c: color.strong })
  }

  return out.map((p) => ({
    ...p,
    c: dim > 0 ? color.inactive : p.c,
  }))
}

export function CodePanel({
  file,
  lines,
  /** Absolute line number to highlight. */
  highlight,
  /** 0..1: how far the highlight treatment has come up. */
  focus,
  /** 0..1: reveals lines top to bottom. */
  reveal,
  annotation,
  style,
}: {
  file: string
  lines: Array<{ n: number; code: string }>
  highlight: number
  focus: number
  reveal: number
  annotation?: string
  style?: CSSProperties
}) {
  const shown = Math.ceil(reveal * lines.length)

  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${color.hairline}`,
        background: color.console,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 22px',
          borderBottom: `1px solid ${color.consoleLine}`,
          fontFamily: font.mono,
          fontSize: 16,
          color: color.subtle,
        }}
      >
        {file}
        <span style={{ marginLeft: 'auto', color: color.inactive }}>
          Solari sandbox
        </span>
      </div>

      <div style={{ padding: '16px 0' }}>
        {lines.map((line, i) => {
          const isTarget = line.n === highlight
          const visible = i < shown ? 1 : 0
          /* Distance from the target line drives how far a line recedes. */
          const distance = Math.abs(
            lines.findIndex((l) => l.n === highlight) - i,
          )
          const recede = isTarget ? 0 : Math.min(1, distance / 5) * focus

          return (
            <div
              key={line.n}
              style={{
                display: 'flex',
                gap: 26,
                padding: '4px 22px',
                opacity: visible * (1 - recede * 0.68),
                filter: recede > 0.2 ? `blur(${recede * 1.6}px)` : undefined,
                transform: isTarget
                  ? `scale(${1 + focus * 0.045})`
                  : `scale(${1 - recede * 0.02})`,
                transformOrigin: 'left center',
                background: isTarget
                  ? `oklch(80% 0.15 78 / ${focus * 0.11})`
                  : undefined,
                borderLeft: `3px solid ${isTarget ? `oklch(80% 0.15 78 / ${focus})` : 'transparent'}`,
                position: 'relative',
                zIndex: isTarget ? 2 : 1,
              }}
            >
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 18,
                  color: isTarget ? color.accent : color.inactive,
                  width: 32,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {line.n}
              </span>
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 19,
                  lineHeight: 1.7,
                  whiteSpace: 'pre',
                }}
              >
                {paint(line.code, recede > 0.35 ? 1 : 0).map((p, j) => (
                  <span key={j} style={{ color: p.c }}>
                    {p.text}
                  </span>
                ))}
              </span>

              {isTarget && annotation ? (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontFamily: font.mono,
                    fontSize: 17,
                    color: color.fail,
                    whiteSpace: 'nowrap',
                    opacity: ramp(focus * 100, [55, 100], [0, 1]),
                    transform: `translateX(${(1 - focus) * 18}px)`,
                  }}
                >
                  {annotation}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
