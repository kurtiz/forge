/**
 * Scene 8 — Evidence. 180 frames.
 *
 * The payoff of the rule: six artifacts, then a verdict that is allowed to be
 * confident because of them. The artifacts fly in from six directions and
 * settle into the product's real evidence list - the movement is the argument
 * that they were gathered from different places, and the settling is the
 * argument that they now belong to one finding.
 *
 * The stats band underneath is the finding page's, unchanged: reproduction,
 * confidence, root cause, and the executor that produced it.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Console, PageHeader } from './shell'
import { Pill, SectionHeader, EvidenceRow, Stat } from '../components/ui'
import { EVIDENCE, FINDING, PROJECT_NAME, RUN_ID } from '../data/demoRun'
import { ramp, springAt, stagger, camera, FORGE_EASE } from '../motion'
import { beats } from '../motion/grid'

export const EVIDENCE_FRAMES = beats(6)

/** Where each artifact comes from. Six directions, none of them symmetrical. */
const ORIGIN: Array<[number, number]> = [
  [-180, -40],
  [190, -70],
  [-140, 90],
  [210, 60],
  [-200, 20],
  [160, -110],
]

export function Evidence() {
  const frame = useCurrentFrame()

  const header = springAt(frame, 0, 'arrive')
  const listIn = ramp(frame, [12, 26], [0, 1])
  const statsIn = ramp(frame, [beats(3), beats(3) + 12], [0, 1])
  /* "Confirmed bug" and the numbers arrive together, on beat 4. */
  const verdict = springAt(frame, beats(4), 'overshoot')

  /* Pull back slightly as the evidence assembles: the frame gets fuller. */
  const scale = ramp(frame, [0, EVIDENCE_FRAMES - 12], [1.14, 1.02], FORGE_EASE)

  /* Both counters settle on beat 5, so the verdict reads as one event. */
  const confidence = ramp(frame, [beats(3) + 14, beats(5)], [0, FINDING.confidence], FORGE_EASE)
  const rootCause = ramp(frame, [beats(3) + 20, beats(5)], [0, FINDING.rootCauseConfidence], FORGE_EASE)

  return (
    <Console cameraStyle={camera(scale, [0.5, 0.5])}>
      <PageHeader
        progress={header}
        above={`${PROJECT_NAME} / ${RUN_ID}`}
        title={
          <span style={{ fontSize: 24, lineHeight: 1.25, maxWidth: 760 }}>
            {FINDING.title}
          </span>
        }
        description={
          <span style={{ display: 'flex', gap: 10, opacity: verdict > 0 ? 1 : 0.001 }}>
            <Pill tone="fail" style={{ transform: `scale(${0.9 + verdict * 0.1})` }}>
              {FINDING.severity}
            </Pill>
            <Pill tone="fail" style={{ transform: `scale(${0.9 + verdict * 0.1})` }}>
              {FINDING.classification}
            </Pill>
            <span
              style={{
                border: `1px solid ${color.hairline}`,
                borderRadius: 7,
                padding: '3px 10px',
                fontSize: 14,
                color: color.subtle,
              }}
            >
              {FINDING.failureClass}
            </span>
          </span>
        }
      />

      {/* The stats band, exactly as the finding page sets it. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 32,
          padding: '20px 0',
          borderTop: `1px solid ${color.hairline}`,
          borderBottom: `1px solid ${color.hairline}`,
          opacity: statsIn,
        }}
      >
        <Stat
          label="Reproduction"
          value={`${FINDING.reproductionFailures} / ${FINDING.reproductionAttempts}`}
          hint="Every attempt failed"
          tone="fail"
          progress={statsIn}
        />
        <Stat
          label="Confidence"
          value={confidence.toFixed(2)}
          hint="In the finding"
          progress={statsIn}
        />
        <Stat
          label="Root cause"
          value={rootCause.toFixed(2)}
          hint="Proposed"
          progress={statsIn}
        />
        <Stat label="Executor" value="Solari" hint="Real browser" progress={statsIn} />
      </div>

      <div style={{ marginTop: 30, opacity: listIn }}>
        <SectionHeader
          title="Evidence"
          meta={`${EVIDENCE.length} artifacts`}
          progress={listIn}
        />
        <div style={{ marginTop: 4 }}>
          {EVIDENCE.map((item, i) => (
            <EvidenceRow
              key={item.label}
              kind={item.kind}
              label={item.label}
              size={item.size}
              progress={stagger(frame, i, { delay: 20, step: 8, preset: 'arrive' })}
              offset={ORIGIN[i]}
            />
          ))}
        </div>
      </div>

      {/* The rule, stated once, at the moment it has been earned. */}
      <div
        style={{
          marginTop: 24,
          opacity: ramp(frame, [beats(5), beats(5) + 16], [0, 1]),
          fontFamily: font.sans,
          fontSize: 14,
          color: color.subtle,
        }}
      >
        No evidence, no high-confidence bug.
      </div>
    </Console>
  )
}
