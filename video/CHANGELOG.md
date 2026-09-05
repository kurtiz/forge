## @forge/video@1.1.0

### Cut the film to a music bed, and put the pointers on their buttons

Adds a music bed and re-cuts all three edits onto its beat, then fixes two
cursor bugs the re-cut made obvious.

The bed is `remake-of-395016.mp3` (Titus Arko, 66 BPM), chosen over the two
other candidates by measurement rather than taste. Voice-band flux separates
them: 0.38 against 0.86 and 0.98. The other two have a lead melody, and a tune
competes with forty seconds of on-screen argument for the same attention. This
one also has the headroom the sound design needs - 16.6 dB crest and a p10/p50
of 0.63, against the club track's 11.5 dB and 0.14, where the failure hit would
have been the third loud thing in the bar. The full table is in the storyboard.

Tempo comes from the file's own ID3 TBPM, not from analysis. Autocorrelation
only narrows this track to a 66.06-66.20 plateau because its onsets are soft;
the tag says 66, written by the DAW that made it. At 66.06 the stretched beat
would be 27.027 frames and the film would end nearly two frames adrift. At
66.000 it is 27.000 exactly, so `src/motion/grid.ts` can hand out whole beats
and nothing drifts across the cut.

Every scene length is now a whole number of beats and every cut lands on one;
five land on downbeats, including the reveal, the failure, 5 / 5 and the fix.
The master is 1782 frames rather than 1800 - a whole number of beats rather
than a round number of seconds.

The trim point was optimised, not detected. This track has no downbeat that
survives measurement, which is exactly why it works as a bed, so a full bar of
candidates was scanned - each trimmed and stretched for real - and scored on
grid coincidence and energy-arc match. The scores are in build-audio.mjs. The
bed is ducked under the impacts rather than mixed flat, and the music is
deliberately not committed: the repo is public and the licence is unestablished.
Without it the build falls back to the synthesised design and says so.

The cursor fixes: the scroll clip added earlier is `position: relative`, which
silently made it the containing block for the pointers, so every cursor
coordinate was measured from below the top bar and both clicks landed in empty
space. Pointers now live in their own overlay layer outside the clip, where
coordinates are plain viewport coordinates and the camera moves a pointer and
its button together. `Cursor` and `ClickRing` also now take the pointer's tip
rather than the top-left of its sprite. And the 30's fix clip opened on the
exact press frame, so the pointer appeared from nowhere already pressed; it
enters at 0 now and plays the whole click.

### A product trailer whose UI is code, not a screen recording

Adds `video/`, a Remotion package that renders three cuts of the same film:
a 60s submission trailer, a 30s social edit, and a 15s hook. All 1920x1080,
30fps, H.264 CRF 17, with synthesised audio.

Every Forge surface in it - run page, journey list, console rows, phase rail,
evidence list, the finding's stats band - is a React component built against
the tokens in `apps/web/src/styles.css`, not a captured screenshot. That costs
more than pointing a recorder at the app and buys three things a recording
cannot: the camera can push into a region at full resolution, a single row can
be isolated while the rest of the page stays legible, and the film renders
identically every time, which is what makes frame-level review mean anything.

The run it shows is the Northbeam fixture from `server/demo/app.ts` - its real
journeys, its real Explorer priorities, and its real thrown error, down to the
`src/server/invitations/send.ts:22` that scene 7 opens. Deterministic, so the
cut cannot change because an agent took a different path on a given day.

Two coordinate systems, which is the one thing here not obvious from the code:
`Stage` is frame coordinates for the title cards, `Console` renders a
1320x742.5 product viewport scaled to fill the frame, so sizes inside it are
the real stylesheet's numbers. The constraint that falls out is that camera
scale in a Console scene must stay near 1.11 or below - the 1180px column
already occupies 1716 of 1920 pixels - so those scenes get their movement from
scrolling the page and isolating a card rather than from magnification.

Sound is synthesised from oscillators and filtered noise in
`scripts/build-audio.mjs`, no samples, with cue frames matching the edit.
`scripts/contact-sheet.mjs` renders a stable set of frames on each shot's beat
for visual QA; the storyboard records what that pass found and fixed.
