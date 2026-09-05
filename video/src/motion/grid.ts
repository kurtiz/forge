/**
 * The musical grid.
 *
 * The film is cut to a bed that runs at 66.06 BPM. `scripts/build-audio.mjs`
 * time-stretches it by 1.0092 - a 0.9% change, inaudible - so it lands on
 * 66.667 BPM exactly, which at 30fps is:
 *
 *     beat = 27 frames        bar (4/4) = 108 frames
 *
 * Integers, both of them. That is the entire point of the stretch: every
 * downbeat in the film falls on a whole frame, and nothing drifts over sixty
 * seconds the way it would at 27.248 frames per beat.
 *
 * Every scene length in the film is a whole number of beats, so every cut lands
 * on one. The moments that carry the film - the reveal, the failure, 5 / 5, the
 * line of source, the verdict, the fix - are placed on beats too, and the four
 * biggest sit on downbeats.
 *
 * The rule when editing: express timings as `beats(n)`, not as frame counts. A
 * cue written as 96 is a cue that will quietly fall off the grid the next time
 * a scene changes length.
 */

export const BEAT = 27
export const BAR = BEAT * 4

/** Frames for a whole number of beats. */
export const beats = (n: number) => Math.round(n * BEAT)

/** Frames for a whole number of bars. */
export const bars = (n: number) => Math.round(n * BAR)

/**
 * The nearest beat to a frame. Useful when converting an old hand-tuned cue,
 * and harmless in production code - it is a no-op on anything already on grid.
 */
export const onBeat = (frame: number) => Math.round(frame / BEAT) * BEAT
