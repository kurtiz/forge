/**
 * Agent trace.
 *
 * The run page's third section, and the reason the lower half of a Forge page
 * is never empty: a live run is always saying what it is doing. In the film it
 * does the same job it does in the product - it fills the space under the
 * journeys with evidence that something is actually running - and it gives the
 * discovery shot a second thing to read once the journey list has landed.
 *
 * Rail, monospace timestamp, message. Tone dots use the product's event
 * colouring, where only failures and completions get a colour at all.
 */
import { color, font } from '../theme'
import { TONE_COLOR, type Tone } from './ui'

export function Trace({
  events,
  visible,
  style,
}: {
  events: readonly { t: string; tone: string; message: string }[]
  /** Fractional count, so the newest line can be arriving. */
  visible: number
  style?: React.CSSProperties
}) {
  const shown = events.slice(0, Math.ceil(visible))
  /* The tail is what a reader watches, so the panel holds the last six. */
  const window = shown.slice(-6)

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${color.hairline}`,
        background: color.recessed,
        padding: '8px 12px 8px 0',
        ...style,
      }}
    >
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {window.map((event, i) => {
          const index = shown.length - window.length + i
          const p = Math.min(1, Math.max(0, visible - index))
          return (
            <li
              key={event.t + event.message}
              style={{
                position: 'relative',
                display: 'flex',
                gap: 12,
                padding: '6px 0 6px 20px',
                opacity: p,
                transform: `translateY(${(1 - p) * 6}px)`,
              }}
            >
              {/* The rail: a hairline through the dots, not beside them. */}
              <span
                style={{
                  position: 'absolute',
                  left: 5.5,
                  top: 14,
                  bottom: -6,
                  width: 1,
                  background: color.consoleLine,
                  display: i === window.length - 1 ? 'none' : 'block',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 3,
                  top: 10,
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: TONE_COLOR[(event.tone as Tone) ?? 'idle'] ?? color.idle,
                }}
              />
              <time
                style={{
                  flexShrink: 0,
                  fontFamily: font.mono,
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                  color: color.subtle,
                }}
              >
                {event.t}
              </time>
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  fontFamily: font.sans,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: color.strong,
                }}
              >
                {event.message}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
