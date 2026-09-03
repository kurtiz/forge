## @forge/cli@0.4.1

### Bundle dist and keep DevTools out of released builds

`tsc -p .` emitted a faithful file per module and left every dependency to
be resolved at install time, so a 120 KB dist/ cost 23 MB across 38
packages to install. Ink brings React, a reconciler, Yoga, and es-toolkit,
which is 18 MB on its own. scripts/build.mjs bundles instead: 178 kB
packed, nine files, no runtime dependencies.

It bundles with splitting rather than to one file. index.ts imports the
Ink views dynamically so that --version, --help, and the plain CI
renderer -- most of the runs -- never parse a UI framework. A single-file
bundle inlines that import and undoes it, measured at 33 ms to 55 ms of
startup. Split, the entry stays 9 KB and startup does not move.

Sourcemaps are dropped from dist/. They cost 2.0 MB against a 508 KB
bundle, 1.8 MB of it mapping Ink and React, and nothing reads them: the
CLI reports failures through fatal(), which prints error.message, so no
stack trace ever reaches a user to be mapped.

The DevTools exclusion never worked. Ink guards the import with
process.env['DEV'], Bun's --define rewrites only the dotted form, so the
branch survived and react-devtools-core shipped in every binary -- along
with a full `ws` client, which ink/build/devtools.js imports separately to
probe for a DevTools server. Stubbing Ink's devtools module takes out both
in one interception and leaves `ws` alone elsewhere. Binaries drop 0.6 MB;
dist/ drops 48 KB.

That the previous attempt failed silently is the reason for the check that
replaces it. assertStripped fails a build whose output still contains the
DevTools probe address, and fails one where the replacement matched
nothing, which is how Ink moving the file would otherwise go unnoticed.

Bundling and stubbing both need a resolver plugin, which `bun build` has
no flag for, so compile.mjs drives Bun.build rather than spawning the CLI.
Bun is now needed to build the npm package and not only to compile a
binary, so CI's check job installs it.

Nothing here shrinks a binary meaningfully: 60.5 MB of the 62 MB is the
Bun runtime, and Bun is already the smallest of the options at hand --
Deno's floor is 82 MB and Node's SEA is 116 MB. Compressing the release
artifacts is what moves that number, and it is the installer's job.

## @forge/cli@0.4.0

### Install the CLI without a dependency tree

`dist/` is now bundled rather than emitted a file per module, so the package
carries what it actually reaches and declares no runtime dependencies. Installing
it went from 23 MB across 38 packages to a 178 kB tarball and nine files, most of
that saved by es-toolkit, which Ink depends on and which is 18 MB on its own.

Startup is unchanged. `verify` and `projects` are the only commands that draw a
terminal panel, and they are still loaded on demand: the entry stays at 9 kB, so
`--version`, `--help`, and the plain CI renderer never parse a UI framework to
print a line of text.

### Stop shipping React DevTools inside the released binaries

Ink loads a DevTools client behind a `DEV` environment check that a released
build can never satisfy, but the bundler still had to resolve what was inside the
branch, so react-devtools-core and a WebSocket client were compiled into every
binary. The build was passing `--define process.env.DEV="false"` to collapse the
branch, which does not work: Bun rewrites only the dotted form and Ink reads
`process.env['DEV']`.

The module is emptied at build time instead, and the build now fails if the
DevTools client reaches an output or if the replacement stops matching, rather
than shipping it silently the way the previous attempt did.

### Bundle dist and keep DevTools out of released builds

`tsc -p .` emitted a faithful file per module and left every dependency to
be resolved at install time, so a 120 KB dist/ cost 23 MB across 38
packages to install. Ink brings React, a reconciler, Yoga, and es-toolkit,
which is 18 MB on its own. scripts/build.mjs bundles instead: 178 kB
packed, nine files, no runtime dependencies.

It bundles with splitting rather than to one file. index.ts imports the
Ink views dynamically so that --version, --help, and the plain CI
renderer -- most of the runs -- never parse a UI framework. A single-file
bundle inlines that import and undoes it, measured at 33 ms to 55 ms of
startup. Split, the entry stays 9 KB and startup does not move.

Sourcemaps are dropped from dist/. They cost 2.0 MB against a 508 KB
bundle, 1.8 MB of it mapping Ink and React, and nothing reads them: the
CLI reports failures through fatal(), which prints error.message, so no
stack trace ever reaches a user to be mapped.

The DevTools exclusion never worked. Ink guards the import with
process.env['DEV'], Bun's --define rewrites only the dotted form, so the
branch survived and react-devtools-core shipped in every binary -- along
with a full `ws` client, which ink/build/devtools.js imports separately to
probe for a DevTools server. Stubbing Ink's devtools module takes out both
in one interception and leaves `ws` alone elsewhere. Binaries drop 0.6 MB;
dist/ drops 48 KB.

That the previous attempt failed silently is the reason for the check that
replaces it. assertStripped fails a build whose output still contains the
DevTools probe address, and fails one where the replacement matched
nothing, which is how Ink moving the file would otherwise go unnoticed.

Bundling and stubbing both need a resolver plugin, which `bun build` has
no flag for, so compile.mjs drives Bun.build rather than spawning the CLI.
Bun is now needed to build the npm package and not only to compile a
binary, so CI's check job installs it.

Nothing here shrinks a binary meaningfully: 60.5 MB of the 62 MB is the
Bun runtime, and Bun is already the smallest of the options at hand --
Deno's floor is 82 MB and Node's SEA is 116 MB. Compressing the release
artifacts is what moves that number, and it is the installer's job.

## @forge/cli@0.3.0

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
