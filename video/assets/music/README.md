# Music

The trailer's bed is:

```
titus-arko-66bpm.mp3
```

| | |
|---|---|
| Artist (ID3) | Titus Arko |
| Year (ID3) | 2019 |
| Tempo (ID3) | 66 BPM — measured 66.06, so the tag is honest |
| Length | 279s |
| Source filename | `remake-of-395016.mp3` |

## It is deliberately not committed

`.gitignore` excludes `*.mp3` in this directory. The repository is public, and
pushing a third-party master whose licence has not been established would be
redistributing it. Drop the file in here locally and the render picks it up.

**Before shipping the video anywhere, establish the licence.** The ID3 names an
artist but no licence. If it turns out to be unusable, the two other tracks
considered are in `../../docs/storyboard.md`, and swapping is a one-line change
in `scripts/build-audio.mjs` plus a re-run of the tempo analysis — the edit is
cut to a 27-frame beat, so any track can be fitted to it by time-stretching to
66.667 BPM.

## Without it

`scripts/build-audio.mjs` falls back to the synthesised sound design alone and
says so. Every cut still renders; it just has no bed under it.

## What the build does to it

1. Trims from **2.220s**, in the only passage of its 279 seconds with a real
   build rather than a plateau. That offset is not a detected downbeat — this
   track does not have one that survives measurement, which is exactly why it
   works as a bed. It was chosen by scanning a full bar of candidates and
   scoring each on how well its bass onsets coincide with the film's 27-frame
   grid and how well its energy arc matches the edit. The table is in
   `scripts/build-audio.mjs`.
2. Time-stretches by **1.0101** (`atempo`, pitch preserved) so 66.000 BPM — the
   figure in the file's own `TBPM` tag, written by the DAW that made it —
   becomes 66.667: a beat of exactly 27 frames at 30fps, and a bar of exactly
   108. That is a 1% change, inaudible, and it means zero drift across the film.
   Analysis alone could only narrow the tempo to a 66.06–66.20 plateau, which
   would have put the ending nearly two frames out.
3. Ducks it under the sound design's impacts, and fades it at both ends.
