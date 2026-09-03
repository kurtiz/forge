## @forge/cli@0.2.0

### Keep commit trailers out of published release notes

Changelog entries are generated from commit bodies, so the Claude-Session
trailer was being published as the last line of the GitHub release note.
Sign-offs and co-author lines would have followed it.

The generator now drops trailer lines and collapses the gap they leave.
They stay in the commits, which is where they are addressed to the
repository rather than to whoever is reading a release.

### Draw the run as a live Ink panel on a terminal

Watching a verification used to mean a single rewriting line of text for
however long the run took. The terminal now gets a panel: a spinner on
the current phase, a bar that fills as journeys finish, every journey
resolving from a dot to a tick or a cross as it lands, an elapsed clock
so a slow run visibly stays alive, and the result drawn into the same
frame when it ends. Findings carry a filled severity badge rather than a
coloured word, because a block of colour is findable when scanning.

Only a terminal gets it. A pipe, a file, a CI log, --json, and NO_COLOR
all keep the plain renderer, since a view that redraws itself is
thousands of control characters and no information once nothing is
watching -- and this CLI's main job is being a CI gate.

Keeping two renderers honest is the point of src/summary.ts: both read
one summarise() result, so they cannot disagree about what a run found.
That extraction also fixes "1 journeys failed", which read as a bug in
the tool rather than in the application under test.

waitForRun now hands out the whole report instead of a pre-rendered
string, so the panel can show journeys while the plain path keeps its
one-line status.

Ink is the CLI's only dependency. react-devtools-core is a devDependency
purely because Bun resolves Ink's import of it while bundling; defining
process.env.DEV as false kills that branch in minification, so neither it
nor the devtools code reaches the binary, which grows by 1 MB.
