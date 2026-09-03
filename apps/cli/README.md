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
