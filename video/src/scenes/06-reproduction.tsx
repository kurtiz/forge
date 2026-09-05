/**
 * Scene 6 — Reproduction. 180 frames.
 *
 * The rule the product is built around is "no evidence, no high-confidence
 * bug", and reproduction is the first half of that rule. A failure seen once is
 * a story; a failure seen five times out of five is a fact, and this shot is
 * about the difference.
 *
 * The five attempts accelerate. Attempt one takes 18 frames, attempt five takes
 * 8, so the sequence reads as gathering certainty rather than as a progress bar
 * running at a constant rate. Then everything stops - this is the first still
 * frame since scene 1, and it is held.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Stage } from './shell'
import { Kicker } from '../components/type'
import { FINDING, HERO_JOURNEY } from '../data/demoRun'
import { ramp, springAt, FORGE_EASE } from '../motion'
import { beats } from '../motion/grid'

export const REPRODUCTION_FRAMES = beats(6)

/** Frame each attempt resolves on. Gaps shorten: 18, 15, 13, 10, 8. */
const ATTEMPT_AT = [26, 44, 59, 72, 82]

export function Reproduction() {
  const frame = useCurrentFrame()

  const panel = springAt(frame, 0, 'arrive')
  const resolved = ATTEMPT_AT.filter((f) => frame >= f).length
  /* 5 / 5 lands on beat 4, and holds for two - the longest still moment in the
     film after the failure itself. */
  const verdict = springAt(frame, beats(4), 'arrive')
  const out = ramp(frame, [REPRODUCTION_FRAMES - 12, REPRODUCTION_FRAMES], [1, 0])

  return (
    <Stage
      grid={0.35}
      bloom={ramp(frame, [0, beats(3)], [0.2, 0.6])}
      bloomHue={color.fail}
      style={{ opacity: out, alignItems: 'center' }}
    >
      <div
        style={{
          width: 1180,
          opacity: panel,
          transform: `translateY(${(1 - panel) * 20}px)`,
        }}
      >
        <Kicker>Reproducing</Kicker>
        <div
          style={{
            marginTop: 18,
            fontFamily: font.sans,
            fontSize: 52,
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: color.strong,
          }}
        >
          {HERO_JOURNEY.name}
        </div>

        {/* Five attempts. Each is its own bar so failure is countable, not a ratio. */}
        <div style={{ display: 'flex', gap: 12, marginTop: 44 }}>
          {ATTEMPT_AT.map((at, i) => {
            /* Fill runs for the 12 frames before the attempt resolves. */
            const fill = ramp(frame, [at - 12, at], [0, 1], FORGE_EASE)
            const done = frame >= at
            return (
              <div key={i} style={{ flex: 1 }}>
                <div
                  style={{
                    height: 10,
                    borderRadius: 999,
                    background: color.consoleLine,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${fill * 100}%`,
                      background: done ? color.fail : color.live,
                      borderRadius: 999,
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: 14,
                    fontFamily: font.mono,
                    fontSize: 18,
                    color: done ? color.fail : color.inactive,
                    opacity: fill > 0 ? 1 : 0.45,
                  }}
                >
                  {done ? 'FAIL' : `run ${i + 1}`}
                </div>
              </div>
            )
          })}
        </div>

        {/* The count. Tabular, so 1/5 and 5/5 occupy the same width. */}
        <div
          style={{
            marginTop: 56,
            display: 'flex',
            alignItems: 'baseline',
            gap: 22,
            opacity: verdict,
            transform: `translateY(${(1 - verdict) * 14}px)`,
          }}
        >
          <span
            style={{
              fontFamily: font.sans,
              fontSize: 116,
              fontWeight: 600,
              letterSpacing: '-0.04em',
              fontVariantNumeric: 'tabular-nums',
              color: color.fail,
              lineHeight: 1,
            }}
          >
            {resolved} / {FINDING.reproductionAttempts}
          </span>
          <span
            style={{
              fontFamily: font.sans,
              fontSize: 28,
              color: color.subtle,
            }}
          >
            reproduced. Every attempt failed.
          </span>
        </div>
      </div>
    </Stage>
  )
}
