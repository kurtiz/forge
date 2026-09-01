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
Worker as modules under `src/server/`.

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
| `server/security` | Target-URL and repository-URL policy | nothing runtime-bound |
| `server/execution` | `BrowserExecutor` and its providers | security |
| `server/agent` | Explorer, Operator, Judge, model router | contracts, domain, execution |
| `server/evidence` | R2 artifacts and their metadata | contracts |
| `server/runs` | Repository, run service, engine, Durable Object | everything above |
| `server/api` | Typed server functions | runs, auth |

Dependencies point one way. `contracts`, `domain`, and `security` import nothing
from Cloudflare at all, which is exactly why they are the parts under unit test.

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
scripts (`src/server/execution/page-script.ts`) that tag elements with
`data-forge-ref` and dispatch the events frameworks listen for. Console errors,
uncaught exceptions, failed loads, and document status are collected from CDP
events as they arrive.

### Fetch

`FetchBrowserExecutor` issues real HTTP requests and parses responses with
`HTMLRewriter`, keeping a cookie jar across the run. It follows links, fills
forms, and submits them. It cannot run JavaScript, and it says so rather than
pretending: activating a scripted control returns `ok: false` with an
explanation instead of a fabricated result.

## Data

D1 holds relational state. R2 holds artifacts. D1 stores only R2 keys and
metadata.

`src/server/db/schema.ts` is the single definition of the relational shape.
Migrations are generated from it by drizzle-kit into
`infrastructure/migrations`, the same directory wrangler applies, so schema and
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

## What the agent never owns

Database transactions, authentication, authorization, secrets, billing, resource
cleanup, and infrastructure configuration are all outside the model's reach.
The model's entire surface is: propose journeys, propose a narrative and a root
cause. Everything else is application code.
