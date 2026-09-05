/**
 * Sound design, synthesised.
 *
 * No stock library, no trailer-hit sample pack. Every sound in the film is
 * generated here from oscillators and filtered noise, which is partly a licence
 * question and mostly a control one: the impacts have to land on named frames,
 * and a purchased hit with 40ms of pre-roll does not.
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
 * Cues are written in frames at 30fps, matching `docs/storyboard.md`, so a shot
 * that moves in the edit moves here by the same number.
 *
 * Usage: node scripts/build-audio.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SR = 48000
const FPS = 30
const f2s = (frame) => Math.round((frame / FPS) * SR)

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

/* ------------------------------------------------------------------- mixer */

function mix(total) {
  const left = new Float64Array(total)
  const right = new Float64Array(total)
  return {
    left,
    right,
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
 * One cue sheet per cut. Frame numbers match the edit in `compositions/`, and
 * the 60's numbers match the table in `docs/storyboard.md`.
 */
const CUES = {
  'forge-trailer': {
    frames: 1800,
    build(m) {
      m.at(0, bed({ frames: 1800, gain: 0.2 }))

      /* Hook: the sub lands under "Verifying it did not." */
      m.at(62, impact({ gain: 0.55, from: 70, to: 30, decay: 1.2, seed: 11 }))

      /* Problem: three nodes, then the break. */
      for (const [i, f] of [156, 163, 170].entries()) {
        m.at(f, tick({ gain: 0.08, bright: 2600, seed: 20 + i }), -0.3 + i * 0.3)
      }
      m.at(190, tick({ gain: 0.1, bright: 4000, seed: 31 }), 0.35)
      m.at(216, impact({ gain: 0.6, from: 120, to: 34, decay: 0.7, noise: 0.9, seed: 41 }))

      /* Reveal: the mark, then the tick's own transient. */
      m.at(336, impact({ gain: 0.7, from: 88, to: 33, decay: 1.5, seed: 51 }))
      m.at(370, tick({ gain: 0.16, bright: 5200, decay: 0.035, seed: 61 }))

      /* Discovery: typing, the button, and one tick per journey found. */
      for (let i = 0; i < 22; i++) {
        m.at(548 + i * 2, tick({ gain: 0.035, bright: 4200, decay: 0.008, seed: 70 + i }), (i % 3) * 0.2 - 0.2)
      }
      m.at(586, tick({ gain: 0.14, bright: 2200, decay: 0.03, seed: 99 }))
      for (const [i, f] of [628, 640, 652, 664].entries()) {
        m.at(f, tick({ gain: 0.09, bright: 3000, seed: 110 + i }), -0.25 + i * 0.17)
      }

      /* Execution: a tick per console row, then the failure. */
      for (let i = 0; i < 9; i++) {
        m.at(796 + i * 11, tick({ gain: 0.06, bright: 3400, seed: 130 + i }), (i % 2 ? 0.2 : -0.2))
      }
      m.at(930, failHit({ gain: 0.95 }))

      /* Reproduction: tension under five accelerating attempts. */
      m.at(996, tension({ frames: 96, gain: 0.11 }))
      for (const [i, f] of [1016, 1034, 1049, 1062, 1072].entries()) {
        m.at(f, impact({ gain: 0.16 + i * 0.045, from: 76, to: 40, decay: 0.3, noise: 0.7, seed: 150 + i }))
      }
      m.at(1086, impact({ gain: 0.5, from: 66, to: 30, decay: 1.4, seed: 161 }))

      /* Investigation: the sandbox opens, and the line is found. */
      m.at(1178, texture({ frames: 120, gain: 0.055 }))
      m.at(1196, tick({ gain: 0.1, bright: 5000, seed: 170 }), -0.3)
      m.at(1246, tick({ gain: 0.1, bright: 5000, seed: 171 }), 0.3)
      m.at(1298, impact({ gain: 0.34, from: 74, to: 44, decay: 0.6, noise: 0.3, seed: 172 }))

      /* Evidence: one tap per artifact, then the verdict. */
      for (let i = 0; i < 6; i++) {
        m.at(1400 + i * 9, tick({ gain: 0.09, bright: 3600, seed: 180 + i }), i % 2 ? 0.3 : -0.3)
      }
      m.at(1496, impact({ gain: 0.45, from: 82, to: 34, decay: 1.1, seed: 191 }))

      /* Fix: the click, the re-checks, the resolution. */
      m.at(1586, tick({ gain: 0.16, bright: 2000, decay: 0.026, seed: 200 }))
      for (const [i, f] of [1606, 1616, 1624, 1631, 1637].entries()) {
        m.at(f, tick({ gain: 0.07 + i * 0.012, bright: 3800, seed: 210 + i }), -0.3 + i * 0.15)
      }
      m.at(1654, resolve({ gain: 0.4 }))

      /* Outro. */
      m.at(1712, tick({ gain: 0.12, bright: 5200, decay: 0.04, seed: 230 }))
    },
  },

  /*
   * The 30. Scene starts, from `compositions/Cuts.tsx`:
   *   hook 0 · discovery 132 · execution 246 · reproduction 374
   *   investigation 498 · evidence 590 · fix 702 · outro 810
   * A cue for a scene entered at offset O sits at start + (sceneLocal - O).
   */
  'forge-social-30': {
    frames: 900,
    build(m) {
      m.at(0, bed({ frames: 900, gain: 0.2 }))

      /* Hook: the sub under "Verifying it did not." */
      m.at(62, impact({ gain: 0.55, from: 70, to: 30, decay: 1.2, seed: 11 }))

      /* Discovery: four journeys land at 186, 198, 210, 222. */
      for (const [i, f] of [186, 198, 210, 222].entries()) {
        m.at(f, tick({ gain: 0.09, bright: 3000, seed: 110 + i }), -0.25 + i * 0.17)
      }

      /* Execution: console rows, then the failure at scene-local 150. */
      for (let i = 0; i < 7; i++) {
        m.at(252 + i * 10, tick({ gain: 0.06, bright: 3400, seed: 130 + i }), i % 2 ? 0.2 : -0.2)
      }
      m.at(356, failHit({ gain: 0.95 }))

      /* Reproduction: entered at 0, so its own frame numbers apply. */
      m.at(380, tension({ frames: 86, gain: 0.11 }))
      for (const [i, f] of [400, 418, 433, 446, 456].entries()) {
        m.at(f, impact({ gain: 0.16 + i * 0.045, from: 76, to: 40, decay: 0.3, noise: 0.7, seed: 150 + i }))
      }
      m.at(470, impact({ gain: 0.5, from: 66, to: 30, decay: 1.4, seed: 161 }))

      /* Investigation: entered at 62, mid-handoff; the line lands at 564. */
      m.at(498, texture({ frames: 80, gain: 0.055 }))
      m.at(564, impact({ gain: 0.34, from: 74, to: 44, decay: 0.6, noise: 0.3, seed: 172 }))

      /* Evidence: entered at 28, so the artifacts are already arriving. */
      for (let i = 0; i < 5; i++) {
        m.at(592 + i * 8, tick({ gain: 0.09, bright: 3600, seed: 180 + i }), i % 2 ? 0.3 : -0.3)
      }
      m.at(694, impact({ gain: 0.45, from: 82, to: 34, decay: 1.1, seed: 191 }))

      /* Fix: click at 720, re-checks, resolution on the stamp at 788. */
      m.at(720, tick({ gain: 0.16, bright: 2000, decay: 0.026, seed: 200 }))
      for (const [i, f] of [740, 750, 758, 765, 771].entries()) {
        m.at(f, tick({ gain: 0.07 + i * 0.012, bright: 3800, seed: 210 + i }), -0.3 + i * 0.15)
      }
      m.at(788, resolve({ gain: 0.4 }))
      m.at(818, tick({ gain: 0.1, bright: 5200, decay: 0.04, seed: 230 }))
    },
  },

  /*
   * The 15. Scene starts: execution 0 · reproduction 96 · investigation 192
   * · fix 288 · outro 380. Execution is entered at 118, so its failure - scene
   * -local 150 - is the film's opening beat, 32 frames in.
   */
  'forge-hook-15': {
    frames: 450,
    build(m) {
      m.at(0, bed({ frames: 450, gain: 0.22 }))
      for (let i = 0; i < 4; i++) {
        m.at(4 + i * 7, tick({ gain: 0.06, bright: 3400, seed: 130 + i }), i % 2 ? 0.2 : -0.2)
      }
      m.at(32, failHit({ gain: 0.95 }))

      m.at(100, tension({ frames: 66, gain: 0.12 }))
      for (const [i, f] of [102, 120, 135, 148, 158].entries()) {
        m.at(f, impact({ gain: 0.18 + i * 0.045, from: 76, to: 40, decay: 0.3, noise: 0.7, seed: 150 + i }))
      }
      m.at(172, impact({ gain: 0.5, from: 66, to: 30, decay: 1.4, seed: 161 }))

      m.at(192, texture({ frames: 78, gain: 0.06 }))
      m.at(224, impact({ gain: 0.36, from: 74, to: 44, decay: 0.6, noise: 0.3, seed: 172 }))

      /* Entered past the button press, so the re-checks carry the section. */
      for (const [i, f] of [292, 300, 306, 311, 316].entries()) {
        m.at(f, tick({ gain: 0.08 + i * 0.012, bright: 3800, seed: 210 + i }), -0.3 + i * 0.15)
      }
      m.at(322, resolve({ gain: 0.42 }))
      m.at(388, tick({ gain: 0.12, bright: 5200, decay: 0.04, seed: 230 }))
    },
  },
}

/* --------------------------------------------------------------------- run */

mkdirSync('public', { recursive: true })

for (const [name, cue] of Object.entries(CUES)) {
  const total = f2s(cue.frames)
  const m = mix(total)
  cue.build(m)
  master(m.left, m.right)
  const out = join('public', `${name}.wav`)
  writeWav(out, m.left, m.right)
  console.log(`${out}  ${(cue.frames / FPS).toFixed(1)}s  ${(total * 4 / 1e6).toFixed(1)} MB`)
}
