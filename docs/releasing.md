# Releasing

## What gets released

`@forge/cli`, and nothing else. `@forge/web` is a Worker: it is deployed with
`pnpm deploy`, and its version number means nothing to anyone. Only the CLI is
something a person downloads and keeps, so only the CLI is versioned, tagged,
and released.

Releases go to GitHub, not to a registry. The package is marked `private`, which
is what stops [Tegami](https://tegami.fuma-nama.dev) from ever reaching npm
while still letting it version the package and write its changelog. Removing
`private` from `apps/cli/package.json` is the whole of what turning npm on
later requires — the release configuration does not change.

## The number comes from the commits

Nobody runs `npm version`. The bump is derived from conventional commit
subjects since the last release tag:

| Commit | Bump |
|---|---|
| `fix(cli): stop --version printing the help` | patch |
| `feat(cli): add --host to every command` | minor |
| `feat(cli)!: drop Node 20` | major |
| `BREAKING CHANGE:` in the footer | major |

A commit subject is a poor place for a release note that needs a paragraph, and
it cannot say "this looks like a patch but people need to read it". For those,
write the note by hand and let the two merge:

```bash
pnpm tegami        # writes .tegami/<name>.md — commit it with the change
```

Both inputs feed the same draft. Neither is a fallback for the other: commits
carry the ordinary cases, files carry the ones worth writing prose about.

## Two merges, one release

```text
  commit ──▶ main ──▶ Version Packages PR ──▶ main ──▶ GitHub release
             │                                 │
             │ tegami ci                       │ version has no tag yet
             │ bumps, writes CHANGELOG.md,     │ compile 5 targets,
             │ regenerates version.ts          │ attach, tag, publish
```

The first merge is the change. CI runs `tegami ci`, which opens or updates a
**Version Packages** pull request holding three things: the bumped
`package.json`, the generated `apps/cli/CHANGELOG.md`, and the regenerated
`apps/cli/src/version.ts`.

The second merge is the release. Nothing publishes until that pull request is
merged, which makes the release a decision someone makes rather than a
side effect of landing a commit. Once it is on `main` the release job sees a
version that no tag points at, and that is its whole trigger — it compiles all
five targets, writes `SHA256SUMS`, and creates a release tagged
`@forge/cli@<version>` whose notes are the changelog section Tegami just wrote.

Because the trigger is "untagged version on `main`", the job is idempotent. A
push that changes nothing about the version finds the tag already present and
stops. A failed release can be re-run by pushing again.

## The version has to be inside the binary

`forge --version` cannot read `package.json` at runtime: a compiled binary is a
single file with no manifest beside it. So the number lives in
`apps/cli/src/version.ts`, generated from the manifest by
`apps/cli/scripts/sync-version.mjs`, and it is written in three places:

- Tegami's `applyCliDraft` hook runs it during versioning, so the regenerated
  file lands in the same pull request as the bump
- `build`, `compile`, and `compile:all` run it, so no artifact can carry a stale
  number
- CI runs it with `--check`, which fails a pull request where the manifest and
  the constant disagree

That constant was hand-written once, and it drifted. Generating it removes the
only way a released binary could report a version that is not its own.

## The artifacts

`pnpm compile:cli:all` produces five standalone executables with the Bun runtime
embedded, so a machine with no Node and no npm can run them:

| File | |
|---|---|
| `forge-darwin-arm64` | ~61 MB |
| `forge-darwin-x64` | ~66 MB |
| `forge-linux-arm64` | ~89 MB |
| `forge-linux-x64` | ~90 MB |
| `forge-windows-x64.exe` | ~94 MB |

`SHA256SUMS` ships alongside them, because verifying a 90 MB download before
putting it on your `PATH` should not require trusting the link it came from.

Pull requests compile one target rather than five. Proving the binary builds and
answers `--version` is what a pull request needs; the matrix is a release cost.

## Workflows

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — typecheck, tests,
  both builds, the version-drift check, and one compiled binary that is actually
  executed
- [`.github/workflows/release.yml`](../.github/workflows/release.yml) — the
  version job and the release job described above
- [`scripts/tegami.mts`](../scripts/tegami.mts) — the release configuration
- [`AGENTS.md`](../AGENTS.md) — how to write a changelog file, for agents and
  for people

## Things worth knowing

**The first release scans all of history.** With no tags in the repository,
Tegami reads every commit. Commits written before this pipeline existed are
prose rather than conventional, so they produce no bump — the first release
needs either a conventional commit or a hand-written changelog file.

**Tegami reformats every workspace manifest** with two-space JSON when it
applies a version. Its npm plugin builds its own package graph before the
`ignore` list filters the shared one, so excluding `@forge/web` does not spare
it. Both manifests are already in that format; keep them there, or every Version
Packages pull request will carry a whitespace diff next to the real change.

**Never edit `apps/cli/CHANGELOG.md` or `.tegami/publish-lock.yaml` by hand.**
Both are written by the tooling, and the lock is what makes a failed release
safe to retry.
