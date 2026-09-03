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
