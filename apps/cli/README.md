# @forge/cli

Verify a deployed web application from your terminal.

```bash
npm install -g @forge/cli

forge login
forge verify --url https://preview.example.com --repo https://github.com/acme/app
```

`forge verify` starts a run, watches its progress, and prints the findings. It
exits non-zero when Forge confirms a defect, so it works as a CI gate as it
stands:

```yaml
name: Verify the preview
on: pull_request

jobs:
  forge:
    runs-on: ubuntu-latest
    steps:
      - id: deploy
        run: echo "url=$(./scripts/deploy-preview.sh)" >> "$GITHUB_OUTPUT"

      - name: Verify it works
        run: npx @forge/cli verify --url "${{ steps.deploy.outputs.url }}" --repo "${{ github.server_url }}/${{ github.repository }}"
        env:
          FORGE_TOKEN: ${{ secrets.FORGE_TOKEN }}
```

A flaky or environmental failure is printed but does not fail the command.
Blocking a merge on a rate limit teaches people to skip the check, which costs
more than it saves. If you would rather decide for yourself, `--json` prints the
whole report:

```bash
forge verify --url https://preview.example.com --json | jq '.findings[].classification'
```

## A single executable

`bun build --compile` embeds the Bun runtime in the output, so the result runs
on a machine with no Node and no npm:

```bash
pnpm compile         # bin/forge, for this machine
pnpm compile:all     # bin/forge-<os>-<arch>, for all five release targets
```

macOS and Linux on x64 and arm64, plus Windows x64. Bun downloads each target's
runtime the first time it compiles for it, so the first `compile:all` is slow
and later ones are not.

The binaries are ~60-90 MB, because a runtime is inside each one. They are
release artifacts rather than package contents: `bin/` is ignored by git and is
not in the npm tarball, where `dist/` and a Node shebang remain the right
answer for `npm install -g @forge/cli`.

## Releasing

Versions are derived from commit messages, not typed in. A `feat:` commit takes
a minor, a `fix:` takes a patch, and a `!` or a `BREAKING CHANGE:` footer takes
a major:

```
feat(cli): add --host to every command
fix(cli): stop --version printing the help text
feat(cli)!: drop Node 20
```

For anything a commit subject cannot say well, write the note by hand instead
and let the two merge:

```bash
pnpm tegami        # writes .tegami/<name>.md, commit it with the change
```

Merging to `main` opens a **Version Packages** pull request holding the bumped
`package.json`, the generated `CHANGELOG.md`, and the regenerated
`src/version.ts`. Merging *that* is the release: CI sees a version on `main`
with no tag pointing at it, compiles all five targets, and publishes a GitHub
release tagged `@forge/cli@<version>` with the binaries, a `SHA256SUMS` file,
and the changelog section as its notes.

Nothing is published to npm. The package is `private`, so Tegami versions it
and writes its changelog but never reaches a registry — removing `private` is
what turns npm publishing on later.

`src/version.ts` is generated from `package.json`; `forge --version` reads it
because a compiled binary has no manifest to consult at runtime. The builds
regenerate it and CI fails a pull request where the two have drifted, so it
should never need editing by hand.

## Two renderers

On a terminal the run is drawn as a live Ink panel: a spinner on the current
phase, a bar that fills as journeys finish, each journey resolving to a tick or
a cross, and the result in the same frame when it ends.

Everywhere else — a pipe, a file, a CI log, `--json`, or `NO_COLOR` — it prints
plain lines with no escape sequences. A panel that redraws itself is thousands
of control characters and no information once nothing is watching it, and this
CLI's main job is being a CI gate.

Both read the same `summarise()` result in `src/summary.ts`, so the two cannot
disagree about what a run found. `react-devtools-core` is a devDependency only
because Bun resolves Ink's import of it while bundling; `--define
process.env.DEV="false"` kills that branch, so it never reaches the binary.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | No confirmed defects |
| 1 | Confirmed defects, or the run failed |
| 2 | Bad usage, or no credentials |

## Commands

```text
forge login [--token <token>] [--host <url>]   store credentials
forge logout                                   remove them
forge whoami                                   show the signed-in account
forge verify --url <url> [--repo <url>]        verify a deployment
                [--goal <text>] [--name <text>]
                [--project <id>] [--json]
                [--no-wait] [--timeout <seconds>]
forge projects                                 list projects
```

`FORGE_TOKEN` and `FORGE_HOST` override the stored configuration, which is what
CI should use. The config file is `~/.forge/config.json`, written with owner-only
permissions.

## Which host a command talks to

Commands default to `https://forge.papiliocurtis.workers.dev`. Four things can
point them somewhere else — a self-hosted deployment, a staging Worker, or
`wrangler dev` on your own machine — and the first one present wins:

| | Override | Scope |
|---|---|---|
| 1 | `--host <url>` on any command | that one command |
| 2 | `FORGE_HOST` | the shell or CI job |
| 3 | `host` in `~/.forge/config.json` | the machine, until `forge logout` |
| 4 | the built-in default | everything else |

```bash
# Once, for this machine: login stores the host next to the token.
forge login --host https://forge.staging.example.com

# For a single command, leaving the stored host alone.
forge verify --url https://preview.example.com --host http://localhost:8787

# For a CI job or a shell session.
export FORGE_HOST=https://forge.staging.example.com
```

A host with no scheme is read as `https`, and a trailing slash is dropped, so
`--host forge.example.com` works but `--host localhost:8787` needs its
`http://` spelled out.
