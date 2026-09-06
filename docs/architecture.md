# Architecture

## The shape of the system

Forge connects three things it does not own with one thing it does.

```text
                    FORGE
                      │
       ┌──────────────┼──────────────┐
       │              │              │
 Intelligence     Execution     Control plane
       │              │              │
       ▼              ▼              ▼
   AI models        Solari       Cloudflare
```

Solari is the execution environment. Cloudflare is the control plane. The model
is the reasoning layer. Forge is the product that makes them into a verification
loop, and it owns the loop, the evidence, and the policy.

## Why one Worker

The design document sketches six services. This implementation puts them in one
Worker as modules under `apps/web/src/server/`.

Splitting a system into Workers buys independent deployment, resource isolation,
an ownership boundary, or a security boundary. At this size none of those apply
yet, and the cost is real: service bindings, extra serialisation, distributed
failure modes, and six deploy targets to keep in step.

What matters is that the boundaries exist and are honest, so they can be pulled
apart the day one of those reasons shows up:

| Module | Owns | Depends on |
|---|---|---|
| `server/contracts` | Shared schemas and types | nothing |
| `server/db` | Drizzle schema and client | contracts |
| `server/domain` | State machine, classification, scoring, budgets | contracts |
| `server/security` | Target-URL and repository-URL policy, stored credentials, request headers, redaction, rate limits | nothing runtime-bound |
| `server/execution` | `BrowserExecutor` and its providers | security |
| `server/agent` | Explorer, Operator, Judge, model router | contracts, domain, execution |
| `server/evidence` | R2 artifacts and their metadata | contracts |
| `server/runs` | Repository, run service, engine, Durable Object | everything above |
| `server/tokens` | API token format, hashing, storage | db |
| `server/github` | App auth, webhooks, checks, preview URLs | runs, security |
| `server/monitoring` | Schedules, cadence arithmetic, the cron tick | runs |
| `server/cleanup` | Project deletion: soft delete, queue, dead letters | runs |
| `server/rest` | The public REST API | runs, auth, security |
| `server/api` | Typed server functions | runs, auth |

Dependencies point one way. `contracts`, `domain`, and `security` import nothing
from Cloudflare at all, which is exactly why they are the parts under unit test.

## Four ways in, one loop

A run is started by the console, the CLI, a pull request, or a timer. All four
converge on `startRun` and diverge again only at the end, when the result is
delivered somewhere.

```text
console          CLI / CI            GitHub App           cron trigger
(server fn)    (REST + token)     (signed webhook)      (due schedules)
     │                │                   │                    │
     └────────────────┴─────────┬─────────┴────────────────────┘
                                ▼
                          runs/service.startRun
                     validate target · check ownership
                      write the run · call the DO
                                │
                                ▼
                          the engine, unchanged
                                │
                                ▼
                       runs/outcome.publishRunOutcome
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              GitHub check          schedule tick
                                    + notification
```

Two things make this hold together rather than fanning into four half-systems.

**Every entry point resolves to a `SessionUser` before it reaches `startRun`.**
The console has a session cookie, the CLI has a bearer token, and both come out
of `currentUser` as the same object, so `assertProjectAccess` is the single
authorization path for all of them. A webhook has no user at all, which is why
an installation is inert until somebody claims it in the console: that link is
the only thing that can name the account a delivery acts on.

**Publishing happens outside the engine.** `publishRunOutcome` runs in the
Durable Object's `finally`, so a check gets a conclusion and a monitor records
its tick whether the run completed, failed, or was canceled. It never throws:
the evidence is already durable, and a failed delivery must not corrupt a run
that succeeded.

## The run

```text
POST (server function)
  │
  ├─ validate target, check ownership, write the run row
  ├─ return the run id
  ▼
RunSessionDO(runId).fetch('/start')
  │
  └─ ctx.waitUntil(engine)
        │
        ├─ starting        create executor, record session id
        ├─ discovering     navigate, observe, Explorer proposes journeys,
        │                  domain re-ranks them, persist
        ├─ testing         Operator executes each journey, capture evidence
        ├─ investigating   classify, reproduce, Judge writes the finding
        ├─ reporting       replay URL, summary, fix-attempt outcome
        └─ completed
```

The engine never runs inside the HTTP request that started it. The client gets a
run id immediately and subscribes to `/api/runs/:id/stream`, which proxies SSE
from the Durable Object after checking ownership. The persisted timeline arrives
with the page; only new events come down the stream.

The Durable Object is the right primitive because everything it holds is
per-run state that has to be consistent across every viewer: the event
sequence, the cancellation flag, and the connected clients.

## The agent loop

The model is not consulted after every click. It is consulted at the two points
where judgement is actually required:

```text
observe page
     │
     ▼
Explorer: which journeys matter here?      ← one model call
     │
     ▼
domain.rankJourneys                        ← deterministic re-ranking
     │
     ▼
for each journey:
     Operator executes a safe mechanical sequence   ← no model calls
     │
     ▼
domain.classifyFailure                     ← deterministic
     │
     ▼
reproduce N times                          ← measurement, not opinion
     │
     ▼
Judge: does the evidence support this?     ← one model call per finding
     │
     ▼
domain re-imposes classification, severity, confidence
```

This keeps latency, cost, and the number of ways a run can go wrong down, and it
means a finding always has a defensible non-model baseline. If the model is
unreachable, the run still produces useful output; it just gets heuristic
journeys and rule-written narratives, and the UI says which.

## Reading a page at the right moment

Every action is followed by a wait for the page to go quiet: no request has
started or finished for half a second and nothing is in flight, bounded by a
hard ceiling of eight seconds. It replaced a flat pause, which was wrong in a
way worth remembering.

A sign-in posts credentials, waits for a response, and then redirects. A fixed
pause that ends before the redirect reads the login form that is still on
screen, so the executor reported a successful sign-in as a rejected one, and
every journey after it ran signed out. No amount of tuning the number fixes
that; the wait has to end on an observation rather than a guess.

The same reasoning applies to how a sign-in is judged. Displacement comes
first: an application that answers a sign-in by sending the browser somewhere
else has accepted the credentials, whatever the new page contains. Only when
the browser is still standing on the login path does a password field mean
rejection. Testing the field alone calls a successful sign-in a failure on any
application that keeps serving its login form to signed-in visitors.

## Where a journey starts

Discovery reasons about the elements of one page, so a journey belongs on that
page unless it names somewhere that page links to. `anchorJourneys` enforces
that: a proposed entry path that is neither the current path nor a link on the
page is replaced by the current path.

Without it, a model exploring a tenant-scoped application proposes `/dashboard`
for a dashboard that lives at `/acme/dashboard`. The guess either 404s, which
Forge would go on to blame the application for, or answers 200 with an
unrelated page where no control matches and the journey is skipped. Both waste
the run.

The guard behind that guard is in classification: a 404 on a path Forge
invented is an `AGENT_ERROR`, not an application defect. A 404 on a path the
application itself linked stays a defect, because a broken link is one.

## Executors

`BrowserExecutor` is Forge's interface. Providers implement it.

```ts
interface BrowserExecutor {
  readonly kind: 'solari' | 'fetch'
  readonly sessionId: string | null
  navigate(url: string): Promise<ActionResult>
  readPage(): Promise<PageObservation>
  click(ref: string): Promise<ActionResult>
  fill(ref: string, value: string): Promise<ActionResult>
  submit(ref: string): Promise<ActionResult>
  screenshot(): Promise<Screenshot | null>
  replayUrl(): Promise<string | null>
  close(): Promise<void>
}
```

Both providers return the same `PageObservation`: URL, title, status, headings,
a bounded list of interactive elements with accessible names, condensed page
text, console errors, network errors. The agent sees one page model regardless
of what is underneath.

Elements are addressed by an opaque `ref` that the executor resolves back to a
real element, and they are chosen by role and accessible name. Nothing in Forge
clicks a coordinate.

### Solari

`SolariBrowserExecutor` creates a recorded session over Solari's REST API, then
attaches to it over CDP through an outbound WebSocket. Actions run as page-realm
scripts (`apps/web/src/server/execution/page-script.ts`) that tag elements with
`data-forge-ref` and dispatch the events frameworks listen for. Console errors,
uncaught exceptions, failed loads, and document status are collected from CDP
events as they arrive.

### Fetch

`FetchBrowserExecutor` issues real HTTP requests and parses responses with
`HTMLRewriter`, keeping a cookie jar across the run. It follows links, fills
forms, and submits them. It cannot run JavaScript, and it says so rather than
pretending: activating a scripted control returns `ok: false` with an
explanation instead of a fabricated result.

## Investigation

`SourceInvestigator` is the sibling interface. The browser says what the
application did; this says which source could explain it.

```ts
interface SourceInvestigator {
  readonly kind: 'solari-sandbox'
  readonly sandboxId: string | null
  readonly elapsedSeconds: number
  investigate(request: InvestigationRequest): Promise<SourceInsight>
  close(): Promise<void>
}
```

There is deliberately no `write`, `exec`, or `command` on it. Investigation is
read-only, so the type refuses mutation rather than a prompt discouraging it.

A Worker has no filesystem and cannot run `git`, so the repository is never
cloned on Forge's side. `SolariSandboxInvestigator` rents a disposable microVM
over Solari's REST gateway — `POST /sandboxes`, `POST /sandboxes/:id/exec`,
`DELETE /sandboxes/:id` — and clones into `/workspace/repo` there. Unlike the
browser, this needs no SDK and no WebSocket: every step is one request and one
response, which is what lets it run on Workers as-is.

Five commands run against the clone, and that is the whole vocabulary:

| Command | For |
|---|---|
| `git clone --depth 1 --single-branch` | the working tree, without the history |
| `git ls-files` | tracked source only, so `node_modules` never enters the picture |
| `cat package.json` | framework and package manager detection |
| `grep -rnIF` | the search terms, fixed-string and binary-skipping |
| `git rev-parse HEAD` | the commit the evidence was read at |

No install, no build, no test run. A malicious repository has nothing to execute.

Each is sent as a command plus an argument array, never a shell string. The
search terms are built from page content and console output, which the target
application controls; passing those through a shell would make them a command
injection.

Investigation is lazy and per-failure. It starts only once a journey has failed,
and only if the project carries a repository URL and the sandbox budget has
seconds left. The sandbox is created on the first failure that needs one and
reused for the rest of the run; the clone is done once and reused too, keyed on
the URL.

It never fails a run. A sandbox that will not start, a repository that will not
clone, and a budget that is spent all degrade the finding to runtime-only and
emit `investigation.skipped` or `investigation.failed`. A finding stands on its
runtime evidence; source is the layer on top of one that already holds.

Unlike the executors, there is no degraded fallback. Without a `SOLARI_API_KEY`
the browser drops to `FetchBrowserExecutor`, but `createInvestigator` returns
`null` and the run reports investigation as skipped. Reading a repository
without cloning it would mean a different provider and a different fidelity
story, and claiming source links from a weaker method is worse than saying it
did not run.

Release is unconditional, in the engine's `finally`, because a leaked microVM
bills for as long as it lives. The sandbox carries a ten-minute timeout of its
own as well, so a Worker that dies without cleaning up cannot leave one running.

## Data

D1 holds relational state. R2 holds artifacts. D1 stores only R2 keys and
metadata.

`apps/web/src/server/db/schema.ts` is the single definition of the relational shape.
Migrations are generated from it by drizzle-kit into
`apps/web/infrastructure/migrations`, the same directory wrangler applies, so schema and
migrations cannot drift. Better Auth reads the same schema through its Drizzle
adapter rather than owning a parallel one.

Two timestamp conventions coexist on purpose. Better Auth's tables store Unix
timestamps because its adapter hands Drizzle real `Date` objects and D1 cannot
bind those. Forge's own tables store ISO 8601 strings, which is what the API
contracts and the UI both want, and which this codebase writes directly.

```text
runs/{runId}/
  screenshots/
  page/
  console/
  network/
  action/
```

Artifacts carry an expiry (14 days by default) because recordings are heavy and
rarely read after a week.

## Triggers and delivery

```text
trigger          started by                     delivered to
---------------------------------------------------------------------
manual           the console                    the console
verify_fix       a finding's Verify fix         the finding
cli              POST /api/v1/runs              the terminal's exit code
pull_request     a signed GitHub webhook        a check on the commit
scheduled        the cron tick                  a webhook notification
```

The trigger is stored on the run, so the history of a project reads as what it
is: nightly monitors, pull request checks, and hand-started runs in one list,
each labelled.

### Scheduling

One cron trigger fires every fifteen minutes. It decides nothing about cadence:
`listDueSchedules` returns the rows whose `nextRunAt` has passed, and each row
carries its own interval, so cadences from 30 minutes to daily share one
trigger and one code path.

A schedule's pointer is advanced *before* the run is started, not after. If
starting throws, the pointer has already moved, so one broken project cannot
pin the queue and starve every other monitor. The tick is bounded to ten
schedules for the same reason a run is bounded: Solari sessions are billable
and plan-limited, and a backlog should drain over several ticks rather than
arrive at once.

Notifications fire on transitions, not on states. First failure, recovery, and
every fourth consecutive failure after that. A monitor that alerts every 30
minutes for a week gets muted, and a muted monitor is worth nothing.

## Deleting a project

D1 holds the rows and R2 holds the artifacts, and nothing spans both. The order
is chosen so no failure leaves something half-visible:

```text
mark deleted        the project vanishes from every query at once
      ↓
queue the cleanup   the request returns; nothing waits on storage
      ↓
purge R2 prefixes   a few runs per message, so one large project
delete run rows     cannot exhaust a consumer's time budget
      ↓
delete the project  only once nothing of it remains
```

Artifacts are found by R2 prefix rather than by the storage keys D1 holds. The
prefix is authoritative: an object whose metadata row was lost is still under
`runs/<id>/`, and it is exactly the object a key-driven cleanup would strand.

A message that keeps failing ends on the dead-letter queue, whose consumer
records it and acknowledges it. Retrying there would re-enter the loop that
already failed; what is needed is a visible record. The project row survives,
still marked deleted, which is what keeps the leftover objects findable.

## What the agent never owns

Database transactions, authentication, authorization, secrets, billing, resource
cleanup, and infrastructure configuration are all outside the model's reach.
The model's entire surface is: propose journeys, propose a narrative and a root
cause. Everything else is application code.
