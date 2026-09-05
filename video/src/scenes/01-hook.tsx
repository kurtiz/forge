/**
 * Scene 1 — Hook. 150 frames.
 *
 * Two sentences, and the second one is the whole reason the product exists.
 * They are the README's own opening rather than an ad line written for the
 * film: "Generating software got cheap. Verifying it did not."
 *
 * The first line does not fade out when the second arrives. It recedes in z and
 * loses contrast, so the two are on screen together at the moment the contrast
 * lands - which is the point. A crossfade would have separated them.
 */
import { useCurrentFrame } from 'remotion'
import { color } from '../theme'
import { Stage } from './shell'
import { Statement, Kicker } from '../components/type'
import { ramp, springAt } from '../motion'
import { beats } from '../motion/grid'

export const HOOK_FRAMES = beats(6)

export function Hook() {
  const frame = useCurrentFrame()

  const gridIn = ramp(frame, [0, 45], [0, 1])
  const line1 = springAt(frame, 8, 'settle')
  /* The contrast lands on beat 2, which is the first downbeat-adjacent hit the
     bed gives us; the grid is what makes the pause before it feel deliberate. */
  const line2 = springAt(frame, beats(2), 'arrive')

  /* The first line's retreat, timed to start as the second one begins. */
  const recede = ramp(frame, [beats(2) - 4, beats(2) + 20], [0, 1])

  const kicker = ramp(frame, [beats(4), beats(4) + 20], [0, 1])
  const out = ramp(frame, [HOOK_FRAMES - 12, HOOK_FRAMES], [1, 0])

  return (
    <Stage grid={gridIn * 0.85} bloom={ramp(frame, [60, 110], [0, 0.5])} style={{ opacity: out }}>
      <div style={{ maxWidth: 1180 }}>
        <div
          style={{
            transform: `scale(${1 - recede * 0.13}) translateY(${-recede * 8}px)`,
            transformOrigin: 'left bottom',
            opacity: 1 - recede * 0.62,
            filter: recede > 0.4 ? `blur(${(recede - 0.4) * 3}px)` : undefined,
          }}
        >
          <Statement progress={line1} size={82}>
            Generating software got cheap.
          </Statement>
        </div>

        <Statement
          progress={line2}
          size={82}
          tone={color.strong}
          style={{ marginTop: 14 }}
        >
          Verifying it did not.
        </Statement>

        <Kicker progress={kicker} style={{ marginTop: 54 }}>
          Forge
        </Kicker>
      </div>
    </Stage>
  )
}
