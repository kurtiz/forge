# Security model

## Threats this system actually has

Forge points a browser at a URL a stranger supplied, reads a repository a
stranger supplied, and feeds both into a model. That produces four real threats,
and each one is handled outside the model. Opening the product to a CLI and to
GitHub adds a fifth: two new ways to reach it that do not carry a session
cookie. Deploying it publicly adds a sixth, which is not about any one door but
about all of them: every entrance above is open to anyone who can reach the
origin, as often as they care to knock.

## 1. Server-side request forgery

A verification run navigates to user-supplied URLs. In the fetch executor those
requests originate from the Worker itself.

`apps/web/src/server/security/target-url.ts` runs before any run is created and again
before every navigation, including on links discovered inside the target page.
It rejects:

- protocols other than `http:` and `https:`
- `localhost`, `127.0.0.0/8`, `::1`
- private ranges: `10/8`, `172.16/12`, `192.168/16`
- carrier NAT: `100.64/10`
- link-local: `169.254/16`, including `169.254.169.254`, and `fe80::/10`
- unique-local IPv6: `fc00::/7`
- internal hostname suffixes: `.local`, `.internal`, `.localhost`, `.home.arpa`
- known metadata hostnames
- credentials embedded in the URL

Loopback is permitted only when `FORGE_ENV=development`, so the bundled demo can
be verified locally. That escape hatch is a single explicit branch, and the unit
tests assert that enabling it still does not open the private ranges.

Repository URLs are restricted to public GitHub repositories and normalised to a
canonical form.

## 2. Prompt injection

Page text, headings, link labels, console output, and repository files all reach
the model. Any of them can contain instructions.

Two defences, and only the second one is load-bearing:

**The prompt says so.** Every system prompt that reads untrusted material states
that page and repository content is observation data, that it cannot change the
goal or the output format, and that instructions found inside it are content
being tested rather than direction being given.

**The tool layer does not care what the model decided.** The model's only
outputs are a list of proposed journeys and a narrative verdict, both
schema-validated before use. It cannot choose a URL outside policy, cannot spend
more budget, cannot reach the database, and cannot change a classification that
was measured. A successfully injected page changes what Forge *reports*. It
cannot change what Forge *does*.

That distinction is the point. A prompt is not a security boundary; the code
around it is.

## 3. Multi-tenant data exposure

Every resource chains back to a user:

```text
user → project → run → journey → finding → evidence
```

`assertProjectAccess`, `assertRunAccess`, and `assertFindingAccess` in
`apps/web/src/server/runs/repository.ts` are the only way to load these objects. No
handler loads by id alone.

R2 objects are never public. Artifacts are served by
`/api/evidence/:evidenceId`, which resolves the artifact, re-checks the owning
run against the caller, and returns 404 for both "missing" and "not yours" so
the endpoint cannot be used to probe for valid ids.

The live event stream checks ownership before the Durable Object is contacted,
so the DO never needs to know users exist.

## 4. Unbounded cost

Browser sessions are billable and plan-limited, and model calls cost money.
Limits are architecture, not an optimisation:

| Resource | Default |
|---|---|
| Journeys per run | 6 |
| Model calls per run | 20 |
| Browser actions per run | 120 |
| Wall clock per run | 15 minutes |
| Reproduction attempts per finding | 3 |
| Evidence per run | 24 MB |
| Tokens per account | 20 |
| Schedules started per cron tick | 10 |
| Minimum monitoring cadence | 30 minutes |

`Budget` is checked before the work, not after. Sessions are released in a
`finally` covering success, failure, and cancellation. Expensive operations
accept an idempotency key so a retried request cannot create a second paid
session.

Every number here bounds one run. How many runs may be started is a separate
question, answered below.

## 5. Credentials that are not a browser session

Two non-cookie doors exist, and each has one thing standing behind it.

### API tokens

A token is `forge_` plus 40 characters from a 32-symbol alphabet: 200 bits of
entropy. Only its SHA-256 is stored, so a database read yields nothing usable,
and there is no per-token salt because the input space cannot be enumerated. The
console shows the token exactly once, at creation.

`currentUser` accepts a bearer token wherever it accepts a cookie, and resolves
both to the same `SessionUser`, so every ownership check downstream is
identical. A malformed bearer token is a definite rejection rather than a
fall-through to cookie authentication: a bad token must not be silently ignored
in favour of an ambient session.

Guests cannot hold tokens. An anonymous account is deleted along with anything
depending on it, which would turn a token into a trap.

The REST API returns 404 for both "not found" and "not yours", the same way the
evidence route does, so a token cannot be used to probe for valid ids.

### GitHub webhooks

The webhook endpoint is public and unauthenticated, so its HMAC is the entire
boundary. `X-Hub-Signature-256` is verified against the raw body, before the
body is parsed, with a constant-time comparison. A missing secret fails closed.

Three further rules bound what a valid delivery can cause:

**An unclaimed installation does nothing.** A webhook names a GitHub account,
never a Forge one. The link is made by a signed-in user completing the setup
redirect, so a delivery for an installation nobody has claimed is a no-op rather
than a run on a guessed account.

**Preview URLs are targets, not trusted input.** `environment_url` comes from a
public endpoint and is user-controlled, so it goes through the same
`assertSafeTargetUrl` policy as anything typed into the console. So does a
monitoring notification webhook, for the same reason: the Worker is the one
making the request.

**One commit, one run.** Every run started from GitHub carries an idempotency
key derived from the commit, so the several events describing one deployment
cannot multiply into several billable sessions.

## 6. Doors that are open to everyone

Everything above assumes a caller doing one thing at a time. A public deployment
does not get to assume that. The sign-in form checks as many passwords as it is
asked to. The REST API reads the database to resolve a token before it knows
whether the caller is anybody. A run costs a Solari session and a handful of
model calls, charged to whoever started it.

Three limits, one per door. They live in
[`src/server/security/rate-limit.ts`](../apps/web/src/server/security/rate-limit.ts),
and the bindings that count them are declared in `wrangler.jsonc`.

| Door | Counted by | Limit |
|---|---|---|
| `/api/auth/sign-in`, `/api/auth/sign-up` | address | 20 a minute |
| `/api/v1/*`, before the token is resolved | address | 300 a minute |
| Starting a run | account | 10 a minute |

The keys differ because the threats differ. A password guess is bounded by where
it comes from, and the email in it is the attacker's to choose, so the address is
the key. Spending money is bounded by who pays, so the account is.

Two things are deliberately not limited. Session reads are not: the console makes
them on nearly every navigation, and they tell an attacker nothing they did not
already know. Scheduled and pull request runs are not: their rate is already
bounded by the cadence a project chose and by how often someone pushes a branch,
and refusing one would read as Forge missing a deployment rather than as a limit
doing its job.

Counting is Cloudflare's rate limiting binding, which counts per colo rather than
globally, so the real ceiling is somewhat higher than the number configured. That
is the right trade for limits meant to stop abuse rather than to meter a quota: an
approximate answer that costs nothing beats an exact one that needs a round trip
to storage on every request.

A limiter that is absent or failing allows the request, and logs that it did. A
limiter is a guard, not a gate: refusing everything because the service behind
the count is unreachable would turn a rate limiting outage into a Forge outage,
which is the worse of the two failures.

The refusal is a 429 carrying `Retry-After`, which is worth more than its
message: it is what turns a retry loop in someone's CI script into a wait rather
than into more of the traffic that caused the limit. What it does not carry is
which limit was hit or how much of it is left, because that turns the limiter
into an oracle for how hard it can be pushed.

## What leaves Cloudflare

Two external systems see run data, and it is worth saying plainly which.

**Solari sees the target application and the repository.** The browser renders
the target inside a Solari session, so every page a journey reaches — including
whatever a signed-in test account can reach — is rendered on their
infrastructure. The investigator clones the repository into a Solari microVM at
`/workspace/repo`. Source code is sent to a third party. That is the cost of
having a filesystem at all from a Worker, and it is a deliberate trade rather
than an implementation detail.

The restriction in section 1 is what bounds it: repository URLs are public
GitHub only, so what reaches the sandbox is already public. A private repository
cannot be attached. That is a smaller product and a much smaller disclosure.

Neither the clone nor the session outlives the run. The microVM is released in
the engine's `finally` and expires on its own after ten minutes regardless. Only
the results come back — matched paths, line excerpts, and the commit SHA — and
only those are written to D1.

**The model provider sees observations.** Condensed page text, headings, element
names, console and network errors, and matched source excerpts go into prompts.
Whole files do not: the investigator returns matches, not contents.

A stored test-account password is the one secret that reaches the target
application, and it gets there by being typed into a login form inside the
Solari session, like any other keystroke in the run. It is never shown to the
model, never written to an event, trace, or artifact, and never returned by the
API. The same holds for verification header values. See below for the four rules
that keep it that way.

## Credentials

The Solari API key exists only on the server and is never sent to the browser.
Model provider keys likewise. The client talks to Forge; Forge talks to
everything else.

Logs carry ids and metadata. Never API keys, passwords, tokens, session
credentials, or repository contents.

### Target-application logins

A project may carry test accounts for an application behind a login, one per
role, in `project_credentials`. Those passwords are the only user-supplied
secrets Forge stores, and they are handled on four rules:

**Encrypted at rest.** AES-GCM with a fresh IV per write, under a key derived
from the `FORGE_CREDENTIAL_KEY` Worker secret (`security/credentials.ts`).
Encryption happens at the API boundary; decryption happens only inside the run
Durable Object, immediately before the value is typed. Without the key
configured, a project simply cannot store a login — a better failure than
encrypting under a predictable key.

**Never returned.** Neither `Project` nor `ProjectCredential` has a field for
the ciphertext - a project reports only how many accounts it holds - so a
password cannot reach a response by being forgotten in a mapper. Reading one
requires calling `readProjectCredentials` by
name.

**Never shown to the model.** Login fields are selected structurally, by input
type, in `agent/authenticator.ts` — there is no prompt in that path. A page
whose label says "type your password here" cannot induce a fill, because no
model is deciding. This is the same principle as the untrusted-content policy: a
prompt is not a security boundary.

**Never recorded.** The authenticator writes no credential into a step, trace,
or event. As a backstop for values the application itself echoes back,
`redactSecrets` is applied to every event and every artifact for the life of the
run. No screenshot is taken during sign-in, since redaction cannot reach pixels.

Single sign-on, magic links, and second factors are not supported. Use a
dedicated test account, never production credentials.

### Verification headers

A project may also carry headers Forge attaches to its requests, in
`project_headers` — the mechanism for letting a run past an edge that challenges
automated traffic, and the one thing that makes a `BOT_CHALLENGE` finding
actionable without weakening the edge for everyone else. Values are secrets and
take the same four rules as a stored password: encrypted under
`FORGE_CREDENTIAL_KEY`, decrypted only inside the run Durable Object, never
returned by the API (`ProjectHeader` has no value field, and the run engine
reads one only through `readProjectHeaders`), and registered with
`redactSecrets` before the first request so an application that echoes one back
cannot leak it into an event or an artifact.

Two rules are specific to headers and are enforced in `security/headers.ts`:

**Sent to one origin only.** A target page is attacker-controlled and journeys
follow the links they find. A header is attached only to requests whose origin
matches the project's target — scheme, host and port — so a link to another host
carries nothing. In the browser executor this is why the Fetch domain is used to
pause and modify individual requests rather than
`Network.setExtraHTTPHeaders`, which would attach the secret to every font,
beacon and third-party subresource the page loads.

**Nothing that disguises the client.** `User-Agent` is refused by name, along
with the headers the transport and the session own (`Host`, `Cookie`,
`Content-Length`, the hop-by-hop set, and the `Sec-`/`Proxy-` prefixes). Values
carrying CR, LF, or control characters are refused: that is request splitting.
Forge identifies itself honestly and does not try to pass for a human browser.
See [`bot-protection.md`](bot-protection.md) for the whole mechanism, including
where the matching rule goes for each service.

## Testing against real applications

The Operator fills forms with obviously synthetic values and never real
credentials — the one exception is the sign-in step above, which types a
configured test account and nothing else. Forge is built for previews and
staging environments. Pointing it at production with customer data means an
autonomous agent submitting forms against live records, which is not what this
is for.
