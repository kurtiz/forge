/**
 * Scene 7 — Investigation. 210 frames.
 *
 * The part no screen-recorded demo can sell, because it happens in a sandbox
 * with no UI: Forge clones the repository, searches it with the strings its own
 * evidence produced, and puts a line number next to the failure.
 *
 * So the shot is built in two layers. The browser folds back in z and a
 * terminal slides over it - a literal handoff from "driving the app" to
 * "reading the source". Then the terminal itself gives way to the file, and one
 * line lifts out of it.
 *
 * The queries the terminal runs are the ones `investigation/analysis.ts` would
 * actually extract: quoted spans from the error, with stopwords dropped.
 */
import { useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Stage } from './shell'
import { Kicker } from '../components/type'
import { BrowserWindow, TerminalWindow } from '../components/chrome'
import { NorthbeamError } from '../components/northbeam'
import { CodePanel } from '../components/code'
import { ERROR_TEXT, ERROR_FRAME, FINDING, SOURCE_LINES } from '../data/demoRun'
import { ramp, springAt, FORGE_EASE, CAMERA_EASE } from '../motion'
import { beats } from '../motion/grid'

export const INVESTIGATION_FRAMES = beats(8)

const TERMINAL_LINES = [
  { prompt: true, text: 'solari sandbox create --repo northbeam/app' },
  { text: 'sandbox ready · node 22 · pnpm 11', tone: 'idle' as const },
  { prompt: true, text: 'rg -n \'mailer transport\' src/' },
  { text: 'src/server/invitations/send.ts:22', tone: 'accent' as const },
]

export function Investigation() {
  const frame = useCurrentFrame()

  /* Browser recedes; terminal takes the frame. */
  const handoff = ramp(frame, [0, 34], [0, 1], CAMERA_EASE)
  /* Terminal reveals its lines, then itself gives way to the source. */
  /* Starts as the terminal does, not after it: a window that slides in empty
     and then fills reads as two events, and the shot only has room for one. */
  const termLines = Math.floor(ramp(frame, [8, 62], [0, TERMINAL_LINES.length + 0.5]))
  /* The sandbox gives way to the file on beat 3; the line lights on beat 5 and
     is fully lit, with its stack frame beneath it, on beat 6. */
  const toSource = ramp(frame, [beats(3), beats(4)], [0, 1], CAMERA_EASE)

  const reveal = ramp(frame, [beats(3) + 11, beats(4) + 19], [0, 1], FORGE_EASE)
  const focus = ramp(frame, [beats(5), beats(6)], [0, 1], FORGE_EASE)
  const cause = springAt(frame, beats(6), 'arrive')
  const out = ramp(frame, [INVESTIGATION_FRAMES - 12, INVESTIGATION_FRAMES], [1, 0])

  return (
    <Stage
      grid={0.3}
      bloom={ramp(frame, [beats(3), beats(5)], [0.2, 0.55])}
      style={{ opacity: out, alignItems: 'center', padding: '0 110px' }}
    >
      <Kicker
        progress={ramp(frame, [4, 20], [0, 1]) * (1 - toSource * 0.4)}
        style={{ position: 'absolute', top: 118 }}
      >
        Investigating source · Solari sandbox
      </Kicker>

      {/*
        * Layer 1: the application, on its way out.
        *
        * It is the same 500 page scene 2 cut to, not a blank white rectangle -
        * an empty light panel here read as a flash frame, and carrying the real
        * page through also makes the handoff legible: this is the failure we
        * just watched, and now we are going to go and find out why.
        *
        * It darkens faster than it shrinks, so the bright area is gone within
        * about ten frames while the geometry keeps moving.
        */}
      <BrowserWindow
        url="northbeam.example/invite"
        status={500}
        style={{
          position: 'absolute',
          width: 1200,
          height: 520,
          opacity: 1 - handoff * 0.9,
          transform: `scale(${1 - handoff * 0.22}) translateY(${handoff * -46}px)`,
          filter: handoff > 0.2 ? `blur(${handoff * 7}px)` : undefined,
        }}
      >
        <NorthbeamError dim={ramp(frame, [0, 26], [0.35, 0.88], CAMERA_EASE)} />
      </BrowserWindow>

      {/* Layer 2: the sandbox. */}
      <TerminalWindow
        title="solari-sandbox · northbeam/app"
        lines={TERMINAL_LINES.slice(0, termLines)}
        style={{
          position: 'absolute',
          width: 1180,
          opacity: handoff * (1 - toSource),
          transform: `translateY(${(1 - handoff) * 40 + toSource * -60}px) scale(${1 - toSource * 0.1})`,
          filter: toSource > 0.2 ? `blur(${toSource * 6}px)` : undefined,
        }}
      />

      {/* Layer 3: the file, and the line the stack trace named. */}
      <div
        style={{
          position: 'absolute',
          width: 1440,
          opacity: toSource,
          transform: `translateY(${(1 - toSource) * 46}px)`,
        }}
      >
        <CodePanel
          file={FINDING.affectedFile}
          lines={SOURCE_LINES}
          highlight={FINDING.affectedLine}
          focus={focus}
          reveal={reveal}
          annotation={'undefined for "external"'}
        />

        {/* The stack frame that sent us here, restated under the file. */}
        <div
          style={{
            marginTop: 26,
            opacity: cause,
            transform: `translateY(${(1 - cause) * 12}px)`,
            fontFamily: font.mono,
            fontSize: 15,
            lineHeight: 1.7,
            color: color.fail,
          }}
        >
          {ERROR_TEXT}
          <div style={{ color: color.subtle, paddingLeft: 28 }}>{ERROR_FRAME}</div>
        </div>
      </div>
    </Stage>
  )
}
