# Security model

## Threats this system actually has

Forge points a browser at a URL a stranger supplied, executes a repository a
stranger supplied, and feeds both into a model. That produces four real threats,
and each one is handled outside the model.

## 1. Server-side request forgery

A verification run navigates to user-supplied URLs. In the fetch executor those
requests originate from the Worker itself.

`src/server/security/target-url.ts` runs before any run is created and again
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
`src/server/runs/repository.ts` are the only way to load these objects. No
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

`Budget` is checked before the work, not after. Sessions are released in a
`finally` covering success, failure, and cancellation. Expensive operations
accept an idempotency key so a retried request cannot create a second paid
session.

## Credentials

The Solari API key exists only on the server and is never sent to the browser.
Model provider keys likewise. The client talks to Forge; Forge talks to
everything else.

Logs carry ids and metadata. Never API keys, passwords, tokens, session
credentials, or repository contents.

### Target-application logins

A project may carry a test account for an application behind a login. That
password is the only user-supplied secret Forge stores, and it is handled on
four rules:

**Encrypted at rest.** AES-GCM with a fresh IV per write, under a key derived
from the `FORGE_CREDENTIAL_KEY` Worker secret (`security/credentials.ts`).
Encryption happens at the API boundary; decryption happens only inside the run
Durable Object, immediately before the value is typed. Without the key
configured, a project simply cannot store a login — a better failure than
encrypting under a predictable key.

**Never returned.** `Project` has no field for the ciphertext, only a
`hasCredentials` boolean, so the password cannot reach a response by being
forgotten in a mapper. Reading it requires calling `readProjectCredentials` by
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

## Testing against real applications

The Operator fills forms with obviously synthetic values and never real
credentials — the one exception is the sign-in step above, which types a
configured test account and nothing else. Forge is built for previews and
staging environments. Pointing it at production with customer data means an
autonomous agent submitting forms against live records, which is not what this
is for.
