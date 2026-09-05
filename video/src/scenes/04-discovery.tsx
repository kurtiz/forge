/**
 * Scene 4 — Discovery. 240 frames.
 *
 * A URL goes in, and journeys come out. This is the first time the audience
 * sees the product do work, so the shot is deliberately literal: type the
 * target, press the button, watch the rail move, watch four journeys land in
 * priority order, watch the trace fill underneath them.
 *
 * The journeys are the fixture's real four, with the real priorities the
 * Explorer assigns them - 1.00, 0.95, 0.20, 0.10. A ranked list where the
 * numbers are obviously round is a list nobody believes.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Console, PageHeader, Button } from './shell'
import { Pill, PhaseRail, SectionHeader, JourneyRow } from '../components/ui'
import { Trace } from '../components/trace'
import { Cursor, ClickRing } from '../components/cursor'
import {
  JOURNEYS,
  PHASES,
  RUN_ID,
  TARGET_URL,
  PROJECT_NAME,
  TRACE,
} from '../data/demoRun'
import { ramp, springAt, stagger, typed, camera, FORGE_EASE } from '../motion'

export const DISCOVERY_FRAMES = 240

/** The frame the form hands over to the run. */
const HANDOFF = 54

export function Discovery() {
  const frame = useCurrentFrame()
  return frame < HANDOFF ? <NewRun frame={frame} /> : <RunPage frame={frame - HANDOFF} />
}

/**
 * The form: one field, one button. The product's new-run panel stripped to the
 * two controls the film needs, so nothing competes with the URL being typed.
 * Coordinates below are viewport coordinates - see `shell.tsx`.
 */
function NewRun({ frame }: { frame: number }) {
  const panel = springAt(frame, 2, 'arrive')
  const url = typed(TARGET_URL, frame, { delay: 8, cps: 34 })
  const armed = url.done
  const press = 46
  const target: [number, number] = [318, 372]

  return (
    <Console>
      <div
        style={{
          maxWidth: 620,
          margin: '92px auto 0',
          opacity: panel,
          transform: `translateY(${(1 - panel) * 14}px)`,
        }}
      >
        <div style={{ fontSize: 12, color: color.subtle, marginBottom: 8 }}>
          {PROJECT_NAME}
        </div>
        <h1
          style={{
            margin: '0 0 24px',
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: color.strong,
          }}
        >
          Verify a deployment
        </h1>

        <label
          style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            color: color.subtle,
            marginBottom: 7,
          }}
        >
          Target URL
        </label>
        <div
          style={{
            height: 40,
            borderRadius: 8,
            border: `1px solid ${armed ? color.accent : color.hairline}`,
            background: color.recessed,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            fontFamily: font.mono,
            fontSize: 14,
            color: color.strong,
          }}
        >
          {url.text}
          {url.caret ? (
            <span
              style={{
                display: 'inline-block',
                width: 1.5,
                height: 16,
                background: color.accent,
                marginLeft: 2,
              }}
            />
          ) : null}
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button pressed={frame >= press && frame < press + 6 ? 1 : 0}>
            Start verification
          </Button>
          <span
            style={{
              fontSize: 12,
              color: color.subtle,
              opacity: armed ? 1 : 0.4,
            }}
          >
            Solari browser
          </span>
        </div>
      </div>

      <Cursor
        from={[900, 640]}
        to={target}
        frame={frame}
        start={22}
        duration={22}
        press={press}
      />
      <ClickRing at={target} frame={frame} press={press} />
    </Console>
  )
}

/**
 * The run page.
 *
 * The rail is driven as a float so a phase can be caught mid-fill rather than
 * snapping. It runs Queued through Discovering and stops short of Testing,
 * which scene 5 picks up.
 */
function RunPage({ frame }: { frame: number }) {
  const header = springAt(frame, 2, 'arrive')

  const phase = ramp(frame, [4, 126], [0.35, 3], FORGE_EASE)
  const currentPhase = phase < 1 ? 'Queued' : phase < 2 ? 'Starting' : 'Discovering'

  const sectionIn = ramp(frame, [64, 84], [0, 1])

  /*
   * Camera and page scroll are separate jobs here.
   *
   * The push is kept tiny - 3% - because the product's 1180px column already
   * fills 1716 of the frame's 1920 once the viewport scale is applied, and
   * anything past about 1.11 starts cutting console rows off at both edges.
   * Magnification is not how this shot gets its movement.
   *
   * The scroll is. Once the four journeys have landed there is nothing new to
   * look at, so the page scrolls the way a person would scroll it, and the
   * agent trace - which was always below the fold, exactly as in the product -
   * comes up into frame carrying the run's live commentary.
   */
  const push = ramp(frame, [0, 186], [1, 1.03], FORGE_EASE)
  const scrollY = ramp(frame, [128, 186], [0, 196], FORGE_EASE)

  const found = Math.min(
    JOURNEYS.length,
    Math.floor(ramp(frame, [84, 156], [0, JOURNEYS.length + 0.4])),
  )

  return (
    <Console cameraStyle={camera(push, [0.5, 0.5])}>
      <div style={{ transform: `translateY(${-scrollY}px)` }}>
      <PageHeader
        progress={header}
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
              {currentPhase}
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

      <PhaseRail phases={PHASES} current={phase} style={{ marginBottom: 34 }} />

      <div style={{ opacity: sectionIn }}>
        <SectionHeader
          title="Journeys"
          meta={found > 0 ? `${found} discovered` : 'Exploring the application…'}
          progress={sectionIn}
        />
        <div style={{ marginTop: 2 }}>
          {JOURNEYS.map((journey, i) => {
            const p = stagger(frame, i, { delay: 88, step: 12, preset: 'arrive' })
            if (p <= 0) return null
            return (
              <div
                key={journey.name}
                style={{ borderTop: i === 0 ? 'none' : `1px solid ${color.hairline}` }}
              >
                <JourneyRow
                  name={journey.name}
                  goal={journey.goal}
                  priority={journey.priority}
                  status="pending"
                  progress={p}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Below the fold until the page scrolls, as it is in the product. */}
      <div style={{ marginTop: 22, opacity: ramp(frame, [96, 116], [0, 1]) }}>
        <SectionHeader
          title="Agent trace"
          meta={
            <span style={{ color: color.live, display: 'inline-flex', gap: 6 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: color.live,
                  alignSelf: 'center',
                  opacity: 0.4 + 0.6 * Math.abs(Math.sin(frame / 11)),
                }}
              />
              Live
            </span>
          }
        />
        <Trace
          events={TRACE}
          visible={ramp(frame, [104, 196], [0, 5])}
          style={{ marginTop: 8 }}
        />
      </div>
      </div>
    </Console>
  )
}
