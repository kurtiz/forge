# Forge

## AI writes the code. Forge proves it works.

Forge is an evidence-first verification layer for AI-built web applications.

Give Forge a deployed URL. It explores the application in a real browser,
discovers the user journeys that matter, executes them, reproduces the failures,
and produces findings that are backed by screenshots, console output, network
errors, and an auditable trace of what the agent did. Then it can re-run the
exact reproduction against a fixed build and tell you whether the fix worked.

Built with Solari browsers, Cloudflare Workers, D1, R2, Durable Objects,
Workers AI, Drizzle ORM, TanStack Start, Cloudflare Kumo, and Tailwind CSS v4.

---

## Why

Generating software got cheap. Verifying it did not.

An agent can produce a working-looking application in minutes, and the bottleneck
moves to the question nobody has automated: *does it actually work?* Unit tests
check the code the author thought about. Forge checks the application the way a
user meets it, from the outside, and refuses to report anything it cannot show
you the evidence for.

The rule the whole system is built around:

> **No evidence, no high-confidence bug.**

---

## Architecture

```text
                          FORGE

                   ┌──────────────────┐
                   │  TanStack Start  │
                   │  Web / Console   │
                   └────────┬─────────┘
                            │  server functions (typed RPC)
                   ┌────────▼─────────┐
                   │   Worker entry   │
                   │  auth · API · UI │
                   └────────┬─────────┘
                            │
             ┌──────────────┼───────────────┐
             ▼              ▼               ▼
      Run service     Agent runtime    Evidence store
             │              │               │
             ▼              ▼               ▼
     RunSessionDO     Explorer            R2
     (live state,     Operator
      SSE, cancel)    Judge
             │              │
             ▼              ▼
            D1        Execution layer
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
           Solari browser        HTTP executor
             (CDP over WS)        (HTMLRewriter)
```

Three clean layers:

| Layer | Owns |
|---|---|
| **Intelligence** | Explorer, Operator, Judge, prompts, model routing |
| **Execution** | Solari browser sessions, page observation, actions |
| **Control plane** | Workers, D1, R2, Durable Objects, Workers AI, auth, budgets |

The model proposes. Application code decides.

### Key decisions

**Solari is driven over raw CDP, not through its SDK.** `@solarisdk/browser`
bundles a Playwright fork that needs Node and raw sockets, so it cannot run on
Workers. Solari exposes each session's CDP endpoint and Workers can hold an
outbound WebSocket, so `apps/web/src/server/execution/` speaks CDP directly. The whole
control plane stays on Workers with no extra hop.

**There is a working fallback.** Without a `SOLARI_API_KEY`, runs use an HTTP
executor built on `HTMLRewriter`: real requests, real status codes, real form
submissions, real cookies. It cannot run JavaScript, so it will miss
client-rendered failures. Which executor produced a finding is recorded on the
run and shown in the UI, because a finding is only as good as the fidelity
behind it.

**The Judge cannot overrule the measurement.** Reproduction rate, severity, and
classification are computed by deterministic rules in `apps/web/src/server/domain/`. The
model writes the narrative and may propose a root cause; it cannot promote a
flaky failure to a confirmed bug. Every model response is schema-validated
before it reaches the database.

**The run engine lives in a Durable Object.** One instance per run owns the
execution loop, the event sequence, the cancellation flag, and the set of
clients watching live. HTTP requests never execute a run inline; they return a
run id and the client subscribes over SSE.

**Drizzle is the schema, not just the query builder.** `apps/web/src/server/db/schema.ts`
defines every table once, and three things read it: drizzle-kit generates the
migrations from it, Better Auth's Drizzle adapter resolves its own tables
through it, and Forge's queries are typed by it. Renaming a column is a type
error rather than a runtime surprise. Enum-shaped text columns carry `$type<>()`
so the row types match the API contracts exactly, which is why the UI can
exhaustively switch on a run status or a severity.

**One Worker, real internal boundaries.** `services/*` in the design document
map to modules under `apps/web/src/server/`, not to separate Workers. Splitting them out
would be microservice theatre at this size; the boundaries are enforced by
module structure and would survive being pulled apart when there is a reason to.

---

## The console

A project, its runs, and the findings they produced. Almost everything here is
reachable from the CLI and the REST API too; what is not is the part that needs
a pointer — watching a run go, and looking at what it saw.

### A project

A target URL, plus the things Forge cannot infer from one: the workflow that
matters most, a public repository to connect a runtime failure to its source,
and a preview URL template for hosts that do not announce their deployments to
GitHub. The dashboard opens on the three numbers that answer *is anything broken
right now* — runs, clean runs, open bugs — over the projects that produced them.

Four panels sit on the project page. None is required for a run, and each one
exists because discovery on its own gets a specific thing wrong.

| Panel | What it fixes |
|---|---|
| **Test accounts** | An application behind a login. One account per role, because what an administrator can reach is not what a member can reach; runs sign in with the one marked default. The password is encrypted with AES-GCM, decrypted only inside the run's Durable Object at the moment it is typed, and never read back — editing with a blank password field keeps the stored one, which is how a label or a login path gets corrected later. |
| **Planned journeys** | Discovery is a guess, and a different guess each run: the journey a team actually cares about can drop off the list because a model ranked a settings page higher this time. A planned journey runs every time, in priority order, before anything discovered — and *instead of* a discovered one, because the budget is the same either way. |
| **Sample data** | The Operator invents what it types, and invented data is right up until the application checks it against itself: a form that looks a patient up by phone number will not find one for a number Forge made up. A sample value is somebody who knows the application saying *this one exists*, matched to a field by its label. Never a credential — these are shown back in the console and written into evidence like any other typed value. |
| **Request headers** | An edge that challenges automated traffic, or a preview behind an access gate. Store a header and its secret value, write one edge rule that admits requests carrying it, and the run gets in without the protection being relaxed for anyone else. Values are encrypted like a password and never shown again; they are sent to the project's own origin and nowhere else, so a link off the site cannot carry one away. `User-Agent` cannot be set — Forge identifies itself honestly. |
| **Schedule** | Re-verification on a cadence. See [Scheduled monitoring](#scheduled-monitoring). |

### A run

Nine states, and the page follows them as they happen:

```text
queued → starting → discovering → testing → investigating → reporting → completed
                                                                      ↘ failed
                                        stop, at any point            ↘ canceled
```

The persisted timeline arrives with the page and the Durable Object streams only
what happens after it, as server-sent events through a route that checks
ownership before the stream is opened. When the run reaches a terminal state the
stream closes and the page reloads its data once, so journeys, findings, and
evidence appear without polling. **Stop** lands on the next step boundary and
still releases the browser session.

Findings come first, because they are why the page was opened; then journeys
with their steps, then the raw agent trace, then the artifacts. Every run
records which executor produced it and is labelled with what started it —
`manual`, `cli`, `scheduled`, `pull_request`, or `verify_fix` — so a hand-started
run is never mistaken for an automated one in a history.

A run against a target behind bot protection stops at the front door. Cloudflare,
DataDome and the like answer **HTTP 200** with an interstitial, so nothing about
the run looks wrong: journeys get discovered from the challenge screen, none of
them finds a control — the widget is in a cross-origin frame the page model
cannot see into — and the report describes an application with nothing on it,
which is false in every sentence. Forge recognises the interstitial at the entry
page and ends the run there with one `BOT_CHALLENGE` finding that names the
service, classified `environment` so it cannot fail a pull request. It does not
try to solve or evade the challenge, and the fix instructions it writes forbid
the agent reading them from trying either.

The way through is a door you open on purpose. Put a header and a secret value
under **Request headers** on the project; Forge sends them on every request to
that origin, and one rule at your edge — skip the challenge for requests
carrying that header with that value, on that hostname — lets the run in while
everyone else still meets the challenge. The finding's fix instructions adapt to
which half is already done: with no header configured they ask for the secret
first, and with one configured they name it and ask for the rule.

### A finding

The verdict, and then the numbers that decide whether to act on it.

- **Classification** — `confirmed_bug`, `flaky`, `environment`, `agent_error`, `unknown`
- **Failure class** — `APPLICATION_BUG`, `AUTH_FAILURE`, `BOT_CHALLENGE`, `NETWORK_FAILURE`, `TIMEOUT`, `ENVIRONMENT_FAILURE`, `BROWSER_FAILURE`, `SOLARI_FAILURE`, `AGENT_ERROR`, `UNKNOWN`
- **Severity** — critical, high, medium, low
- **Reproduction** — how many of *n* attempts failed the same way
- **Confidence**, and where investigation ran, a proposed root cause with the files it points at

Then **How to fix this**: who owns the change — application code, infrastructure,
or this project's own verification settings — the steps to take, and a brief
written for a coding agent, carrying the journey, the steps as they ran, the
verdict and the files the source investigation touched. It is derived from the
finding by deterministic rules, so it says the same thing every time, and it ends
with the rules that stop an agent from changing the test instead of the code. The
same block, collapsed, goes into the GitHub check for the finding that decided
it.

Then the steps that produced it, then the evidence behind each one. Two actions:
**Verify fix** re-runs that exact journey against the current deployment and
resolves the finding when it passes, and **Dismiss** closes one you have decided
not to act on without pretending it was fixed.

### Evidence

Seven kinds — `screenshot`, `recording`, `console`, `network`, `page`, `action`,
`source` — written to R2 under a run-scoped prefix, with only the key and its
metadata in D1. Nothing is public: artifacts are served through an authenticated
route that re-checks the owning run on every fetch. Screenshots are a sequence
rather than a gallery — the entry page, then each journey's final state — so
they get a filmstrip with a viewer behind it instead of a tab full of PNG at an
opaque URL. Artifacts are retained for 14 days; recordings are heavy and rarely
read after a week.

### Accounts

Email and password, GitHub, or guest, all producing the same user row — see
[Security](#security) for why the guest door exists only in development.
**Settings** holds the two things that reach Forge from outside the browser: API
tokens for the CLI and CI, and the GitHub App connection.

---

## Demo

The repository ships a deliberately broken application at `/demo` ("Northbeam"),
so the entire loop is demonstrable without depending on a third-party site.

Seeded defects:

1. Applying a coupon at checkout returns 500.
2. Inviting a teammate outside the org domain returns 500.
3. The Pricing link in the navigation points at a page that was renamed.

Checkout and invitations sit behind a login (`ines@northbeam.test` /
`northbeam-demo` at `/demo/login`). A project can hold one test account per
role; runs sign in with the one marked as used for runs. An unauthenticated request is answered with
the login form at **HTTP 200** — no redirect, no 401 — which is the auth wall a
verifier cannot see from status codes. Run the demo without credentials and
Forge reports `AUTH_FAILURE`; add the test account under **This app needs a
login** and the same run finds the real defects behind it.

The 60-second demo:

1. Sign in as a guest.
2. Create a project pointed at your own `/demo` URL, or press **Use the demo app**.
3. Watch the run: journeys discovered, executed, failures reproduced.
4. Open a finding. Read the steps, the network evidence, the reproduction count.
5. Set `FORGE_DEMO_FIXED="1"` in `apps/web/.dev.vars` to repair the defects.
6. Press **Verify fix** on the finding.
7. The exact journey re-runs and passes. The finding is marked resolved.

---

## Quick start

```bash
pnpm install
cp .dev.vars.example .dev.vars     # then set BETTER_AUTH_SECRET
pnpm db:migrate                    # applies migrations to the local D1
pnpm dev
```

Open http://localhost:3000 and press **Continue as guest**. Guest access exists
only when `FORGE_ENV=development`: a guest can start real, billable browser
sessions, so the anonymous endpoint is not registered anywhere else.

No Cloudflare login, no Solari key, and no model provider are required to run
the whole loop locally. Forge degrades honestly: the HTTP executor replaces the
browser, and heuristic agents replace the model.

To run against a real browser, add a Solari key to `apps/web/.dev.vars`:

```bash
SOLARI_API_KEY="sk_..."
```

Workers AI has no local simulator, so its binding is marked `remote` and the
model calls in development go to the real service. That needs an account named,
either in `apps/web/.dev.vars` or in the environment:

```bash
CLOUDFLARE_ACCOUNT_ID="<id>"            # in .dev.vars, or exported
pnpm dev
```

`wrangler whoami` lists the ids. Without one, discovery falls back to page
heuristics, which are much weaker — the run timeline says so explicitly rather
than leaving a thin set of journeys to look like a thin application. Only the AI binding is remote; D1, R2, and the
Durable Object stay local either way. The account id is what switches remote
bindings on at all, because a login that can see several accounts cannot pick
one on its own, and an unconditional remote binding stops `pnpm dev` from
starting rather than degrading to local.

Runs then get JavaScript execution, screenshots, console and network capture,
and a session replay link on the finding.

---

## Development

Forge is a pnpm workspace. The root package builds nothing itself; every
script below delegates to the package that owns the work, so they can all be
run from the repository root.

```bash
pnpm typecheck     # tsc --noEmit, across every workspace package
pnpm test          # unit tests (@forge/web)
pnpm build         # client + worker bundles (@forge/web)
pnpm build:cli     # the CLI, into apps/cli/dist
pnpm check         # all of the above
```

To run something in one package only, filter for it:

```bash
pnpm --filter @forge/web dev
pnpm --filter @forge/cli build
```

The CLI is a separate package under `apps/cli/`, compiled by its own tsconfig
against Node libraries rather than the Worker's. It talks to the REST API in
`apps/web/src/server/rest/`, never to the server functions, so it keeps working
against a Forge that is a version or two ahead. It deliberately hand-writes the
response shapes it reads rather than importing the server's contracts, which is
why it is a sibling package and not a consumer of one.

### Changing the schema

`apps/web/src/server/db/schema.ts` is the single source of truth. Edit it, then:

```bash
pnpm db:generate           # drizzle-kit writes the migration
pnpm db:migrate            # apply to the local D1
pnpm db:migrate:remote     # apply to the deployed D1
```

Migrations land in `apps/web/infrastructure/migrations`, which is the directory
`wrangler d1 migrations apply` reads, so there is one migration history rather
than two. There is deliberately no `drizzle-kit push` script: pushing would
leave the deployed database in a state no migration describes.

### Layout

A pnpm workspace with two packages. The root holds no source of its own.

```text
package.json              workspace root; scripts delegate with --filter
pnpm-workspace.yaml       packages: apps/*, packages/*
tsconfig.base.json        the strictness both packages share
apps/
  web/                    @forge/web - the Worker: app, API, run engine
    vite.config.ts        wrangler.jsonc, drizzle.config.ts, vitest.config.ts
    src/
      routes/             TanStack Start file routes (pages, API, demo app)
      components/         UI: shell, status vocabulary, evidence, live stream
      server/
        contracts/        zod schemas shared across every boundary
        db/               Drizzle schema and client (source of truth for D1)
        domain/           run state machine, classification, scoring, budgets
        security/         target-URL validation (SSRF), header policy, repo URL policy
        execution/        BrowserExecutor interface, Solari CDP, HTTP fallback
        agent/            Explorer, Operator, Judge, prompts, model router
        evidence/         R2 artifact store and metadata
        runs/             repository, run service, engine, RunSessionDO
        github/           App auth, webhooks, checks, preview URLs
        monitoring/       schedules, cadence arithmetic, the cron tick
        tokens/           API token format, hashing, storage
        rest/             the public REST API the CLI and CI talk to
        demo/             the deliberately broken fixture application
        auth.ts           Better Auth (email/password, anonymous, API tokens)
        api.ts            typed server functions the UI calls
    infrastructure/migrations/
    tests/unit/
  cli/                    @forge/cli - a separate zero-dependency package
    src/                  flat, Node-only, compiled to apps/cli/dist
```

### Imports

Inside `@forge/web`, `@/` is the alias for `apps/web/src`, and it is how every
import that crosses a directory is written:

```ts
import { db } from '@/server/db'          // anything in another directory
import { pill } from './status'           // a sibling stays relative
```

`../` is not used: a module that moved used to drag a fan of `../../..`
rewrites behind it, and the depth of a path said nothing about where it
pointed. The alias is declared once in `apps/web/tsconfig.json` and picked up
by Vite (`resolve.tsconfigPaths`), by `tsx` for the browser test, and by an
explicit alias in `vitest.config.ts`.

`@forge/cli` does not use the alias. It compiles with `tsc` to real JavaScript
that Node runs directly, and `tsc` does not rewrite path aliases in its output,
so the CLI stays on relative `./x.js` specifiers that resolve at runtime.

### Cloudflare resources

Before deploying, create the resources and paste the ids into `apps/web/wrangler.jsonc`:

```bash
wrangler d1 create forge
wrangler r2 bucket create forge-evidence
wrangler queues create forge-cleanup
wrangler queues create forge-cleanup-dlq

wrangler secret put BETTER_AUTH_SECRET
wrangler secret put SOLARI_API_KEY        # optional
wrangler secret put FORGE_CREDENTIAL_KEY  # optional; needed to store app logins

# Optional; all three together enable pull request verification
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_WEBHOOK_SECRET

# Optional; both together enable "Continue with GitHub" on the sign-in page
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

pnpm db:migrate:remote
pnpm deploy
```

Keep development, staging, and production on separate D1 databases, R2 buckets,
and Solari keys. A development run must never be able to reach production data.

### Configuration

Local values live in `apps/web/.dev.vars` (copy `.dev.vars.example`); deployed
ones are Wrangler secrets. Only the first is required. Forge degrades honestly
without the rest and says so in the run rather than in the documentation.

| Variable | |
|---|---|
| `BETTER_AUTH_SECRET` | **Required.** Session signing key |
| `FORGE_ENV` | `development` allows loopback targets and registers guest sign-in |
| `APP_URL` | The public origin. OAuth callbacks and the run links handed to the CLI are built from it |
| `SOLARI_API_KEY` | Real browser sessions and repository investigation. Without it: the HTTP executor, and no investigation |
| `SOLARI_BASE_URL` | Overrides the Solari host, for staging or a self-hosted gateway |
| `FORGE_CREDENTIAL_KEY` | Encrypts stored test-account passwords. Needed only to store an application login |
| `CLOUDFLARE_ACCOUNT_ID` | Names the account for the remote Workers AI binding in development |
| `AI_GATEWAY_URL` · `AI_GATEWAY_KEY` · `AI_GATEWAY_MODEL` | Point the agents at an OpenAI-compatible endpoint instead of Workers AI |
| `GITHUB_APP_ID` · `GITHUB_APP_PRIVATE_KEY` · `GITHUB_WEBHOOK_SECRET` · `GITHUB_APP_SLUG` | Pull request verification; needed together |
| `GITHUB_CLIENT_ID` · `GITHUB_CLIENT_SECRET` | "Continue with GitHub" on the sign-in page |
| `FORGE_DEMO_FIXED` | Repairs the seeded demo defects, so **Verify fix** has something to pass |

The bindings, all declared in `apps/web/wrangler.jsonc`:

| Binding | |
|---|---|
| `DB` | D1 — projects, runs, journeys, findings, evidence metadata, tokens, schedules |
| `EVIDENCE` | R2 — artifacts, under a run-scoped key prefix |
| `RUN_SESSION` | Durable Object — one per run: the execution loop, the event sequence, the cancel flag, the clients watching |
| `AI` | Workers AI. The one binding marked `remote`, because it has no local simulator |
| `CLEANUP_QUEUE` | Evidence purge after a project is deleted, with a dead-letter queue behind it |
| `ANALYTICS` | Analytics Engine — one datapoint per completed run: findings, confirmation rate, actions, model calls |
| cron `*/15 * * * *` | The monitoring tick. Every cadence shares it |

Budgets are capped per run and enforced in `domain/budget`: 6 journeys, 20 model
calls, 120 browser actions, 15 minutes of browser time, 3 reproduction attempts,
24 MB of evidence, 10 minutes of sandbox.

---

## Beyond the console

The verification loop is the same in every one of these. Only the trigger, and
where the result is delivered, changes.

### CLI

```bash
npm install -g @forge/cli

forge login
forge verify --url https://preview.example.com --repo https://github.com/acme/app
```

```text
Forge verification

✓ Application reachable
✓ Browser session
✓ 7 journeys discovered
✓ 6 journeys passed
✗ 1 journey failed

Finding
  critical  Applying a coupon at checkout returns 500
    reproduced 3/3 times

View:
https://forge.papiliocurtis.workers.dev/runs/run_123
```

| Command | |
|---|---|
| `forge verify --url <url>` | start a run, watch it, print what Forge can prove |
| `forge login [--token <t>] [--host <url>]` | check a token and store it |
| `forge logout` | remove the stored token |
| `forge whoami` | the account a token belongs to |
| `forge projects` | id, name, and target of every project the token can reach |

| `forge verify` option | |
|---|---|
| `--url <url>` | the deployment to verify; the project is found or created from it |
| `--project <id>` | verify an existing project instead of a URL |
| `--repo <url>` | public GitHub repository, to connect failures to source |
| `--goal <text>` | the workflow that matters most |
| `--name <text>` | project name, when one is created |
| `--json` | the whole report as JSON, on stdout |
| `--fix` | print the coding-agent prompt for the leading finding into the log |
| `--no-wait` | start the run and exit without watching it |
| `--timeout <seconds>` | give up waiting; the run continues (default 900) |

The exit code is the contract: **0** no confirmed defects, **1** confirmed
defects or the run itself failed, **2** bad usage or no credentials. So it is a
CI gate as it stands, with no wrapper script:

```yaml
- name: Verify the preview
  run: npx @forge/cli verify --url "${{ steps.deploy.outputs.url }}"
  env:
    FORGE_TOKEN: ${{ secrets.FORGE_TOKEN }}
```

Every run prints **How to fix** for the finding that decided it: who owns the
change, the steps, and where the coding-agent prompt is. `--fix` prints the
prompt itself into the log, verbatim, for piping somewhere that will act on it:

```bash
forge verify --url https://preview.example.com --fix
```

A flaky or environmental failure is printed but does not fail the command,
because blocking a merge on a rate limit teaches people to skip the check — a
run stopped by bot protection is one of these, and it says so in the first line
rather than claiming the application was reachable. If you would rather draw
that line yourself, `--json` prints the whole report, `remediation` included:

```bash
forge verify --url https://preview.example.com --json | jq '.findings[].classification'
```

Tokens are issued in the console under **Settings**, stored as a SHA-256 hash,
and shown exactly once. `forge login` checks a token against the API before
writing it to `~/.forge/config.json` with owner-only permissions — storing one
unchecked turns a typo into a confusing failure much later, in CI, on someone
else's day. `FORGE_TOKEN` and `FORGE_HOST` override the stored file, which is
what CI should use.

Commands talk to `https://forge.papiliocurtis.workers.dev` unless told
otherwise, and the first override present wins: `--host <url>` on the command,
then `FORGE_HOST`, then the `host` stored by `forge login --host <url>`. That
is what points the same binary at a self-hosted deployment, a staging Worker,
or `wrangler dev` on localhost.

The CLI renders twice. On a terminal, [Ink](https://github.com/vadimdemedes/ink)
draws a live panel: a spinner on the current phase, a bar that fills as journeys
finish, each journey resolving to a tick or a cross as it lands, and the result
in the same frame when the run ends. Everywhere else — a pipe, a file, a CI log,
or `--json` — it prints plain lines with no escape sequences, because a view
that redraws itself is thousands of control characters and no information once
nothing is watching. Both renderers read the same summary, so they cannot
disagree about what a run found.

That is the CLI's only dependency, and it is a deliberate one: the panel is what
a person watches for two minutes, and the plain lines are what a CI gate keeps.
Everything else is Node's own fetch and about a thousand lines. It polls the
REST API rather than subscribing to the console's stream — a poll survives a
buffering proxy, a sleeping laptop, and a CI runner that drops idle connections
— writes progress to stderr and results to stdout so `--json | jq` works while
the run is still going, and emits no colour when the stream is not a TTY or
`NO_COLOR` is set.

### REST API

What the CLI talks to, and what anything else should. Deliberately separate from
the server functions the console uses: those are a private typed transport
between this application's own client and server, while this is a public
contract that has to keep working against a Forge a version or two ahead.

Authentication is `Authorization: Bearer forge_...`, resolved to exactly the
same user a console session yields, so every ownership check here is the one the
console already uses. A request naming someone else's run gets 404 rather than
403: a token must not be able to tell "not yours" from "does not exist".

| Endpoint | |
|---|---|
| `POST /api/v1/runs` | start a run. `url` or `projectId`, plus optional `repo`, `goal`, `name`, `idempotencyKey`. A URL is enough — the project already pointing at it is reused, or one is created, so the terminal never has to know Forge's object model. → `201` |
| `GET /api/v1/runs/:id` | run, project, journeys, and findings in one request, so a poll costs one round trip per tick |
| `GET /api/v1/projects` | what this token can verify |
| `DELETE /api/v1/projects/:id` | → `202`: the project is invisible immediately, and its evidence leaves R2 on the cleanup queue |
| `GET /api/v1/whoami` | the account behind a token |

```bash
curl -X POST https://forge.papiliocurtis.workers.dev/api/v1/runs \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"https://preview.example.com","goal":"checkout"}'
```

Two more routes take the same credentials and exist for the console:
`GET /api/runs/:id/stream`, the run's server-sent events, and
`GET /api/evidence/:id`, one artifact with the owning run re-checked.

### GitHub

```text
pull request opened or updated
        ↓
preview deployment              ← reported by the host, or derived from a
        ↓                         URL pattern on the project
Forge verification run
        ↓
check on the head commit
```

Install the app, link it from **Settings**, and add the repository to a project.
Most hosts announce preview deployments to GitHub and nothing else is needed;
for those that do not, a project can carry a pattern such as
`https://pr-{number}.example.pages.dev`.

Three rules bound what a webhook can cause:

- An installation nobody has claimed in the console does nothing at all. A
  webhook names a GitHub account, never a Forge one.
- A preview URL from a delivery goes through exactly the same SSRF policy as a
  URL typed into the console.
- Every run started from GitHub carries an idempotency key derived from the
  commit, so the several events describing one deployment produce one billable
  run.

A confirmed defect fails the check. Everything else is reported as neutral.

### Scheduled monitoring

A project can re-verify itself on a cadence between every 30 minutes and daily.
One cron trigger fires every fifteen minutes and starts only the runs that are
actually due, so every cadence shares one trigger.

Notifications go to a webhook on the transitions that matter: the first
failure, the recovery, and every fourth consecutive failure after that. Steady
green says nothing, and a week-long outage does not produce a week of alerts.

---

## Security

**Target URLs are validated before every navigation.** A user-supplied URL that
a Worker will fetch is an SSRF primitive. `apps/web/src/server/security/target-url.ts`
rejects non-HTTP protocols, loopback, private and carrier-NAT ranges,
link-local (including `169.254.169.254`), unique-local IPv6, internal hostname
suffixes, and embedded credentials. Loopback is permitted only when
`FORGE_ENV=development`, so the bundled demo can be verified locally.

**Page and repository content is data, never instruction.** Every prompt that
reads untrusted material states this explicitly, and the tool layer enforces it
regardless of what the model decides. A page containing "ignore previous
instructions" changes what Forge reports, not what Forge is permitted to do.

**Every read is ownership-scoped.** `assertProjectAccess`, `assertRunAccess`,
and `assertFindingAccess` are the only doors to the data. R2 objects are never
public; artifacts are served through an authenticated route that re-checks the
owning run.

**Runs are bounded.** Journeys, browser actions, model calls, reproduction
attempts, evidence size, and wall clock are all capped. Sessions are released in
a `finally`, including on cancellation, because a leaked browser session bills
for as long as it lives. Expensive operations accept an idempotency key so a
retried request cannot create a second paid session.

**Anonymous accounts are real accounts, in development only.** The anonymous
plugin creates an owned user row, so every authorization check behaves
identically for guests, and signing up later migrates their projects across
rather than stranding them. It is registered only when
`FORGE_ENV=development`, because a guest account can start real billable runs
and an open anonymous endpoint on a public deployment is an unauthenticated way
to spend money. The plugin is gated, not just the button: hiding a control
whose endpoint is still live is not a restriction.

**Three ways to sign in, one user.** GitHub sign-in needs an OAuth app whose
callback URL is `<APP_URL>/api/auth/callback/github`, and its client id and
secret in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Until both are set the
button is hidden in production and shown disabled, with that note, in
development. Email and password, GitHub, and guest all
produce the same user row. GitHub is offered only when both halves of its OAuth
credential are configured, because a button that dead-ends on a provider error
page is worse than no button. Account linking is enabled for GitHub alone: it
verifies email addresses, and trusting a provider that does not would let
someone claim an existing account by signing up elsewhere with its address.

**Deleting a project deletes its evidence.** A project's rows live in D1 and
its artifacts live in R2, and no transaction spans the two, so the row is marked
deleted first - which hides it from every query, every scheduled run, and every
webhook at once - and a queue then walks its runs, purges each one's R2 prefix,
and removes the row for real once nothing is left. Artifacts are addressed by
prefix rather than by the keys D1 holds, so an object whose metadata row was
lost is swept up rather than stranded. A cleanup that keeps failing ends on a
dead-letter queue with the project still marked deleted: invisible to its owner,
and still findable by an operator.

**Test with synthetic data.** The Operator fills forms with obviously synthetic
values and never real credentials. Point Forge at previews and staging, not at
production with customer data.

---

## Evaluation

The seeded demo application is a deterministic target: the same run should find
the same defects with the same reproduction counts every time. That is what
makes it possible to tell an agent regression from ordinary flakiness, and it is
where an evaluation harness belongs next.

Unit tests currently cover the parts that make decisions: the run state machine,
failure classification, severity and confidence scoring, journey ranking, budget
enforcement, target-URL safety, and model-output parsing.

---

## Roadmap

Shipped:

- Guest and email accounts, projects, runs, live progress
- Journey discovery, execution, failure classification, reproduction
- Evidence-backed findings, agent trace, artifact storage
- Verify fix
- Repository investigation in a Solari sandbox, connecting a runtime failure to
  the source that caused it
- Logins for gated applications: an encrypted test account, a deterministic
  sign-in before discovery, and auth-wall detection so an application Forge
  cannot get into is reported as such instead of as a pile of defects
- Project configuration that outlives a bad guess: journeys a project names for
  itself, sample values that are true of the target, one test account per role
- Dismissing a finding, cancelling a run, and deleting a project along with
  every artifact it produced
- GitHub App: a pull request's preview deployment is verified and the result
  posted as a check on the commit
- A CLI, `forge verify`, with an exit code CI can gate on
- Scheduled monitoring: the same engine on a timer, with notifications on the
  transitions rather than on every tick
- A REST API and personal access tokens, and a datapoint per run in Analytics
  Engine to say whether the agent is getting better or worse

Next, roughly in order:

- An evaluation harness over the seeded fixtures, with false-positive rate as a
  first-class metric
- Proposed patches, applied in a disposable sandbox and verified before a PR is
  ever opened

---

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — the three layers, and why the
  boundaries fall where they do
- [`docs/agent-design.md`](docs/agent-design.md) — four agents, two of which use
  no model at all
- [`docs/security-model.md`](docs/security-model.md) — the threats a system that
  points a browser at a stranger's URL actually has
- [`docs/releasing.md`](docs/releasing.md) — how a commit message becomes a
  versioned binary on a GitHub release
