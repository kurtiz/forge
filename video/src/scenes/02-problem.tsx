/**
 * Scene 2 — Problem. 180 frames.
 *
 * The pipeline everyone already has: code, deploy, ship. It assembles quickly
 * and confidently, ticks green, and then the real fixture's 500 page cuts in
 * over the top of it.
 *
 * The 500 is the Northbeam page as the fixture actually serves it - light
 * theme, system font, the real thrown error - because the one moment in the
 * film that has to feel like somebody else's application should not be wearing
 * Forge's design system.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Stage } from './shell'
import { Statement } from '../components/type'
import { BrowserWindow } from '../components/chrome'
import { NorthbeamError } from '../components/northbeam'
import { ramp, springAt, stagger } from '../motion'
import { beats } from '../motion/grid'

export const PROBLEM_FRAMES = beats(6)

const NODES = ['Prompt', 'Code', 'Deploy'] as const

export function Problem() {
  const frame = useCurrentFrame()

  /*
   * The pipeline holds the frame alone for two beats, and the 500 cuts in on
   * the third. The break is the hardest edit in the film and it is the one cue
   * that would be most obviously wrong a few frames off the beat.
   */
  const breakIn = ramp(frame, [beats(2), beats(2) + 12], [0, 1])
  const pipelineOut = ramp(frame, [beats(2), beats(2) + 18], [1, 0])
  const question = springAt(frame, beats(4), 'arrive')
  const out = ramp(frame, [PROBLEM_FRAMES - 12, PROBLEM_FRAMES], [1, 0])

  return (
    <Stage
      grid={0.6}
      bloom={ramp(frame, [beats(2) + 4, beats(3)], [0, 0.55])}
      bloomHue={color.fail}
      style={{ opacity: out, alignItems: 'center' }}
    >
      {/* The happy path. */}
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          opacity: pipelineOut,
          transform: `scale(${1 - breakIn * 0.08})`,
        }}
      >
        {NODES.map((node, i) => {
          const p = stagger(frame, i, { delay: 2, step: 6, preset: 'snap' })
          const link = ramp(frame, [8 + i * 6, 18 + i * 6], [0, 1])
          return (
            <div key={node} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 ? (
                <div
                  style={{
                    width: 74,
                    height: 1,
                    background: color.hairline,
                    transform: `scaleX(${link})`,
                    transformOrigin: 'left center',
                  }}
                />
              ) : null}
              <div
                style={{
                  opacity: p,
                  transform: `translateY(${(1 - p) * 16}px)`,
                  padding: '24px 46px',
                  borderRadius: 12,
                  border: `1px solid ${color.hairline}`,
                  background: color.base,
                  fontFamily: font.sans,
                  fontSize: 32,
                  fontWeight: 500,
                  color: color.strong,
                }}
              >
                {node}
              </div>
            </div>
          )
        })}

        {/* "Looks good." — the assumption the whole product is aimed at. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginLeft: 0,
          }}
        >
          <div
            style={{
              width: 92,
              height: 1,
              background: color.hairline,
              transform: `scaleX(${ramp(frame, [20, 30], [0, 1])})`,
              transformOrigin: 'left center',
            }}
          />
          <div
            style={{
              /* Early enough to be read: the break takes the frame on beat 2,
               and an assumption nobody had time to register is not an
               assumption the next shot can overturn. */
            opacity: springAt(frame, 26, 'snap'),
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '24px 46px',
              borderRadius: 12,
              border: `1px solid ${color.hairline}`,
              background: color.base,
              fontFamily: font.sans,
              fontSize: 32,
              fontWeight: 500,
              color: color.pass,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 999, background: color.pass }} />
            Looks good
          </div>
        </div>
      </div>

      {/* What actually shipped. */}
      <BrowserWindow
        url="northbeam.example/invite"
        status={500}
        style={{
          position: 'absolute',
          width: 1320,
          height: 640,
          opacity: breakIn,
          transform: `scale(${0.94 + breakIn * 0.06})`,
        }}
      >
        <NorthbeamError />
      </BrowserWindow>

      <Statement
        progress={question}
        size={62}
        style={{
          position: 'absolute',
          bottom: 96,
          left: 150,
          right: 150,
          textAlign: 'center',
        }}
      >
        Who checks?
      </Statement>
    </Stage>
  )
}
