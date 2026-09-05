/**
 * The film's audio: a music bed, plus a synthesised sound design over it.
 *
 * The sound design is generated here from oscillators and filtered noise - no
 * stock library, no trailer-hit sample pack. That is partly a licence question
 * and mostly a control one: the impacts have to land on named frames, and a
 * purchased hit with 40ms of pre-roll does not.
 *
 * The palette is deliberately narrow, because the film is 60 seconds of
 * technical argument and a score with opinions would be arguing back:
 *
 *   bed        a 41 Hz sine that is felt rather than heard, breathing slowly
 *   impact     a pitch sweep from 90 Hz down to 32, with a filtered noise front
 *   tick       2 ms of highpassed noise - a UI sound, not a percussion sound
 *   fail       two detuned oscillators a semitone apart, so it beats and sours
 *   tension    a filtered ramp that climbs a fifth over the reproduction
 *   texture    bit-crushed noise, for the sandbox
 *   resolve    the only consonant chord in the piece, and the last thing heard
 *
 * The bed is `assets/music/titus-arko-66bpm.mp3`, trimmed to its opening build
 * and time-stretched 0.9% so its beat is exactly 27 frames - see
 * `src/motion/grid.ts` for why that number runs through everything. It is
 * ducked under the impacts rather than mixed flat, so a hit reads as a hit and
 * not as two loud things at once.
 *
 * If the music is not present the build says so and falls back to the sound
 * design alone, with the synthesised bed underneath it. Every cut still renders.
 *
 * Cues are written in frames at 30fps and expressed in beats where they sit on
 * the grid, so a shot that moves in the edit moves here by the same number.
 *
 * Usage: node scripts/build-audio.mjs
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SR = 48000
const FPS = 30
const f2s = (frame) => Math.round((frame / FPS) * SR)

/** The grid, mirrored from `src/motion/grid.ts`. 27 frames to the beat. */
const BEAT = 27
const b = (n) => Math.round(n * BEAT)

const MUSIC = 'assets/music/titus-arko-66bpm.mp3'

/**
 * Tempo, taken from the file's own ID3 `TBPM` rather than from analysis.
 *
 * Autocorrelation on this track only narrows it to a 66.06-66.20 plateau - the
 * onsets are soft, which is exactly why it works as a bed and exactly why it is
 * hard to measure. The tag was written by the DAW that made it, so 66.000 is
 * the composer's number, not an estimate. It matters: at 66.06 the stretched
 * beat would be 27.027 frames and the film would be nearly two frames out by
 * the end. At 66.000 it is 27.000, and nothing drifts.
 */
const MUSIC_BPM = 66.0
const TEMPO = (60 / MUSIC_BPM) / 0.9

/**
 * The point in the track the bed is trimmed from.
 *
 * Not a detected downbeat. Onset detection on this track is genuinely
 * ambiguous - two methods disagreed by 0.6s, and its bass moves in eighths, so
 * half a dozen offsets score within noise of each other. A track with a
 * detectable downbeat would not work as a bed, which is the whole reason this
 * one was chosen.
 *
 * So the offset was found by optimising the two things that can be measured
 * rather than by trusting a phase estimate. Over a full bar of candidates, each
 * one trimmed, stretched and scored properly:
 *
 *   - how strongly the bass onsets coincide with the film's 27-frame grid
 *   - how well the excerpt's energy arc correlates with the film's shape
 *
 *   start   beat-comb   bar-comb   arc
 *   2.220     0.951       0.890    0.619   <- this one
 *   2.284     0.948       0.602    0.656
 *   3.020     0.112       0.089    0.618
 *   5.920     1.000       1.000    0.512
 *
 * 5.920 locks hardest but starts past the track's build, and the film's first
 * eleven seconds need a bed that is barely there. 2.220 gives up almost nothing
 * on the beat, keeps the bar, and keeps the arc.
 */
const FIRST_DOWNBEAT = 2.22

/* ------------------------------------------------------------------ voices */

/** One-pole lowpass. Cheap, and its gentle slope suits everything here. */
function lowpass(buf, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff)
  const a = (1 / SR) / (rc + 1 / SR)
  let last = 0
  for (let i = 0; i < buf.length; i++) {
    last += a * (buf[i] - last)
    buf[i] = last
  }
  return buf
}

/** One-pole highpass, as the complement of the above. */
function highpass(buf, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff)
  const a = rc / (rc + 1 / SR)
  let prevIn = 0
  let prevOut = 0
  for (let i = 0; i < buf.length; i++) {
    const out = a * (prevOut + buf[i] - prevIn)
    prevIn = buf[i]
    prevOut = out
    buf[i] = out
  }
  return buf
}

/** Exponential decay envelope with a short linear attack, in seconds. */
function env(n, attack, decay) {
  const out = new Float64Array(n)
  const a = Math.max(1, Math.floor(attack * SR))
  for (let i = 0; i < n; i++) {
    const rise = i < a ? i / a : 1
    out[i] = rise * Math.exp(-(i / SR) / decay)
  }
  return out
}

/** A deterministic noise source: the film must render identically every time. */
function makeNoise(seed = 12345) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return (state / 0xffffffff) * 2 - 1
  }
}

/**
 * Impact. A sine swept down in pitch under a filtered noise transient - the
 * transient is what makes it audible on a phone, the sweep is what makes it
 * felt on anything better.
 */
function impact({ gain = 1, from = 90, to = 32, decay = 0.85, noise = 0.5, seed = 7 }) {
  const n = Math.floor(decay * 3 * SR)
  const e = env(n, 0.001, decay)
  const rnd = makeNoise(seed)
  const body = new Float64Array(n)
  const front = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const f = from * Math.pow(to / from, Math.pow(t, 0.35))
    phase += (2 * Math.PI * f) / SR
    body[i] = Math.sin(phase) * e[i]
    front[i] = rnd() * Math.exp(-(i / SR) / 0.045)
  }
  lowpass(front, 900)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = (body[i] + front[i] * noise) * gain
  return out
}

/** A UI tick. Two milliseconds of bright noise, and nothing else. */
function tick({ gain = 0.12, bright = 3200, decay = 0.02, seed = 3 }) {
  const n = Math.floor(0.09 * SR)
  const rnd = makeNoise(seed)
  const buf = new Float64Array(n)
  for (let i = 0; i < n; i++) buf[i] = rnd() * Math.exp(-(i / SR) / decay)
  highpass(buf, bright)
  for (let i = 0; i < n; i++) buf[i] *= gain
  return buf
}

/**
 * The failure. Two oscillators a semitone apart beat against each other at
 * about 3.5 Hz, which is the interval doing the work - it is the only sound in
 * the film that is not in tune with itself.
 */
function failHit({ gain = 0.9 }) {
  const decay = 2.1
  const n = Math.floor(decay * 2.4 * SR)
  const e = env(n, 0.004, decay)
  const out = new Float64Array(n)
  let p1 = 0
  let p2 = 0
  let p3 = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    /* Both voices sag over the tail: the hit loses confidence as it decays. */
    const f1 = 58 * (1 - 0.12 * t)
    const f2 = 61.5 * (1 - 0.12 * t)
    p1 += (2 * Math.PI * f1) / SR
    p2 += (2 * Math.PI * f2) / SR
    p3 += (2 * Math.PI * f1 * 2) / SR
    out[i] = (Math.sin(p1) + Math.sin(p2) * 0.9 + Math.sin(p3) * 0.18) * e[i] * gain * 0.42
  }
  return out
}

/** Rising tension: a filtered saw climbing a fifth, kept under everything. */
function tension({ frames, gain = 0.1 }) {
  const n = Math.floor((frames / FPS) * SR)
  const out = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / n
    const f = 110 * Math.pow(1.5, t)
    phase += f / SR
    phase %= 1
    /* Saw, softened - a raw saw at this level is all fizz. */
    const saw = 2 * phase - 1
    out[i] = saw * gain * (0.25 + 0.75 * t)
  }
  lowpass(out, 420)
  /* Fade both ends so the ramp does not click in or out. */
  const fade = Math.floor(0.25 * SR)
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade
    out[n - 1 - i] *= i / fade
  }
  return out
}

/** Sandbox texture: noise quantised hard, so it reads as machinery. */
function texture({ frames, gain = 0.05, seed = 91 }) {
  const n = Math.floor((frames / FPS) * SR)
  const rnd = makeNoise(seed)
  const out = new Float64Array(n)
  let held = 0
  const step = Math.floor(SR / 1400)
  for (let i = 0; i < n; i++) {
    if (i % step === 0) held = Math.round(rnd() * 5) / 5
    out[i] = held
  }
  lowpass(out, 2600)
  highpass(out, 300)
  const fade = Math.floor(0.3 * SR)
  for (let i = 0; i < n; i++) {
    const inFade = Math.min(1, i / fade)
    const outFade = Math.min(1, (n - i) / fade)
    out[i] *= gain * inFade * outFade
  }
  return out
}

/**
 * Resolution. A2, E3, A3, C#4 - the only consonant chord in the piece, and it
 * arrives once, on the fix. Soft attack so it blooms rather than hits.
 */
function resolve({ gain = 0.34 }) {
  const decay = 2.6
  const n = Math.floor(decay * 2.2 * SR)
  const e = env(n, 0.09, decay)
  const partials = [110, 164.81, 220, 277.18, 330]
  const level = [1, 0.6, 0.5, 0.34, 0.2]
  const out = new Float64Array(n)
  partials.forEach((f, k) => {
    let phase = 0
    for (let i = 0; i < n; i++) {
      phase += (2 * Math.PI * f) / SR
      out[i] += Math.sin(phase) * level[k] * e[i]
    }
  })
  for (let i = 0; i < n; i++) out[i] *= gain / 2.6
  return out
}

/**
 * The bed. 41 Hz with a fifth above it, breathing on a 14-second cycle, plus a
 * whisper of pink-ish noise so the silence is not digital silence.
 */
function bed({ frames, gain = 0.2, seed = 55 }) {
  const n = Math.floor((frames / FPS) * SR)
  const out = new Float64Array(n)
  const rnd = makeNoise(seed)
  let p1 = 0
  let p2 = 0
  let air = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const breathe = 0.7 + 0.3 * Math.sin((2 * Math.PI * t) / 14)
    p1 += (2 * Math.PI * 41.2) / SR
    p2 += (2 * Math.PI * 61.8) / SR
    air = air * 0.995 + rnd() * 0.005
    out[i] = (Math.sin(p1) * 0.8 + Math.sin(p2) * 0.22 + air * 0.5) * breathe * gain
  }
  /* Twelve-frame fades at both ends: a bed that starts abruptly is a click. */
  const fade = Math.floor(0.9 * SR)
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade
    out[n - 1 - i] *= i / fade
  }
  return out
}

/* ------------------------------------------------------------------- music */

/**
 * Decodes the bed for one cut: trimmed from a downbeat, stretched onto the
 * grid, faded at both ends, at exactly the cut's length.
 *
 * `atrim` is used rather than an input `-ss` because a seek before the input on
 * a VBR MP3 lands on a frame boundary, not a sample, and a bed that starts four
 * milliseconds late puts every downbeat in the film four milliseconds late too.
 */
function loadMusic({ startSec, frames }) {
  if (!existsSync(MUSIC)) return null

  const seconds = frames / FPS
  const sourceSeconds = seconds * TEMPO
  const filters = [
    `atrim=start=${startSec.toFixed(4)}:duration=${sourceSeconds.toFixed(4)}`,
    'asetpts=N/SR/TB',
    `atempo=${TEMPO.toFixed(6)}`,
    /* In under a beat, out over three: the bed should be gone before the mark. */
    'afade=t=in:st=0:d=0.7',
    `afade=t=out:st=${(seconds - 2.6).toFixed(3)}:d=2.6`,
  ].join(',')

  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', MUSIC, '-af', filters, '-ac', '2', '-ar', String(SR), '-f', 's16le', '-'],
    { maxBuffer: 1 << 30 },
  )

  const total = f2s(frames)
  const left = new Float64Array(total)
  const right = new Float64Array(total)
  const have = Math.min(total, Math.floor(raw.length / 4))
  for (let i = 0; i < have; i++) {
    left[i] = raw.readInt16LE(i * 4) / 32768
    right[i] = raw.readInt16LE(i * 4 + 2) / 32768
  }
  return { left, right }
}

/**
 * Sidechain ducking, by hand.
 *
 * Each impact carves a dip in the bed: 40ms down, held for the length of the
 * hit's front, then eased back over a beat. Without it the failure at frame 918
 * simply adds to whatever the music is doing and reads as clutter; with it the
 * bed steps out of the way and the hit is the only thing in the frame, which is
 * what the picture is doing at that moment too.
 */
function duck(music, dips, total) {
  const gain = new Float64Array(total).fill(1)
  for (const { frame, depth, hold = 0.12, release = 0.9 } of dips) {
    const start = f2s(frame)
    const attack = Math.floor(0.04 * SR)
    const held = Math.floor(hold * SR)
    const rel = Math.floor(release * SR)
    for (let i = 0; i < attack + held + rel; i++) {
      const j = start + i - attack
      if (j < 0 || j >= total) continue
      let g
      if (i < attack) g = 1 - depth * (i / attack)
      else if (i < attack + held) g = 1 - depth
      else {
        const t = (i - attack - held) / rel
        g = 1 - depth * (1 - t) * (1 - t)
      }
      if (g < gain[j]) gain[j] = g
    }
  }
  for (let i = 0; i < total; i++) {
    music.left[i] *= gain[i]
    music.right[i] *= gain[i]
  }
}

/* ------------------------------------------------------------------- mixer */

function mix(total) {
  const left = new Float64Array(total)
  const right = new Float64Array(total)
  /** Impacts register themselves here so the bed can be ducked under them. */
  const dips = []
  return {
    left,
    right,
    dips,
    /** Record a duck without making a sound - used where the picture hits. */
    dip(frame, depth, opts = {}) {
      dips.push({ frame, depth, ...opts })
    },
    /** `pan` runs -1..1; most of the film is centred, ticks spread a little. */
    at(frame, buf, pan = 0) {
      const start = f2s(frame)
      const l = Math.cos(((pan + 1) * Math.PI) / 4)
      const r = Math.sin(((pan + 1) * Math.PI) / 4)
      for (let i = 0; i < buf.length; i++) {
        const j = start + i
        if (j < 0 || j >= total) continue
        left[j] += buf[i] * l * Math.SQRT2 * 0.707
        right[j] += buf[i] * r * Math.SQRT2 * 0.707
      }
    },
  }
}

/** Soft clip, then normalise to -1.5 dBFS. Nothing here should ever hard clip. */
function master(left, right) {
  let peak = 0
  for (let i = 0; i < left.length; i++) {
    left[i] = Math.tanh(left[i] * 1.1)
    right[i] = Math.tanh(right[i] * 1.1)
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  }
  const target = Math.pow(10, -1.5 / 20)
  const g = peak > 0 ? target / peak : 1
  for (let i = 0; i < left.length; i++) {
    left[i] *= g
    right[i] *= g
  }
}

function writeWav(path, left, right) {
  const n = left.length
  const bytes = n * 4
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + bytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(bytes, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), 44 + i * 4)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), 46 + i * 4)
  }
  writeFileSync(path, buf)
}

/* -------------------------------------------------------------- cue sheets */

/**
 * One cue sheet per cut.
 *
 * Frames match the edit, and anything sitting on the musical grid is written as
 * `b(n)` beats from its scene's start rather than as a raw number - the whole
 * point of cutting to a grid is lost if the audio is hand-numbered.
 *
 * `m.dip()` ducks the bed without making a sound. `m.at()` places one.
 */

/** Scene starts in the 60, from `compositions/Trailer.tsx`. */
const T = {
  hook: 0,
  problem: b(6),
  reveal: b(12),
  discovery: b(20),
  execution: b(28),
  reproduction: b(36),
  investigation: b(42),
  evidence: b(50),
  fix: b(56),
  outro: b(62),
  end: b(66),
}

const CUES = {
  'forge-trailer': {
    frames: T.end,
    music: { startSec: FIRST_DOWNBEAT },
    build(m) {
      /* Hook: the sub lands under "Verifying it did not.", on beat 2. */
      m.at(T.hook + b(2), impact({ gain: 0.5, from: 70, to: 30, decay: 1.2, seed: 11 }))
      m.dip(T.hook + b(2), 0.35)

      /* Problem: three nodes, "Looks good", then the break on the downbeat. */
      for (const [i, f] of [2, 8, 14].entries()) {
        m.at(T.problem + f, tick({ gain: 0.07, bright: 2600, seed: 20 + i }), -0.3 + i * 0.3)
      }
      m.at(T.problem + 26, tick({ gain: 0.09, bright: 4000, seed: 31 }), 0.35)
      m.at(T.problem + b(2), impact({ gain: 0.6, from: 120, to: 34, decay: 0.7, noise: 0.9, seed: 41 }))
      m.dip(T.problem + b(2), 0.5, { hold: 0.2 })

      /* Reveal: the mark on the downbeat, the tick's transient two beats later,
         the wordmark complete on the next downbeat. */
      m.at(T.reveal, impact({ gain: 0.66, from: 88, to: 33, decay: 1.5, seed: 51 }))
      m.dip(T.reveal, 0.45, { hold: 0.25, release: 1.4 })
      m.at(T.reveal + b(2), tick({ gain: 0.15, bright: 5200, decay: 0.035, seed: 61 }))
      m.at(T.reveal + b(4), impact({ gain: 0.3, from: 74, to: 40, decay: 0.8, noise: 0.2, seed: 62 }))
      m.dip(T.reveal + b(4), 0.28)

      /* Discovery: the URL types, the button, one tick per journey found. */
      for (let i = 0; i < 16; i++) {
        m.at(T.discovery + 8 + i * 2, tick({ gain: 0.03, bright: 4200, decay: 0.008, seed: 70 + i }), (i % 3) * 0.2 - 0.2)
      }
      m.at(T.discovery + 46, tick({ gain: 0.13, bright: 2200, decay: 0.03, seed: 99 }))
      for (let i = 0; i < 4; i++) {
        m.at(T.discovery + b(5) + i * 12, tick({ gain: 0.085, bright: 3000, seed: 110 + i }), -0.25 + i * 0.17)
      }

      /* Execution: a tick per console row, then the failure on beat 6. */
      for (let i = 0; i < 9; i++) {
        m.at(T.execution + 12 + i * 11, tick({ gain: 0.055, bright: 3400, seed: 130 + i }), i % 2 ? 0.2 : -0.2)
      }
      m.at(T.execution + b(6), failHit({ gain: 0.95 }))
      /* The deepest duck in the film, and the longest. The bed comes back
         under the held frame rather than under the hit. */
      m.dip(T.execution + b(6), 0.78, { hold: 0.35, release: 1.7 })

      /* Reproduction: tension under five accelerating attempts, 5 / 5 on the
         downbeat at beat 40. */
      m.at(T.reproduction, tension({ frames: b(4), gain: 0.1 }))
      for (const [i, f] of [26, 44, 59, 72, 82].entries()) {
        m.at(T.reproduction + f, impact({ gain: 0.15 + i * 0.045, from: 76, to: 40, decay: 0.3, noise: 0.7, seed: 150 + i }))
        m.dip(T.reproduction + f, 0.18 + i * 0.05, { release: 0.4 })
      }
      m.at(T.reproduction + b(4), impact({ gain: 0.5, from: 66, to: 30, decay: 1.4, seed: 161 }))
      m.dip(T.reproduction + b(4), 0.55, { hold: 0.3, release: 1.5 })

      /* Investigation: the sandbox opens, then the line is found on beat 6. */
      m.at(T.investigation, texture({ frames: b(4), gain: 0.05 }))
      m.at(T.investigation + b(1) + 9, tick({ gain: 0.09, bright: 5000, seed: 170 }), -0.3)
      m.at(T.investigation + b(2) + 12, tick({ gain: 0.09, bright: 5000, seed: 171 }), 0.3)
      m.at(T.investigation + b(6), impact({ gain: 0.34, from: 74, to: 44, decay: 0.6, noise: 0.3, seed: 172 }))
      m.dip(T.investigation + b(6), 0.32)

      /* Evidence: one tap per artifact, then the verdict on beat 4. */
      for (let i = 0; i < 6; i++) {
        m.at(T.evidence + 20 + i * 8, tick({ gain: 0.085, bright: 3600, seed: 180 + i }), i % 2 ? 0.3 : -0.3)
      }
      m.at(T.evidence + b(4), impact({ gain: 0.45, from: 82, to: 34, decay: 1.1, seed: 191 }))
      m.dip(T.evidence + b(4), 0.42, { hold: 0.2, release: 1.2 })

      /* Fix: the click on beat 1, the re-checks, the resolution on the
         downbeat at beat 60 - the one consonant chord in the piece. */
      m.at(T.fix + b(1), tick({ gain: 0.15, bright: 2000, decay: 0.026, seed: 200 }))
      for (const [i, f] of [46, 58, 68, 76, 82].entries()) {
        m.at(T.fix + f, tick({ gain: 0.065 + i * 0.012, bright: 3800, seed: 210 + i }), -0.3 + i * 0.15)
      }
      m.at(T.fix + b(4), resolve({ gain: 0.42 }))
      m.dip(T.fix + b(4), 0.35, { hold: 0.4, release: 2.0 })

      /* Outro. */
      m.at(T.outro + 16, tick({ gain: 0.11, bright: 5200, decay: 0.04, seed: 230 }))
    },
  },

  /*
   * The 30. Clip starts and offsets from `compositions/Cuts.tsx`; a cue for a
   * scene entered at offset O sits at clipStart + (sceneLocal - O).
   */
  'forge-social-30': {
    frames: b(33),
    music: { startSec: FIRST_DOWNBEAT },
    build(m) {
      const c = { hook: 0, discovery: b(3), execution: b(8), reproduction: b(13),
                  investigation: b(18), evidence: b(21), fix: b(25), outro: b(30) }

      m.at(c.hook + b(2), impact({ gain: 0.5, from: 70, to: 30, decay: 1.2, seed: 11 }))
      m.dip(c.hook + b(2), 0.35)

      /* Discovery entered at beat 3, so the journeys land from beat 5. */
      for (let i = 0; i < 4; i++) {
        m.at(c.discovery + b(2) + i * 12, tick({ gain: 0.085, bright: 3000, seed: 110 + i }), -0.25 + i * 0.17)
      }

      /* Execution entered at beat 3: its failure is this cut's beat 11. */
      for (let i = 0; i < 5; i++) {
        m.at(c.execution + i * 11, tick({ gain: 0.055, bright: 3400, seed: 130 + i }), i % 2 ? 0.2 : -0.2)
      }
      m.at(c.execution + b(3), failHit({ gain: 0.95 }))
      m.dip(c.execution + b(3), 0.78, { hold: 0.35, release: 1.7 })

      m.at(c.reproduction, tension({ frames: b(4), gain: 0.1 }))
      for (const [i, f] of [26, 44, 59, 72, 82].entries()) {
        m.at(c.reproduction + f, impact({ gain: 0.15 + i * 0.045, from: 76, to: 40, decay: 0.3, noise: 0.7, seed: 150 + i }))
        m.dip(c.reproduction + f, 0.18 + i * 0.05, { release: 0.4 })
      }
      m.at(c.reproduction + b(4), impact({ gain: 0.5, from: 66, to: 30, decay: 1.4, seed: 161 }))
      m.dip(c.reproduction + b(4), 0.55, { hold: 0.3, release: 1.5 })

      m.at(c.investigation, texture({ frames: b(3), gain: 0.05 }))
      m.at(c.investigation + b(3), impact({ gain: 0.34, from: 74, to: 44, decay: 0.6, noise: 0.3, seed: 172 }))
      m.dip(c.investigation + b(3), 0.32)

      for (let i = 0; i < 4; i++) {
        m.at(c.evidence + i * 8, tick({ gain: 0.085, bright: 3600, seed: 180 + i }), i % 2 ? 0.3 : -0.3)
      }
      m.at(c.evidence + b(2), impact({ gain: 0.45, from: 82, to: 34, decay: 1.1, seed: 191 }))
      m.dip(c.evidence + b(2), 0.42, { hold: 0.2, release: 1.2 })

      /* Fix is entered at 0 here, so its own frame numbers apply. */
      m.at(c.fix + b(1), tick({ gain: 0.15, bright: 2000, decay: 0.026, seed: 200 }))
      for (const [i, f] of [46, 58, 68, 76, 82].entries()) {
        m.at(c.fix + f, tick({ gain: 0.065 + i * 0.012, bright: 3800, seed: 210 + i }), -0.3 + i * 0.15)
      }
      m.at(c.fix + b(4), resolve({ gain: 0.42 }))
      m.dip(c.fix + b(4), 0.35, { hold: 0.4, release: 2.0 })

      m.at(c.outro + 16, tick({ gain: 0.11, bright: 5200, decay: 0.04, seed: 230 }))
    },
  },

  /*
   * The 15. Opens on the failure itself, so the bed is taken from a downbeat
   * further into the track where it already has weight rather than from the
   * quiet build the other two cuts use.
   */
  'forge-hook-15': {
    frames: b(16),
    music: { startSec: FIRST_DOWNBEAT + 3 * (240 / MUSIC_BPM) },
    build(m) {
      const c = { execution: 0, reproduction: b(4), investigation: b(8), fix: b(11), outro: b(14) }

      for (let i = 0; i < 4; i++) {
        m.at(c.execution + i * 9, tick({ gain: 0.055, bright: 3400, seed: 130 + i }), i % 2 ? 0.2 : -0.2)
      }
      m.at(c.execution + b(2), failHit({ gain: 0.95 }))
      m.dip(c.execution + b(2), 0.78, { hold: 0.35, release: 1.7 })

      m.at(c.reproduction, tension({ frames: b(3), gain: 0.11 }))
      for (const [i, f] of [-1, 17, 32, 45, 55].entries()) {
        m.at(c.reproduction + f, impact({ gain: 0.16 + i * 0.045, from: 76, to: 40, decay: 0.3, noise: 0.7, seed: 150 + i }))
        m.dip(c.reproduction + f, 0.18 + i * 0.05, { release: 0.4 })
      }
      m.at(c.reproduction + b(3), impact({ gain: 0.5, from: 66, to: 30, decay: 1.4, seed: 161 }))
      m.dip(c.reproduction + b(3), 0.55, { hold: 0.3, release: 1.5 })

      m.at(c.investigation, texture({ frames: b(3), gain: 0.055 }))
      m.at(c.investigation + b(3), impact({ gain: 0.36, from: 74, to: 44, decay: 0.6, noise: 0.3, seed: 172 }))
      m.dip(c.investigation + b(3), 0.32)

      for (const [i, f] of [0, 12, 22, 30, 36].entries()) {
        m.at(c.fix + f, tick({ gain: 0.07 + i * 0.012, bright: 3800, seed: 210 + i }), -0.3 + i * 0.15)
      }
      m.at(c.fix + b(2), resolve({ gain: 0.44 }))
      m.dip(c.fix + b(2), 0.35, { hold: 0.4, release: 2.0 })

      m.at(c.outro + 16, tick({ gain: 0.11, bright: 5200, decay: 0.04, seed: 230 }))
    },
  },
}

/* --------------------------------------------------------------------- run */

mkdirSync('public', { recursive: true })

const haveMusic = existsSync(MUSIC)
if (!haveMusic) {
  console.warn(
    `\n  ! ${MUSIC} not found - building the sound design alone.\n` +
      `    See assets/music/README.md.\n`,
  )
}

for (const [name, cue] of Object.entries(CUES)) {
  const total = f2s(cue.frames)
  const m = mix(total)
  cue.build(m)

  const music = haveMusic ? loadMusic({ ...cue.music, frames: cue.frames }) : null

  if (music) {
    duck(music, m.dips, total)
    /*
     * The bed sits well under the sound design. It is carrying tempo and
     * weight, not melody - if it is loud enough to follow as music it is loud
     * enough to compete with the type.
     */
    const level = 0.62
    for (let i = 0; i < total; i++) {
      m.left[i] += music.left[i] * level
      m.right[i] += music.right[i] * level
    }
  } else {
    /* Fallback: the synthesised bed, as before the music existed. */
    const synth = bed({ frames: cue.frames, gain: 0.2 })
    m.at(0, synth)
  }

  master(m.left, m.right)
  const out = join('public', `${name}.wav`)
  writeWav(out, m.left, m.right)
  console.log(
    `${out}  ${(cue.frames / FPS).toFixed(1)}s  ${cue.frames} frames  ` +
      `${music ? 'music + sfx' : 'sfx only'}  ${m.dips.length} ducks`,
  )
}
