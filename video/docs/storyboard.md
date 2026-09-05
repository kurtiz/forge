# Forge — 60-second product trailer

**Line:** AI writes the code. Forge proves it works.

**Format:** 1920×1080, 30 fps, 1800 frames. Dark theme only — Forge's console is
where the product lives, and a light cut would fight every screenshot.

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

| # | Scene | Frames | Time | Content | Motion |
|---|-------|--------|------|---------|--------|
| 1 | Hook | 0–150 | 0:00–0:05 | "Generating software got cheap." / "Verifying it did not." | Blueprint grid breathes up from black. Line 1 masked-reveal from below. Beat. Line 1 recedes in z, line 2 lands hard. |
| 2 | Problem | 150–330 | 0:05–0:11 | CODE → DEPLOY → SHIP, then the Northbeam 500 page | Pipeline nodes snap in on a stagger, connector lines draw. "Looks good." ticks green. Hard cut to the real 500. Red bleeds once, does not linger. |
| 3 | Reveal | 330–540 | 0:11–0:18 | Forge mark draws, wordmark, the line | The F strokes draw first, the amber tick draws last and overshoots. Wordmark tracks in from wide letter-spacing. |
| 4 | Discovery | 540–780 | 0:18–0:26 | Target URL typed, phase rail Queued→Discovering, 4 journeys land, trace fills | URL types at 34 chars/s, cursor arcs to the button and presses. Rail segments fill left to right. Journey rows stagger at 12-frame intervals, each with its real priority. The page then scrolls, as a person would scroll it, and the agent trace comes up from below the fold. |
| 5 | Execution | 780–990 | 0:26–0:33 | Rail → Testing. Console rows run. Invite teammate fails. | The page scrolls the failing card to centre; the other three desaturate to a third opacity in place; the card alone scales 8% and takes a red edge. Console rows type in sequence, OK green. The FAIL row arrives late, off the beat established by the OK rows, and is held 40 frames with nothing else moving. |
| 6 | Reproduction | 990–1170 | 0:33–0:39 | 5 attempts, 5 failures | Attempt chips fill one at a time, accelerating. Counter counts 1/5…5/5 in tabular numerals. Ends on "Reproduced 5 / 5" — the only still moment so far. |
| 7 | Investigation | 1170–1380 | 0:39–0:46 | Browser → Solari sandbox → source | Browser window folds back in z and a terminal slides over it. `git clone`, `rg "mailer transport"`, then the file opens. Line 22 lifts toward camera and glows; lines 15–28 around it dim and blur. |
| 8 | Evidence | 1380–1560 | 0:46–0:52 | Six artifacts assemble, then the verdict | Evidence rows fly in from six directions and settle into the real Forge list. Stats bar wipes in. "Confirmed bug" and 0.94 land together on the downbeat. |
| 9 | Fix verified | 1560–1710 | 0:52–0:57 | Verify fix → rerun → pass | Cursor moves to the real Kumo primary button, presses (0.96 scale, as in the product). Rail sweeps green. The FAIL row from scene 5 flips to OK in place. |
| 10 | Outro | 1710–1800 | 0:57–1:00 | Mark, line, credit | Everything collapses to the mark. Tick redraws. "Powered by Solari × Cloudflare" at 40% opacity. |

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

## Sound design

Synthesised, no library, no stock trailer hits:

| Frame | Cue |
|-------|-----|
| 0 | Room tone enters, 40 Hz bed |
| 96 | Low sub impact under "Verifying it did not." |
| 330 | Reveal impact + amber tick's high transient |
| 545+ | Key-click texture under the URL typing |
| 600–770 | Soft tick per journey discovered |
| 955 | Failure hit — detuned, lower than any impact so far |
| 990–1160 | Rising tension bed under reproduction, pitch climbing per attempt |
| 1170 | Digital texture as the sandbox opens |
| 1380–1550 | Six short taps, one per evidence artifact |
| 1560 | Button click (the real UI sound register: short, dry) |
| 1690 | Resolution — the only consonant chord in the piece |
| 1710 | Bed decays to silence under the mark |

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

## Assets required

- Forge mark (SVG path data, lifted verbatim from `components/app/shell.tsx`)
- Geist + Geist Mono (already a dependency of `apps/web`)
- Northbeam fixture copy and error strings (from `server/demo/app.ts`)
- No screenshots. Every UI state is rebuilt as a component so it can be
  animated, cropped and zoomed without resampling.
