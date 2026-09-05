# @forge/video

The Forge product trailer. Three cuts, one set of scenes, all of it code.

```
pnpm --filter @forge/video studio        # scrub and edit, live
pnpm --filter @forge/video render:all    # 60s, 30s and 15s masters into out/
```

| Composition | Length | Output | For |
|-------------|--------|--------|-----|
| `ForgeTrailer` | 60s | `out/forge-trailer-60.mp4` | the submission |
| `ForgeSocial30` | 30s | `out/forge-social-30.mp4` | a feed |
| `ForgeHook15` | 15s | `out/forge-hook-15.mp4` | a hook |

All three are 1920×1080, 30fps, H.264 CRF 17, AAC 48kHz stereo.

## The one idea

**The UI is rebuilt as React, not screen-recorded.**

Every Forge surface in the film — the run page, the journey list, the console
rows, the phase rail, the evidence list, the finding's stats band — is a
component in `src/components/`, built against the tokens in
`apps/web/src/styles.css`. That costs more than pointing a recorder at the app,
and buys three things a recording cannot:

- the camera can push into a region at full resolution, with no resampling
- a single row can be isolated while the rest of the page stays legible
- the film renders identically every time, so frame-level review means something

The run it shows is not invented either. It is the Northbeam fixture from
`apps/web/src/server/demo/app.ts`: its real journeys, its real Explorer
priorities, and its real thrown error — down to
`src/server/invitations/send.ts:22`, the line scene 7 opens.

## Layout

```
docs/storyboard.md      the shot list, timings, design and sound rules
docs/narration.md       VO script, and why the master ships without one

src/theme.ts            Forge's tokens, dark theme, copied not approximated
src/motion/             springs, staggers, wipes, typewriter, camera
src/data/demoRun.ts     the deterministic run, from the real fixture
src/components/         the product's UI vocabulary, rebuilt
src/scenes/             ten scenes, numbered in cut order
src/compositions/       the three edits
scripts/build-audio.mjs the sound design, synthesised
scripts/contact-sheet.mjs  visual QA
```

## Two coordinate systems

Worth knowing before editing a scene, because it is the one thing here that is
not obvious from the code:

- **`Stage`** is frame coordinates. 1920×1080. Title cards live here.
- **`Console`** is *product* coordinates. It renders a 1320×742.5 viewport and
  scales it to fill the frame, so every size inside a Console scene is the
  number from the real stylesheet — a 14px journey name stays `fontSize: 14`.
  The film is the product at ~145% browser zoom.

The practical rule that falls out of this: **camera scale in a Console scene must
stay at or below about 1.11.** The product's 1180px column already occupies 1716
of the frame's 1920 pixels, so anything beyond that starts slicing console rows
off both edges. Console scenes get their movement from scrolling the page and
from isolating a card, not from magnification.

## Sound

`scripts/build-audio.mjs` synthesises all three tracks from oscillators and
filtered noise — no samples, no library. Cue frames match the edit, so:

```
pnpm --filter @forge/video sfx    # after changing any scene length
```

`render` runs it first, so a normal render is never stale.

## Visual QA

```
pnpm --filter @forge/video contact-sheet
```

Renders thirty frames chosen to sit on each shot's beat and tiles them. The
frame list is stable across runs, so two sheets from two revisions compare
position by position. Everything that went wrong in this film's first pass —
a serif fallback on the run title, the top bar clipped by a camera push, the
page scrolling over that bar, a white flash at the sandbox handoff — was found
this way and not by scrubbing.

## Changing the edit

Scene lengths live next to their scenes (`export const HOOK_FRAMES = 150`) and
are summed in `compositions/Trailer.tsx`. The two short cuts assert that their
clips fill their composition and throw if they do not — a cut that overruns its
`durationInFrames` silently drops its last scenes, which is not visible in a
still, a contact sheet, or anything short of watching the whole export.
