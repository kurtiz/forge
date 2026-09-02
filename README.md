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
outbound WebSocket, so `src/server/execution/` speaks CDP directly. The whole
control plane stays on Workers with no extra hop.

**There is a working fallback.** Without a `SOLARI_API_KEY`, runs use an HTTP
executor built on `HTMLRewriter`: real requests, real status codes, real form
submissions, real cookies. It cannot run JavaScript, so it will miss
client-rendered failures. Which executor produced a finding is recorded on the
run and shown in the UI, because a finding is only as good as the fidelity
behind it.

**The Judge cannot overrule the measurement.** Reproduction rate, severity, and
classification are computed by deterministic rules in `src/server/domain/`. The
model writes the narrative and may propose a root cause; it cannot promote a
flaky failure to a confirmed bug. Every model response is schema-validated
before it reaches the database.

**The run engine lives in a Durable Object.** One instance per run owns the
execution loop, the event sequence, the cancellation flag, and the set of
clients watching live. HTTP requests never execute a run inline; they return a
run id and the client subscribes over SSE.

**Drizzle is the schema, not just the query builder.** `src/server/db/schema.ts`
defines every table once, and three things read it: drizzle-kit generates the
migrations from it, Better Auth's Drizzle adapter resolves its own tables
through it, and Forge's queries are typed by it. Renaming a column is a type
error rather than a runtime surprise. Enum-shaped text columns carry `$type<>()`
so the row types match the API contracts exactly, which is why the UI can
exhaustively switch on a run status or a severity.

**One Worker, real internal boundaries.** `services/*` in the design document
map to modules under `src/server/`, not to separate Workers. Splitting them out
would be microservice theatre at this size; the boundaries are enforced by
module structure and would survive being pulled apart when there is a reason to.

---

## Demo

The repository ships a deliberately broken application at `/demo` ("Northbeam"),
so the entire loop is demonstrable without depending on a third-party site.

Seeded defects:

1. Applying a coupon at checkout returns 500.
2. Inviting a teammate outside the org domain returns 500.
3. The Pricing link in the navigation points at a page that was renamed.

Checkout and invitations sit behind a login (`ines@northbeam.test` /
`northbeam-demo` at `/demo/login`). An unauthenticated request is answered with
the login form at **HTTP 200** — no redirect, no 401 — which is the auth wall a
verifier cannot see from status codes. Run the demo without credentials and
Forge reports `AUTH_FAILURE`; add the test account under **This app needs a
login** and the same run finds the real defects behind it.

The 60-second demo:

1. Sign in as a guest.
2. Create a project pointed at your own `/demo` URL, or press **Use the demo app**.
3. Watch the run: journeys discovered, executed, failures reproduced.
4. Open a finding. Read the steps, the network evidence, the reproduction count.
5. Set `FORGE_DEMO_FIXED="1"` in `.dev.vars` to repair the defects.
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

To run against a real browser, add a Solari key to `.dev.vars`:

```bash
SOLARI_API_KEY="sk_..."
```

Runs then get JavaScript execution, screenshots, console and network capture,
and a session replay link on the finding.

---

## Development

```bash
pnpm typecheck     # tsc --noEmit, for the Worker and the CLI
pnpm test          # unit tests
pnpm build         # client + worker bundles
pnpm build:cli     # the CLI, into cli/dist
pnpm check         # all three
```

The CLI is a separate package under `cli/`, compiled by its own tsconfig
against Node libraries rather than the Worker's. It talks to the REST API in
`src/server/rest/`, never to the server functions, so it keeps working against
a Forge that is a version or two ahead.

### Changing the schema

`src/server/db/schema.ts` is the single source of truth. Edit it, then:

```bash
pnpm db:generate           # drizzle-kit writes the migration
pnpm db:migrate            # apply to the local D1
pnpm db:migrate:remote     # apply to the deployed D1
```

Migrations land in `infrastructure/migrations`, which is the directory
`wrangler d1 migrations apply` reads, so there is one migration history rather
than two. There is deliberately no `drizzle-kit push` script: pushing would
leave the deployed database in a state no migration describes.

### Layout

```text
src/
  routes/                 TanStack Start file routes (pages, API, demo app)
  components/             UI: shell, status vocabulary, evidence, live stream
  server/
    contracts/            zod schemas shared across every boundary
    db/                   Drizzle schema and client (source of truth for D1)
    domain/               run state machine, classification, scoring, budgets
    security/             target-URL validation (SSRF), repository URL policy
    execution/            BrowserExecutor interface, Solari CDP, HTTP fallback
    agent/                Explorer, Operator, Judge, prompts, model router
    evidence/             R2 artifact store and metadata
    runs/                 repository, run service, engine, RunSessionDO
    github/               App auth, webhooks, checks, preview URLs
    monitoring/           schedules, cadence arithmetic, the cron tick
    tokens/               API token format, hashing, storage
    rest/                 the public REST API the CLI and CI talk to
    demo/                 the deliberately broken fixture application
    auth.ts               Better Auth (email/password, anonymous, API tokens)
    api.ts                typed server functions the UI calls
cli/                      @forge/cli, a separate zero-dependency package
infrastructure/migrations/
tests/unit/
```

### Cloudflare resources

Before deploying, create the resources and paste the ids into `wrangler.jsonc`:

```bash
wrangler d1 create forge
wrangler r2 bucket create forge-evidence

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

---

## Beyond the console

The verification loop is the same in all three of these. Only the trigger, and
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
https://forge.dev/runs/run_123
```

`forge verify` exits 1 when Forge confirms a defect and 0 otherwise, so it is a
CI gate as it stands. A flaky or environmental failure is printed but does not
fail the command, because blocking a merge on a rate limit teaches people to
skip the check.

Tokens are issued in the console under **Settings**, stored as a SHA-256 hash,
and shown exactly once. `FORGE_TOKEN` overrides the stored credential, which is
what CI should use. The CLI has no dependencies: it is Node's own fetch and
about six hundred lines, because a verification tool installed on every
developer machine and CI runner should not bring a package tree with it.

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
a Worker will fetch is an SSRF primitive. `src/server/security/target-url.ts`
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

- GitHub App: a pull request's preview deployment is verified and the result
  posted as a check on the commit
- A CLI, `forge verify`, with an exit code CI can gate on
- Scheduled monitoring: the same engine on a timer, with notifications on the
  transitions rather than on every tick

Next, roughly in order:

- An evaluation harness over the seeded fixtures, with false-positive rate as a
  first-class metric
- Proposed patches, applied in a disposable sandbox and verified before a PR is
  ever opened
