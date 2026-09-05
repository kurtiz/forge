/**
 * Scene 10 — Outro. 90 frames.
 *
 * Collapse to the mark, state the line, credit the stack in four words and get
 * out. The tick redraws rather than being present from frame one, so the last
 * motion in the film is the same motion as the first thing the brand did.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Stage } from './shell'
import { ForgeMark } from '../components/chrome'
import { ramp, springAt, FORGE_EASE } from '../motion'

export const OUTRO_FRAMES = 90

export function Outro() {
  const frame = useCurrentFrame()

  const mark = springAt(frame, 2, 'arrive')
  const draw = ramp(frame, [4, 40], [0, 1], FORGE_EASE)
  const word = springAt(frame, 16, 'arrive')
  const line = ramp(frame, [30, 50], [0, 1])
  const credit = ramp(frame, [50, 68], [0, 1])
  const out = ramp(frame, [80, 90], [1, 0])

  return (
    <Stage grid={0.4} bloom={0.5} style={{ alignItems: 'center', opacity: out }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          opacity: mark,
          transform: `translateY(${(1 - mark) * 12}px)`,
        }}
      >
        <ForgeMark size={78} draw={draw} />
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 76,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            color: color.strong,
            opacity: word,
          }}
        >
          Forge
        </span>
      </div>

      <div
        style={{
          marginTop: 34,
          fontFamily: font.sans,
          fontSize: 27,
          letterSpacing: '-0.01em',
          color: color.subtle,
          opacity: line,
          transform: `translateY(${(1 - line) * 8}px)`,
        }}
      >
        <span>AI writes the code. </span>
        <span style={{ color: color.strong }}>Forge proves it works.</span>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 84,
          fontFamily: font.mono,
          fontSize: 14,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: color.inactive,
          opacity: credit,
        }}
      >
        Powered by Solari × Cloudflare
      </div>
    </Stage>
  )
}
