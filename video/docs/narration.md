# Narration script

**The cut ships without voiceover.** This script exists so a VO version can be
made without re-timing anything, and because writing the narration is how the
edit was checked for whether it still makes its argument with the sound off.

## Why there is no voice on the master

Three reasons, in order of weight:

1. **The type would have to shrink.** Narration and on-screen statements compete;
   carrying both means dropping the statements to captions. The statements are
   the film's spine.
2. **The reference frame is wrong.** Launch films from Linear, Vercel and Stripe
   run without voice. A voice in this register reads as a conference talk, and
   a submission that sounds like a conference talk is competing in the wrong
   category.
3. **It survives autoplay.** Most first views of the 30 and the 15 will be muted
   in a feed. A cut that needs its voice is a cut that fails silently.

The sound design carries the emotional beats instead — see the cue table in
[`storyboard.md`](./storyboard.md).

---

## Script, if a VO cut is wanted

Timings are the 60-second master's. Total is ~95 words, which at a measured
delivery leaves silence around each line rather than filling the film.

| In | Out | Line |
|----|-----|------|
| 0:01 | 0:05 | Generating software got cheap. Verifying it did not. |
| 0:06 | 0:10 | An agent can ship a working-looking application in minutes. Nobody automated the part where you find out whether it works. |
| 0:12 | 0:17 | Forge. AI writes the code. Forge proves it works. |
| 0:19 | 0:25 | Give it a deployed URL. It explores the application in a real browser and finds the journeys that matter. |
| 0:27 | 0:32 | Then it runs them. |
| 0:34 | 0:38 | A failure once is a story. Five times out of five is a fact. |
| 0:40 | 0:45 | So it clones the repository into a sandbox, searches it with the evidence it just gathered, and finds the line. |
| 0:47 | 0:52 | Every finding arrives with the artifacts behind it. No evidence, no high-confidence bug. |
| 0:53 | 0:57 | And because it kept the reproduction, it can prove the fix. |
| 0:58 | 1:00 | Forge. |

### Direction

Flat, technical, unhurried. No rising inflection at the end of lines. The
delivery to avoid is the one that sounds pleased with the product; the tone to
aim at is a colleague telling you what the tool does because you asked.

Do not read "No evidence, no high-confidence bug" as a slogan. It is a rule the
system follows, and it lands harder said plainly.

### If recording

- Leave 0:32–0:34 clear. The failure hit owns it.
- Leave 0:52–0:53 clear. The evidence stack is assembling.
- Nothing over the last two seconds.
