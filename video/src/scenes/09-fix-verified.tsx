/**
 * Scene 9 — Fix verified. 150 frames.
 *
 * The close of the loop, and the thing that makes Forge a verification product
 * rather than a testing one: it kept the reproduction, so it can re-run exactly
 * the failure against a fixed build and say whether the fix worked.
 *
 * Structurally the shot rhymes with scene 5 on purpose. Same card, same console
 * block, same last row - and that row flips from FAIL to OK in place rather
 * than being replaced. The rail sweeping green underneath is the only new
 * element, and it is the product's own rail running its own phases.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Console, PageHeader, Button } from './shell'
import { Pill, PhaseRail, JourneyRow, ConsoleBlock } from '../components/ui'
import { Cursor, ClickRing } from '../components/cursor'
import { FINDING, HERO_JOURNEY, PHASES, PROJECT_NAME, RUN_ID } from '../data/demoRun'
import { ramp, springAt, camera, FORGE_EASE } from '../motion'

export const FIX_FRAMES = 150

/** The click. Everything after it is a consequence of it. */
const PRESS = 26

/** When each re-run resolves. Same five attempts as scene 6, counted back. */
const RECHECK_AT = [46, 56, 64, 71, 77]

/** The same three steps, with the submit succeeding. */
const FIXED_STEPS = [
  HERO_JOURNEY.steps[0],
  HERO_JOURNEY.steps[1],
  {
    status: 'ok' as const,
    action: 'Submit',
    target: 'Send invite',
    actual: 'Invite sent (200)',
  },
]

export function FixVerified() {
  const frame = useCurrentFrame()

  const rerun = ramp(frame, [PRESS + 6, 92], [0, 6], FORGE_EASE)
  const rows = ramp(frame, [PRESS + 14, 82], [0, 3])
  const passed = frame >= 82

  const stamp = springAt(frame, 94, 'overshoot')
  const glow = ramp(frame, [92, 114], [0, 1])
  const scale = ramp(frame, [0, 140], [1.02, 1.09], FORGE_EASE)
  const out = ramp(frame, [140, 150], [1, 0])

  /*
   * Viewport coordinates, measured off the rendered layout: the button sits at
   * the right edge of the 1180px column, a little under the breadcrumb.
   */
  const target: [number, number] = [1208, 130]

  return (
    <Console cameraStyle={{ ...camera(scale, [0.5, 0.46]), opacity: out }}>
      <PageHeader
        above={`${PROJECT_NAME} / ${RUN_ID}`}
        title={
          <span style={{ fontSize: 22, lineHeight: 1.25, maxWidth: 700 }}>
            {FINDING.title}
          </span>
        }
        actions={
          <Button pressed={frame >= PRESS && frame < PRESS + 6 ? 1 : 0}>
            Verify fix
          </Button>
        }
        description={
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Pill tone={passed ? 'pass' : 'live'} pulse={passed ? 1 : 0.5 + 0.5 * Math.sin(frame / 5)}>
              {passed ? 'Fix verified' : 'Re-running reproduction'}
            </Pill>
            <span style={{ fontFamily: font.mono, fontSize: 12 }}>
              {FINDING.affectedFile}
            </span>
          </span>
        }
      />

      <PhaseRail phases={PHASES} current={rerun} style={{ marginBottom: 28 }} />

      <div
        style={{
          borderRadius: 10,
          border: `1px solid ${
            passed ? `oklch(76% 0.16 158 / ${0.3 + glow * 0.45})` : color.hairline
          }`,
          background: passed ? `oklch(76% 0.16 158 / ${glow * 0.05})` : 'transparent',
          padding: '2px 16px 14px',
        }}
      >
        <JourneyRow
          name={HERO_JOURNEY.name}
          goal={HERO_JOURNEY.goal}
          priority={HERO_JOURNEY.priority}
          status={passed ? 'passed' : 'running'}
          progress={1}
        >
          <ConsoleBlock steps={FIXED_STEPS} visible={rows} />
        </JourneyRow>
      </div>

      {/*
        * The reproduction, re-run.
        *
        * The same five attempts scene 6 counted in red, counted back in green.
        * They are here because the space under the card was dead for forty
        * frames without them, and because "the failure no longer reproduces" is
        * a claim the film should show rather than assert.
        */}
      <div style={{ marginTop: 22, opacity: ramp(frame, [PRESS + 18, PRESS + 30], [0, 1]) }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <span style={{ fontFamily: font.sans, fontSize: 14, fontWeight: 600, color: color.strong }}>
            Reproduction check
          </span>
          <span
            style={{
              fontFamily: font.sans,
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              color: color.subtle,
            }}
          >
            {RECHECK_AT.filter((f) => frame >= f).length} of {RECHECK_AT.length} passed
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {RECHECK_AT.map((at, i) => {
            const fill = ramp(frame, [at - 10, at], [0, 1], FORGE_EASE)
            const ok = frame >= at
            return (
              <div key={i} style={{ flex: 1 }}>
                <div
                  style={{
                    height: 4,
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
                      background: ok ? color.pass : color.live,
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: 7,
                    fontFamily: font.mono,
                    fontSize: 11.5,
                    color: ok ? color.pass : color.inactive,
                  }}
                >
                  {ok ? ' OK ' : `run ${i + 1}`}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* The payoff. The only element in the film that scales past its size. */}
      <div
        style={{
          marginTop: 26,
          textAlign: 'center',
          opacity: Math.min(1, stamp * 1.4),
          transform: `scale(${0.88 + stamp * 0.12})`,
        }}
      >
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: '-0.03em',
            color: color.pass,
          }}
        >
          Fix verified
        </div>
        <div
          style={{
            marginTop: 8,
            fontFamily: font.sans,
            fontSize: 14,
            color: color.subtle,
            opacity: ramp(frame, [106, 122], [0, 1]),
          }}
        >
          The original failure no longer reproduces. Regression check kept.
        </div>
      </div>

      <Cursor
        from={[820, 470]}
        to={target}
        frame={frame}
        start={4}
        duration={20}
        press={PRESS}
        opacity={ramp(frame, [PRESS + 10, PRESS + 22], [1, 0])}
      />
      <ClickRing at={target} frame={frame} press={PRESS} />
    </Console>
  )
}
