# Forge — 60-second product trailer

**Line:** AI writes the code. Forge proves it works.

**Format:** 1920×1080, 30 fps, 1782 frames (59.4s). Dark theme only — Forge's
console is where the product lives, and a light cut would fight every screenshot.

**Cut to a grid.** The film runs on a 27-frame beat and a 108-frame bar, which
is the music bed's tempo after a 1% stretch. Every scene length is a whole
number of beats, so every cut lands on one; five of the ten land on downbeats.
See [The bed](#the-bed) and `src/motion/grid.ts`.

**Rule the whole edit follows:** every frame on screen is either real Forge UI
rebuilt as React, or type. No stock, no gradient mush, no fake product. The run
in the video is the Northbeam fixture that ships in `apps/web/src/server/demo/app.ts`,
with its actual seeded defects and its actual error strings.

---

## Why this story and not the architecture

The Cloudflare stack is the *how*. A trailer that opens on Workers, D1, R2 and
Durable Objects sells an infrastructure diagram. The story below sells the
product, and the stack gets four words at the end where it belongs.

---

## Shot list

| # | Scene | Frames | Beats | Time | Content | Motion |
|---|-------|--------|-------|------|---------|--------|
| 1 | Hook | 0–162 | 6 | 0:00–5.4 | "Generating software got cheap." / "Verifying it did not." | Blueprint grid breathes up from black. Line 1 masked-reveal from below. Line 2 lands on beat 2, under the film's first sub impact; line 1 recedes in z rather than cutting, so both are on screen at the moment the contrast lands. |
| 2 | Problem | 162–324 | 6 | 5.4–10.8 | Prompt → Code → Deploy → "Looks good", then the Northbeam 500 | Nodes snap in on a stagger, connectors draw. "Looks good" ticks green with 26 frames to be read. The 500 cuts in hard on beat 2 — the hardest edit in the film, and the one that would be most obviously wrong a few frames off the beat. |
| 3 | Reveal | 324–540 | 8 | 10.8–18 | Forge mark draws, wordmark, the line | On a downbeat. The F's strokes draw first, the amber tick last and finishing on beat 2. Wordmark tracks in from wide letter-spacing, complete on beat 4. |
| 4 | Discovery | 540–756 | 8 | 18–25.2 | Target URL typed, rail Queued→Discovering, 4 journeys, trace | On a downbeat. URL types at 34 chars/s, cursor arcs to the button and presses; the form hands over to the run on beat 2. Journeys stagger from beat 5, one per 12 frames. The page then scrolls and the agent trace comes up from below the fold. |
| 5 | Execution | 756–972 | 8 | 25.2–32.4 | Rail → Testing. Console rows run. Invite teammate fails. | On a downbeat. The page scrolls the failing card to centre; the other three desaturate in place; the card alone scales 8% and takes a red edge. The FAIL lands on beat 6 and is held for two beats with nothing moving, so the failure and the cut away from it bracket a musical phrase instead of sitting across one. |
| 6 | Reproduction | 972–1134 | 6 | 32.4–37.8 | 5 attempts, 5 failures | On a downbeat. Attempt bars fill one at a time, accelerating — 18, 15, 13, 10, 8 frames — so it reads as gathering certainty, not as a progress bar. "5 / 5" lands on beat 4 and holds. |
| 7 | Investigation | 1134–1350 | 8 | 37.8–45 | Browser → Solari sandbox → source | The browser folds back in z, darkening under a scrim, and a terminal that already has content slides over it. The file takes the frame on beat 3; line 22 lifts and glows across beats 5–6 while its neighbours dim and blur. |
| 8 | Evidence | 1350–1512 | 6 | 45–50.4 | Six artifacts assemble, then the verdict | Evidence rows fly in from six directions and settle into the real Forge list. "Confirmed bug" lands on beat 4; both confidence counters settle together on beat 5, so the verdict reads as one event. |
| 9 | Fix verified | 1512–1674 | 6 | 50.4–55.8 | Verify fix → rerun → pass | On a downbeat. Cursor presses the real Kumo button on beat 1. The rail sweeps green, the FAIL row from scene 5 flips to OK in place, and the five reproductions are counted back in green. The stamp lands on beat 4 — frame 1620, a downbeat, and the only place the bed and the sound design's one consonant chord arrive together. |
| 10 | Outro | 1674–1782 | 4 | 55.8–59.4 | Mark, line, credit | Everything collapses to the mark. Tick redraws. "Powered by Solari × Cloudflare" at 40% opacity. |

---

## Visual design rules

Taken from `apps/web/src/styles.css` rather than invented:

- **Type:** Geist Variable, Geist Mono Variable. Nothing else.
- **Accent:** one — amber `oklch(80% 0.15 78)`. It is the tick in the mark, the
  active phase, and nothing decorative.
- **Status colour is semantic, never decorative.** Pass green, fail red, live
  blue, idle grey. If a colour appears, it is encoding run state or severity.
- **Surfaces:** `--forge-console` at `oklch(13% 0.004 260)` on a near-black
  canvas, hairline borders at 7% white.
- **Grid field** only behind title cards, never under data. Same 56px pitch as
  the product's landing hero.
- Numbers are tabular. Counts that animate must not reflow.
- No drop shadows except the one Kumo uses on floating controls. Depth comes
  from scale and blur, not glow.

## Motion rules

- Springs for anything that arrives (`damping 200`, `mass 0.6–1.2`). Linear
  interpolation only for camera and for wipes.
- Every list staggers. Nothing appears as a block.
- One idea per shot. When two things must land together they land on the same
  frame, not 6 frames apart.
- The two moments that get held longer than feels comfortable: the FAIL at
  frame ~960 and FIX VERIFIED at ~1690. Everything else moves.
- No crossfades between scenes. Cuts, wipes, and z-pushes only.

## The bed

Three tracks were considered. The analysis is in the table below; the short
version is that two of them are songs and one of them is a bed, and a trailer
with forty seconds of on-screen argument needs a bed.

| | tempo | length | crest | voice-band flux | spectrum | shape |
|---|-------|--------|-------|-----------------|----------|-------|
| `sunixmuz-chill-together` | 60 / 120 | 118s | 16.1 dB | **0.86** — lead melody | 42/44/14 | flat, then a fade |
| `bentley-club-instrumental` | 98.5 | 60.1s | 11.5 dB | **0.98** — lead melody | 36/24/**40** | on/off club groove |
| **`remake-of-395016`** (Titus Arko) | **66** | 279s | **16.6 dB** | **0.38** — texture | **49**/33/18 | sustained plateau |

Why the third:

- **No lead melody.** Voice-band flux of 0.38 against 0.86 and 0.98. The other
  two have a tune, and a tune competes with the statements for the same
  attention. This one has movement without anything to follow.
- **Headroom.** 16.6 dB crest, and `p10/p50` of 0.63 — it is sustained, not
  gapped. The club track's 11.5 dB and 0.14 leave nowhere for the impacts to
  land; the failure hit would have been the third loud thing in that bar.
- **Weight where the film already lives.** 49% of its energy below 200 Hz,
  against a sound design already built on a 41 Hz bed and sub impacts.
- **Register.** "Club instrumental" at 98.5 BPM with 40% of its energy above
  2 kHz sells a different product. 66 BPM sells infrastructure.

The chill track is also CC-BY, so it would need attribution on screen; the
chosen one's licence is unestablished, which is a real open item — see
`assets/music/README.md`.

### Fitting it

**Tempo comes from the file, not from analysis.** Autocorrelation only narrows
this track to a 66.06–66.20 plateau, because its onsets are soft. Its ID3
`TBPM` says 66, written by the DAW that made it. At 66.06 the stretched beat
would be 27.027 frames and the film would end nearly two frames adrift; at
66.000 it is 27.000 and nothing drifts. `atempo` by 1.0101 — a 1% change, and
inaudible.

**The trim point was optimised, not detected.** This track has no downbeat that
survives measurement — two methods disagreed by 0.6s, and its bass moves in
eighths so half a dozen offsets score within noise of each other. That is not a
defect; a track with a hard downbeat would not work as a bed. So a full bar of
candidates was scanned, each trimmed and stretched for real, and scored on two
things that *can* be measured:

| start | beat-comb | bar-comb | arc r |
|-------|-----------|----------|-------|
| **2.220** | 0.951 | 0.890 | 0.619 |
| 2.284 | 0.948 | 0.602 | **0.656** |
| 3.020 | 0.112 | 0.089 | 0.618 |
| 5.920 | **1.000** | **1.000** | 0.512 |

5.920 locks hardest but starts past the track's build, and the film's first
eleven seconds need a bed that is barely there. 2.220 gives up almost nothing on
the beat, keeps the bar, and keeps the arc.

**What "in sync" means here.** Not a kick landing on a cut — this bed has no
kick. It means the cut rhythm and the music share a period exactly, the film's
energy arc and the track's correlate, and the sound design's impacts (which
*are* sharp, and *are* on the grid by construction) supply the pulse the eye
locks to. The bed carries tempo and weight underneath that.

## Sound design

Synthesised, no library, no stock trailer hits, layered over the bed and ducked
into it. Frames are the 60's.

| Frame | Beat | Cue |
|-------|------|-----|
| 54 | 2 | Low sub impact under "Verifying it did not." |
| 164–188 | — | Pipeline nodes, then "Looks good" |
| 216 | 8 | The break — filtered noise front, hard duck |
| 324 | 12 | Reveal impact on the downbeat |
| 378 | 14 | The amber tick's high transient |
| 548–586 | — | Key-click texture under the URL, then the button |
| 675–711 | — | One soft tick per journey discovered |
| 918 | 34 | **Failure.** Two oscillators a semitone apart, beating at 3.5 Hz — the only sound in the film not in tune with itself. Deepest and longest duck. |
| 972–1054 | — | Rising tension, pitch climbing per attempt |
| 1080 | 40 | Reproduction verdict, on the downbeat |
| 1134+ | — | Bit-crushed texture as the sandbox opens |
| 1296 | 48 | The line of source is found |
| 1370–1410 | — | Six taps, one per evidence artifact |
| 1458 | 54 | The verdict |
| 1539 | 56+1 | Button click — short, dry, a UI register |
| 1620 | 60 | **Resolution.** The one consonant chord, on a downbeat. |
| 1690 | — | Bed decays to silence under the mark |

## Narration

Shipped as a script, not as recorded VO. The cut is built to read silently —
Linear, Vercel and Stripe launch films carry no voice, and a voice over a
45-second technical demo forces the type to shrink. Script lives in
`docs/narration.md` should a VO cut ever be wanted.

## The three cuts

One set of scenes, three sequences over it. The shorts are not the 60 with
pieces removed — each enters most scenes partway through its own timeline, so
the argument survives at a third of the length.

| Cut | Frames | Opens on | Cuts |
|-----|--------|----------|------|
| `ForgeTrailer` | 1800 | black, and the contrast | everything |
| `ForgeSocial30` | 900 | the contrast, then a run already in progress | the URL form, and the mid-film brand reveal |
| `ForgeHook15` | 450 | the failure itself, 32 frames in | every title card until the mark |

The 30 drops the brand reveal rather than halving it: at half length it became a
logo flashing between two arguments, and the outro says the same thing with the
film's case already made behind it. Its frames went to the two beats a shorter
cut is most tempted to rush — the opening contrast, and 5 / 5.

Each short's clip lengths are asserted against its composition duration at
render time. A cut that overruns simply loses its last scenes off the end,
silently; that is not visible in a still or a contact sheet.

## What the QA pass changed

Recorded because the render → inspect → fix loop is the part of this workflow
that actually does the work, and a list of nothing found would mean it was not
run properly.

| Found | Fix |
|-------|-----|
| `Run` rendered in a serif — the page title had no font-family and fell through to the default | `font-family` on the shell roots and on the header itself |
| Every console scene was at product pixel scale: 15px type on a 1080p frame | Console scenes moved into a 1320×742.5 viewport scaled 1.4545 to fill the frame |
| A 1.035 camera push clipped the Forge mark in half at the left edge of the top bar | Top bar contents moved into the product's own 1180px column, as the product does |
| The page scrolled *over* the top bar; the mark sat on top of a journey row | Clip below the bar, at viewport width rather than column width |
| Scene 5's push to 1.58 sliced console rows off both edges | Camera capped near 1.07; isolation rebuilt from scroll + dimming + an 8% card scale |
| The agent trace sat below the fold and was cut off mid-panel | The page scrolls to it, which also gave the shot its second half |
| Scene 7 opened on a blank white browser — a flash frame in a dark film | Carries the real 500 page through from scene 2, darkening under a scrim |
| The 30-second cut was laid out as 1100 frames in a 900-frame composition, silently dropping the fix and the outro | Retimed to 900; both shorts now throw if their clips do not fill the cut |
| Its reproduction beat gave 5 / 5 only 16 frames | Rebalanced by cutting the brand reveal |
| Both cursors pressed empty space rather than their buttons — the scroll clip is `position: relative`, so anything absolutely positioned inside it measures from *below* the top bar, putting every pointer 56px low, and the pointer was also being clipped and scrolled with the page | Pointers moved to their own overlay layer, a direct child of the scaled viewport, so their coordinates are plain viewport coordinates and the camera moves them with the button |
| Cursor coordinates meant the top-left of the sprite, so a click landed down and right of its target | `Cursor` and `ClickRing` now take the pointer's **tip**; pass the centre of the control |
| The 30's fix clip opened on the exact press frame — the pointer appeared from nowhere, already pressed | Clip entered at 0 instead, with a beat taken from the investigation |

## Assets required

- Forge mark (SVG path data, lifted verbatim from `components/app/shell.tsx`)
- Geist + Geist Mono (already a dependency of `apps/web`)
- Northbeam fixture copy and error strings (from `server/demo/app.ts`)
- No screenshots. Every UI state is rebuilt as a component so it can be
  animated, cropped and zoomed without resampling.
