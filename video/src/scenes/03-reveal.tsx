/**
 * Scene 3 — Reveal. 210 frames.
 *
 * The mark draws rather than appears: the F's two strokes first, then the amber
 * tick, which overshoots very slightly and settles. That ordering is the only
 * piece of brand storytelling the film does - the tick is the product, and it
 * arrives last.
 *
 * The wordmark tracks in from wide letter-spacing to its real -0.03em rather
 * than scaling up, because scaling a wordmark past its final size and back is
 * the single most common tell of a templated logo animation.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Stage } from './shell'
import { ForgeMark } from '../components/chrome'
import { Statement } from '../components/type'
import { ramp, springAt, FORGE_EASE } from '../motion'

export const REVEAL_FRAMES = 210

export function Reveal() {
  const frame = useCurrentFrame()

  const draw = ramp(frame, [6, 62], [0, 1], FORGE_EASE)
  const markSettle = springAt(frame, 6, 'settle')

  /* The mark holds centre, then slides left to make room for the wordmark. */
  const split = ramp(frame, [66, 96], [0, 1], FORGE_EASE)

  const word = ramp(frame, [72, 118], [0, 1], FORGE_EASE)
  const line = springAt(frame, 124, 'arrive')
  const rule = ramp(frame, [120, 150], [0, 1])
  const out = ramp(frame, [196, 210], [1, 0])

  const markSize = 150 - split * 44

  return (
    <Stage
      grid={0.45}
      bloom={ramp(frame, [40, 90], [0, 0.7])}
      style={{ opacity: out, alignItems: 'center' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: split * 30,
          transform: `translateY(${-34 * split}px)`,
        }}
      >
        <ForgeMark
          size={markSize}
          draw={draw}
          style={{ transform: `scale(${0.9 + markSettle * 0.1})` }}
        />
        <span
          style={{
            fontFamily: font.sans,
            fontSize: 104,
            fontWeight: 600,
            color: color.strong,
            /* 0.5em down to the product's tight tracking. */
            letterSpacing: `${0.5 - word * 0.53}em`,
            opacity: word,
            /* The trailing letter-space would otherwise push the pair off centre. */
            marginRight: `${-(0.5 - word * 0.53)}em`,
            whiteSpace: 'nowrap',
          }}
        >
          Forge
        </span>
      </div>

      <div
        style={{
          width: 1 * rule * 620,
          height: 1,
          background: color.hairline,
          marginTop: 44,
        }}
      />

      <Statement progress={line} size={44} style={{ marginTop: 40, textAlign: 'center' }}>
        <span style={{ color: color.subtle, fontWeight: 500 }}>AI writes the code. </span>
        <span>Forge proves it works.</span>
      </Statement>
    </Stage>
  )
}
