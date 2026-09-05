/**
 * The 60-second cut.
 *
 * Scenes are laid end to end with no transition components between them. Each
 * scene owns its own exit - a wipe, a push, or a hard cut on its last frame -
 * because a shared transition layer would have made every join look the same,
 * and half the joins in this film are supposed to be cuts.
 */
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion'
import { color } from '../theme'
import { Hook, HOOK_FRAMES } from '../scenes/01-hook'
import { Problem, PROBLEM_FRAMES } from '../scenes/02-problem'
import { Reveal, REVEAL_FRAMES } from '../scenes/03-reveal'
import { Discovery, DISCOVERY_FRAMES } from '../scenes/04-discovery'
import { Execution, EXECUTION_FRAMES } from '../scenes/05-execution'
import { Reproduction, REPRODUCTION_FRAMES } from '../scenes/06-reproduction'
import { Investigation, INVESTIGATION_FRAMES } from '../scenes/07-investigation'
import { Evidence, EVIDENCE_FRAMES } from '../scenes/08-evidence'
import { FixVerified, FIX_FRAMES } from '../scenes/09-fix-verified'
import { Outro, OUTRO_FRAMES } from '../scenes/10-outro'

/** Scene order and length in one place, so the cut can be read at a glance. */
export const SHOTS = [
  { Component: Hook, frames: HOOK_FRAMES },
  { Component: Problem, frames: PROBLEM_FRAMES },
  { Component: Reveal, frames: REVEAL_FRAMES },
  { Component: Discovery, frames: DISCOVERY_FRAMES },
  { Component: Execution, frames: EXECUTION_FRAMES },
  { Component: Reproduction, frames: REPRODUCTION_FRAMES },
  { Component: Investigation, frames: INVESTIGATION_FRAMES },
  { Component: Evidence, frames: EVIDENCE_FRAMES },
  { Component: FixVerified, frames: FIX_FRAMES },
  { Component: Outro, frames: OUTRO_FRAMES },
] as const

export const TRAILER_FRAMES = SHOTS.reduce((n, s) => n + s.frames, 0)

export function ForgeTrailer() {
  let at = 0
  return (
    <AbsoluteFill style={{ background: color.canvas }}>
      {/*
       * Synthesised in `scripts/build-audio.mjs` against the same frame numbers
       * the edit uses, so a shot that moves takes its impact with it. Re-run
       * `pnpm sfx` after changing any scene length.
       */}
      <Audio src={staticFile('forge-trailer.wav')} />
      {SHOTS.map(({ Component, frames }, i) => {
        const from = at
        at += frames
        return (
          <Sequence key={i} from={from} durationInFrames={frames} premountFor={30}>
            <Component />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
