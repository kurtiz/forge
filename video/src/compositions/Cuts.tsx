/**
 * The short cuts.
 *
 * Same scenes, same components, different edit. This is the whole reason the
 * film is a program rather than a timeline: the 30 and the 15 are not re-edits
 * of an exported master, they are different sequences over the same source, and
 * a change to the evidence list propagates to all three.
 *
 * The shorts are not simply the 60 with pieces removed. Each drops the setup
 * and opens closer to the product, because a viewer scrolling past on a feed
 * has not agreed to five seconds of black.
 */
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion'
import { color } from '../theme'
import { Hook } from '../scenes/01-hook'
import { Discovery } from '../scenes/04-discovery'
import { Execution } from '../scenes/05-execution'
import { Reproduction } from '../scenes/06-reproduction'
import { Investigation } from '../scenes/07-investigation'
import { Evidence } from '../scenes/08-evidence'
import { FixVerified } from '../scenes/09-fix-verified'
import { Outro } from '../scenes/10-outro'

export const SOCIAL_30_FRAMES = 900

/**
 * 30 seconds, for a feed.
 *
 * Keeps the spine - problem, failure, proof, fix - and buys the room by
 * entering most scenes late rather than by playing them faster. `offset` is how
 * far into its own timeline a scene is when it appears, so Discovery opens on a
 * run already in progress rather than on an empty form: a viewer scrolling past
 * has not agreed to watch a URL be typed.
 *
 * The brand reveal is cut, not shortened. Halved, it became a logo flashing
 * between two arguments, and the outro says the same thing with the film's
 * whole case already made behind it. The two beats that got its frames are the
 * ones a shorter cut is most tempted to rush and least able to afford to: the
 * opening contrast, and 5 / 5.
 *
 * The lengths below sum to exactly SOCIAL_30_FRAMES. They have to - a cut that
 * overruns its composition loses its last scenes off the end, silently, which
 * is what the first version of this file did to the payoff.
 */
export function ForgeSocial30() {
  const cut = [
    { Component: Hook, frames: 132, offset: 0 },
    { Component: Discovery, frames: 114, offset: 88 },
    { Component: Execution, frames: 128, offset: 40 },
    { Component: Reproduction, frames: 124, offset: 0 },
    { Component: Investigation, frames: 92, offset: 62 },
    { Component: Evidence, frames: 112, offset: 28 },
    { Component: FixVerified, frames: 108, offset: 8 },
    { Component: Outro, frames: 90, offset: 0 },
  ]

  return <Cut clips={cut} audio="forge-social-30.wav" total={SOCIAL_30_FRAMES} />
}

export const HOOK_15_FRAMES = 450

/**
 * 15 seconds. The argument with the setup removed: a failure, five failed
 * reproductions, the line of source that caused it, and a verified fix. No
 * title cards until the mark - a viewer who wants the pitch goes and reads it.
 */
export function ForgeHook15() {
  const cut = [
    { Component: Execution, frames: 96, offset: 118 },
    { Component: Reproduction, frames: 96, offset: 20 },
    { Component: Investigation, frames: 96, offset: 96 },
    { Component: FixVerified, frames: 92, offset: 60 },
    { Component: Outro, frames: 70, offset: 0 },
  ]

  return <Cut clips={cut} audio="forge-hook-15.wav" total={HOOK_15_FRAMES} />
}

/**
 * Lays clips end to end, and refuses to render a cut whose clips do not fill
 * its composition.
 *
 * This throws rather than warns on purpose. A cut that is 200 frames longer
 * than its `durationInFrames` renders perfectly happily and just drops its
 * final scenes off the end - which cost this film its payoff once already, and
 * is invisible in a still, in a contact sheet, and in every check short of
 * watching the whole export.
 */
function Cut({
  clips,
  audio,
  total,
}: {
  clips: Array<{ Component: React.ComponentType; frames: number; offset: number }>
  audio: string
  total: number
}) {
  const laid = clips.reduce((n, c) => n + c.frames, 0)
  if (laid !== total) {
    throw new Error(
      `Cut is ${laid} frames but its composition is ${total}. ` +
        `Adjust the clip lengths so they sum to ${total}.`,
    )
  }

  let at = 0
  return (
    <AbsoluteFill style={{ background: color.canvas }}>
      <Audio src={staticFile(audio)} />
      {clips.map(({ Component, frames, offset }, i) => {
        const from = at
        at += frames
        return (
          <Sequence key={i} from={from} durationInFrames={frames} premountFor={20}>
            <OffsetClock by={offset}>
              <Component />
            </OffsetClock>
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

/**
 * Shifts a child's frame clock forward.
 *
 * `Sequence from={-n}` is the idiomatic way to do this in Remotion, and it also
 * shifts when the child mounts. Nesting it inside a positive `Sequence` keeps
 * the mount where the edit wants it and moves only the clock.
 */
function OffsetClock({ by, children }: { by: number; children: React.ReactNode }) {
  if (by === 0) return <AbsoluteFill>{children}</AbsoluteFill>
  return (
    <AbsoluteFill>
      <Sequence from={-by}>{children}</Sequence>
    </AbsoluteFill>
  )
}
