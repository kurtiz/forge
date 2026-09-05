/**
 * Motion primitives.
 *
 * Everything that moves in this film goes through one of these. The point is
 * not brevity - it is that the trailer has a single motion character, so a
 * panel expanding in scene 4 and an evidence card landing in scene 8 share the
 * same physics rather than each carrying a hand-tuned easing curve.
 */
import { interpolate, spring, Easing } from 'remotion'

export const FPS = 30

/** Seconds to frames. Storyboard timings are written in seconds; code is not. */
export const s = (seconds: number) => Math.round(seconds * FPS)

/**
 * Spring presets.
 *
 * `arrive` is the default for anything entering frame: heavily damped, so it
 * settles without the wobble that reads as a template. `settle` is slower and
 * used for large surfaces. `snap` is for small decisive things - a pill, a
 * cursor press. `overshoot` is the only one that visibly bounces, reserved for
 * the mark's tick and the FIX VERIFIED stamp.
 */
export const SPRING = {
  arrive: { damping: 200, mass: 0.7, stiffness: 110 },
  settle: { damping: 200, mass: 1.4, stiffness: 90 },
  snap: { damping: 200, mass: 0.4, stiffness: 190 },
  overshoot: { damping: 12, mass: 0.8, stiffness: 140 },
} as const

type SpringName = keyof typeof SPRING

/** A 0..1 progress value on a spring, delayed by `delay` frames. */
export const springAt = (
  frame: number,
  delay = 0,
  preset: SpringName = 'arrive',
) =>
  spring({
    frame: frame - delay,
    fps: FPS,
    config: SPRING[preset],
    durationInFrames: undefined,
  })

/**
 * Staggered entry.
 *
 * Index `i` of a list starts `step` frames after index 0. Nothing in this film
 * appears as a block: a list that lands all at once reads as a screenshot, and
 * the whole argument for building the UI as code is that it does not have to.
 */
export const stagger = (
  frame: number,
  i: number,
  { delay = 0, step = 4, preset = 'arrive' as SpringName } = {},
) => springAt(frame, delay + i * step, preset)

/**
 * Enter transform. The product's own `.enter` keyframe - 8px up, fading in -
 * expressed as a spring so it can be scrubbed and composed.
 */
export const enter = (progress: number, distance = 14) => ({
  opacity: progress,
  transform: `translateY(${(1 - progress) * distance}px)`,
})

/**
 * Linear ramp with both ends clamped. Camera moves and wipes use this rather
 * than a spring: a spring on a camera push makes the frame feel like it is
 * being thrown, not moved.
 */
export const ramp = (
  frame: number,
  [from, to]: [number, number],
  [a, b]: [number, number],
  easing = Easing.bezier(0.16, 1, 0.3, 1),
) =>
  interpolate(frame, [from, to], [a, b], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  })

/** Ease used by the product's own transitions. */
export const FORGE_EASE = Easing.bezier(0.16, 1, 0.3, 1)
/** For camera moves that should feel driven rather than released. */
export const CAMERA_EASE = Easing.bezier(0.65, 0, 0.35, 1)

/**
 * A masked reveal: text wiped in from below behind a hard edge, rather than
 * faded. Returns the clip-path for a wrapper whose child is the text.
 */
export const wipeUp = (progress: number) => ({
  clipPath: `inset(${(1 - progress) * 105}% 0% 0% 0%)`,
})

/** Left-to-right hard wipe, for rails and underlines. */
export const wipeRight = (progress: number) => ({
  clipPath: `inset(0% ${(1 - progress) * 100}% 0% 0%)`,
})

/**
 * Typewriter.
 *
 * Characters per second rather than a duration, so a long URL and a short
 * command type at the same speed and the film has one typing rhythm. Returns
 * the visible slice plus whether the caret should be drawn.
 */
export const typed = (
  text: string,
  frame: number,
  { delay = 0, cps = 22 } = {},
) => {
  const elapsed = Math.max(0, frame - delay) / FPS
  const count = Math.min(text.length, Math.floor(elapsed * cps))
  return {
    text: text.slice(0, count),
    done: count >= text.length,
    /* Caret blinks at 2 Hz once typing stops, solid while typing. */
    caret:
      frame < delay
        ? false
        : count >= text.length
          ? Math.floor((frame / FPS) * 2) % 2 === 0
          : true,
  }
}

/**
 * A counter that lands on integers and never reflows mid-flight. Paired with
 * `font-variant-numeric: tabular-nums` everywhere it is used.
 */
export const countTo = (
  frame: number,
  target: number,
  { delay = 0, duration = 20 } = {},
) => Math.round(ramp(frame, [delay, delay + duration], [0, target]))

/**
 * Camera. A scale-and-translate applied to a whole scene, so a shot can push
 * into a region of rebuilt UI at full resolution instead of scaling a bitmap.
 * `focus` is the point to move toward, in 0..1 of the frame.
 */
export const camera = (
  scale: number,
  focus: [number, number] = [0.5, 0.5],
) => ({
  transform: `scale(${scale}) translate(${(0.5 - focus[0]) * 100}%, ${(0.5 - focus[1]) * 100}%)`,
  transformOrigin: 'center center',
})
