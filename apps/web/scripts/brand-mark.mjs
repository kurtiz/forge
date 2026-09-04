/**
 * Renders the Forge mark to PNG.
 *
 *     node scripts/brand-mark.mjs
 *
 * The mark lives in `src/components/app/shell.tsx` as three stroked polylines.
 * Anywhere outside the browser wants a raster of it - a README, a favicon, a
 * slide, an app listing - and no SVG renderer is installed on a machine that
 * does not already have one, so this file is the renderer: a line rasteriser
 * and a PNG encoder, both small enough to read, and no dependency to install.
 *
 * The geometry below has to match `ForgeMark`. If the mark changes, change it
 * here and re-run; the PNGs are committed, so a drift is a diff.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* ---------------------------------------------------------- the mark */

/** `stroke-width` on every path. */
const STROKE = 2.4
const HALF = STROKE / 2

/** The F: `M4 20V4h13` and `M4 12h9`, flattened to segments. */
const INK = [
  [4, 20, 4, 4],
  [4, 4, 17, 4],
  [4, 12, 13, 12],
]

/** The tick: `m15.5 15.5 2.8 2.8 5-5`. */
const CHECK = [
  [15.5, 15.5, 18.3, 18.3],
  [18.3, 18.3, 23.3, 13.3],
]

/** `viewBox`, as [minX, minY, side]. Square, so the raster is square. */
const VIEW = [1.4, -0.5, 25]

/* ------------------------------------------------------------ colour */

/**
 * oklch to sRGB bytes.
 *
 * The accent is declared in oklch in `styles.css` and there is no browser here
 * to convert it, so the conversion is done rather than a hex approximation
 * pasted in and left to drift.
 */
function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(c * 255)))
  })
}

/** `--forge-accent`, light theme. */
const ACCENT = oklch(0.76, 0.16, 72)

/* -------------------------------------------------------- rasterising */

/**
 * Is this point inside any of these segments' strokes?
 *
 * In a segment's own frame a square-capped stroke is a rectangle running from
 * -HALF to len+HALF, half a stroke either side of the line. Overlapping two of
 * those is also what makes the tick's round join look right: each cap covers
 * the corner the other one leaves.
 */
function inside(segments, px, py) {
  for (const [x1, y1, x2, y2] of segments) {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    const ox = px - x1
    const oy = py - y1
    const along = ox * ux + oy * uy
    const across = -ox * uy + oy * ux
    if (Math.abs(across) <= HALF && along >= -HALF && along <= len + HALF) {
      return true
    }
  }
  return false
}

/** Coverage of one pixel, by 8x8 supersampling. Enough at any size worth using. */
function coverage(segments, x, y, scale) {
  const N = 8
  let hits = 0
  for (let sy = 0; sy < N; sy++) {
    for (let sx = 0; sx < N; sx++) {
      const px = VIEW[0] + (x + (sx + 0.5) / N) / scale
      const py = VIEW[1] + (y + (sy + 0.5) / N) / scale
      if (inside(segments, px, py)) hits++
    }
  }
  return hits / (N * N)
}

/* --------------------------------------------------------------- PNG */

const crc32 = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return (buf) => {
    let c = -1
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  // Bytes 10 to 12 stay zero: deflate, adaptive filtering, no interlace.

  // Filter 0 on every row. The image is flat, so deflate does the work and
  // searching for a better per-row filter would buy almost nothing.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    rgba.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function render(size, ink) {
  const scale = size / VIEW[2]
  const rgba = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = coverage(INK, x, y, scale)
      const tick = coverage(CHECK, x, y, scale)

      // The tick is painted over the F, as it is in the SVG.
      const alpha = f + tick * (1 - f)
      if (alpha === 0) continue

      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round(
          (ink[c] * f * (1 - tick) + ACCENT[c] * tick) / alpha,
        )
      }
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }

  return png(rgba, size)
}

/* -------------------------------------------------------------- write */

/**
 * Two inks rather than one. The mark is `currentColor` in the app, which a PNG
 * cannot be, so the choice a stylesheet makes at render time has to be made
 * here instead: one for light ground, one for dark.
 */
const OUTPUTS = [
  ['forge-mark.png', [23, 23, 26], 1024],
  ['forge-mark-on-dark.png', [250, 250, 250], 1024],
  ['forge-mark-512.png', [23, 23, 26], 512],
]

const out = fileURLToPath(new URL('../public/', import.meta.url))
mkdirSync(out, { recursive: true })

for (const [name, ink, size] of OUTPUTS) {
  writeFileSync(out + name, render(size, ink))
  console.log(`${name}  ${size}x${size}`)
}
