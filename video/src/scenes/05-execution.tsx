/**
 * Scene 5 — Execution. 210 frames.
 *
 * The Operator drives the journeys and one of them breaks. The shot has to do
 * two things that pull against each other: show a list working, and then make a
 * single row in that list the only thing in the frame.
 *
 * It does it without a cut, and - after a first pass that got this wrong -
 * without magnification either. Pushing the camera past about 1.11 starts
 * slicing console rows off both edges of the frame, because the product's
 * 1180px column already occupies 1716 of 1920 once the viewport scale is
 * applied. So the isolation is built from three things that cost no width:
 *
 *   - the page scrolls, bringing the failing card to the centre of frame
 *   - the other three journeys desaturate and drop to a third of their opacity
 *   - the failing card alone scales up 8%, and takes a red edge
 *
 * The FAIL row lands late and off the rhythm the OK rows established. That gap
 * is the beat the whole first half of the film is built toward, so it is held
 * for 40 frames with nothing else moving.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Console, PageHeader } from './shell'
import { Pill, PhaseRail, SectionHeader, JourneyRow, ConsoleBlock } from '../components/ui'
import { JOURNEYS, PHASES, RUN_ID, TARGET_URL, PROJECT_NAME } from '../data/demoRun'
import { ramp, camera, FORGE_EASE, CAMERA_EASE } from '../motion'
import { beats } from '../motion/grid'

export const EXECUTION_FRAMES = beats(8)

/**
 * Frame the failing step lands on. Everything in the scene is timed off it.
 *
 * Beat 6 of eight, which puts it on the film's frame 918 - a half-bar, with the
 * cut to the reproduction two beats later landing squarely on the downbeat that
 * closes the phrase. The failure and the cut away from it are the two loudest
 * edits in the piece and they now bracket a musical phrase instead of sitting
 * across one.
 */
const FAIL_AT = beats(6)

/**
 * How far the page scrolls to centre the failing card, in viewport pixels.
 * Measured against the rendered layout with the first journey's console block
 * expanded, not calculated - the expansion is what moves it.
 */
const SCROLL = 268

export function Execution() {
  const frame = useCurrentFrame()

  /* Discovering → Testing, arriving early so the rail is not the subject. */
  const phase = ramp(frame, [0, 40], [3, 3.6], FORGE_EASE)

  /*
   * Per-journey console reveal. The first three run in sequence; the hero
   * journey's rows are slowed so its last step is legible before it fails.
   */
  const rows = (i: number) => {
    if (i === 0) return ramp(frame, [12, 58], [0, 4])
    if (i === 1) return ramp(frame, [beats(2) + 10, FAIL_AT + 4], [0, 3])
    if (i === 2) return ramp(frame, [96, 112], [0, 1])
    return ramp(frame, [110, 132], [0, 2])
  }

  /* Status resolves as each journey's last row lands. */
  const statusOf = (i: number) => {
    const done = [58, FAIL_AT + 4, 112, 132][i]
    if (frame < done) return 'running' as const
    return JOURNEYS[i].status
  }

  const isolate = ramp(frame, [FAIL_AT - beats(1.5), FAIL_AT + 8], [0, 1], CAMERA_EASE)
  const emphasis = ramp(frame, [FAIL_AT, FAIL_AT + 10], [0, 1])

  /*
   * The page follows the work: it scrolls down as journeys expand, then further
   * as the camera settles on the failure.
   */
  const scrollY =
    ramp(frame, [20, FAIL_AT - beats(1.5)], [0, 96], FORGE_EASE) +
    ramp(frame, [FAIL_AT - beats(1.5), FAIL_AT + 8], [0, SCROLL - 96], CAMERA_EASE)

  /* Held inside the safe range so nothing is cut off at the edges. */
  const camScale = ramp(frame, [0, FAIL_AT + 8], [1.0, 1.07], FORGE_EASE)

  /* A red wash that pulses once on impact and does not stay. */
  const flash =
    ramp(frame, [FAIL_AT, FAIL_AT + 5], [0, 0.5]) -
    ramp(frame, [FAIL_AT + 5, FAIL_AT + 34], [0, 0.5])

  return (
    <>
      <Console cameraStyle={camera(camScale, [0.5, 0.5])}>
        <div style={{ transform: `translateY(${-scrollY}px)` }}>
          <PageHeader
            progress={1 - isolate * 0.9}
            above={PROJECT_NAME}
            title={
              <>
                Run
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 16,
                    fontWeight: 400,
                    color: color.subtle,
                  }}
                >
                  {RUN_ID}
                </span>
                <Pill tone="live" pulse={0.5 + 0.5 * Math.sin(frame / 5)}>
                  Testing
                </Pill>
              </>
            }
            description={
              <>
                <span style={{ fontFamily: font.mono, fontSize: 12 }}>{TARGET_URL}</span>
                <span>·</span>
                <span>Solari browser</span>
              </>
            }
          />

          <div style={{ opacity: 1 - isolate * 0.9 }}>
            <PhaseRail phases={PHASES} current={phase} style={{ marginBottom: 34 }} />
          </div>

          <div style={{ opacity: 1 - isolate * 0.8 }}>
            <SectionHeader title="Journeys" meta={`0 of ${JOURNEYS.length} passed`} />
          </div>

          <div style={{ marginTop: 2 }}>
            {JOURNEYS.map((journey, i) => {
              const hero = i === 1
              return (
                <div
                  key={journey.name}
                  style={{
                    borderTop:
                      i === 0
                        ? 'none'
                        : `1px solid ${color.hairline}`,
                    /*
                     * Only the hero card scales, and only within the width the
                     * frame can hold: 1180 × 1.08 × 1.4545 is 1854 of 1920.
                     */
                    transform: hero ? `scale(${1 + isolate * 0.08})` : undefined,
                    transformOrigin: 'center center',
                    position: 'relative',
                    zIndex: hero ? 2 : 1,
                  }}
                >
                  <JourneyRow
                    name={journey.name}
                    goal={journey.goal}
                    priority={journey.priority}
                    status={statusOf(i)}
                    progress={1}
                    dim={hero ? 0 : isolate}
                    emphasis={hero ? emphasis : 0}
                  >
                    <ConsoleBlock
                      steps={journey.steps}
                      visible={rows(i)}
                      showDetail={hero && frame > FAIL_AT + 6}
                    />
                  </JourneyRow>
                </div>
              )
            })}
          </div>
        </div>
      </Console>

      {/* One pulse of failure colour over the whole frame. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(70% 55% at 50% 55%, oklch(70% 0.19 24 / ${flash}), transparent 72%)`,
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
