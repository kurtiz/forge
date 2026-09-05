/**
 * Visual QA.
 *
 * Renders a fixed set of frames chosen to sit on the moment each shot is *for*
 * - the beat, not the transition either side of it - and tiles them into one
 * sheet. Reviewing a trailer by scrubbing it is how clipped text and early
 * entrances survive to the master; a sheet makes them obvious side by side.
 *
 * The frame list is deliberately stable across runs, so two sheets from two
 * revisions can be compared position by position.
 *
 * Usage: node scripts/contact-sheet.mjs [composition] [label]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const composition = process.argv[2] ?? 'ForgeTrailer'
const label = process.argv[3] ?? 'qa'
const dir = join('out', `frames-${label}`)

/**
 * [frame, what the frame is supposed to show]
 *
 * Frames sit a little after the cue they check, so a spring has settled by the
 * time it is photographed. Scene starts on the 27-frame grid are 0, 162, 324,
 * 540, 756, 972, 1134, 1350, 1512, 1674.
 */
const FRAMES = [
  [40, 'hook line 1'],
  [70, 'hook contrast'],
  [130, 'hook kicker'],
  [200, 'pipeline assembled'],
  [240, 'the 500'],
  [290, 'who checks'],
  [350, 'mark drawing'],
  [400, 'wordmark tracking'],
  [450, 'the line'],
  [570, 'url typed'],
  [610, 'run page opens'],
  [660, 'rail discovering'],
  [730, 'journeys landed'],
  [800, 'operator running'],
  [880, 'hero console'],
  [925, 'FAIL beat'],
  [950, 'isolation held'],
  [1030, 'reproducing'],
  [1085, '5 of 5'],
  [1120, 'reproduction held'],
  [1160, 'sandbox terminal'],
  [1240, 'source revealed'],
  [1300, 'line 22 focus'],
  [1380, 'evidence assembling'],
  [1440, 'stats band'],
  [1490, 'the rule'],
  [1545, 'verify fix press'],
  [1600, 'rerun passing'],
  [1625, 'fix verified'],
  [1720, 'outro mark'],
]

if (existsSync(dir)) rmSync(dir, { recursive: true })
mkdirSync(dir, { recursive: true })

console.log(`Rendering ${FRAMES.length} frames from ${composition}…`)
for (const [frame, note] of FRAMES) {
  const out = join(dir, `f${String(frame).padStart(5, '0')}.png`)
  execFileSync(
    'npx',
    ['remotion', 'still', composition, out, `--frame=${frame}`, '--scale=0.5', '--log=error'],
    { stdio: 'inherit' },
  )
  console.log(`  ${String(frame).padStart(5)}  ${note}`)
}

/* 5 across, labelled with the frame number so a fault can be reported by frame. */
const sheet = join('out', `contact-sheet-${label}.png`)
execFileSync(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-pattern_type', 'glob', '-i', join(dir, '*.png'),
    /* No drawtext: the bundled ffmpeg is built without libfreetype on some
       machines, and the sheet is read in the fixed order of FRAMES anyway. */
    '-filter_complex',
    `scale=520:-1,tile=5x${Math.ceil(FRAMES.length / 5)}:padding=6:color=0x111111`,
    '-frames:v', '1',
    sheet,
  ],
  { stdio: 'inherit' },
)
console.log(`\nContact sheet: ${sheet}`)
