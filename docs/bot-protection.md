# Bot protection

## The problem

A verification run against a target behind Cloudflare, DataDome, or anything of
that family does not fail. It succeeds at everything.

The interstitial answers **HTTP 200**. It has a title, headings, and links. So
the run explores it, discovers journeys from it — "Verify Security", "View
Privacy Policy" are the two the Cloudflare screen offers — tries to drive them,
finds no control because the widget lives in a cross-origin frame the page model
cannot see into, and reports an application with nothing on it. Sign-in reports
"no password field at `/login`", which sends the reader to look at an
authentication setup that was never the problem: the login form is intact, and
behind the challenge.

Every sentence in that report is about the interstitial, and none of it says the
only true thing: Forge never saw the application.

## What Forge does about it

**Detection.** `server/domain/challenge.ts` identifies an interstitial from the
page observation and names the service: Cloudflare, hCaptcha, reCAPTCHA,
DataDome, Imperva, Akamai, AWS WAF, or "a bot-protection service" when nobody
signs it. Two ways in: a phrase only a challenge screen carries, or a bare
403/503 whose body names the vendor.

It is deliberately conservative, because the expensive mistake is the other one:
calling a real page a challenge hides genuine defects behind an environment
excuse. A page counts as a wall only when it says something an interstitial says
**and** offers nothing an application offers — so a login form carrying a
Turnstile widget stays a login form, and a page whose nav bar has five links
stays a page.

**Stopping.** The engine checks the entry page before it checks the status code,
and ends the run there with one `BOT_CHALLENGE` finding naming the service. No
journeys are discovered from the challenge screen. The finding is classified
`environment`, so it reports without failing a pull-request check — the
application was never shown to be broken, and blocking a merge on a WAF rule
teaches people to ignore the check. Severity stays `high`, because the run
verified nothing at all.

The authenticator and the operator recognise it too, so a challenge met at
`/login` or mid-journey is named rather than reported as a missing password
field or a missing control.

**Not solving it.** Forge does not attempt to solve or evade a challenge — no
solvers, no stealth flags, no user-agent spoofing (`User-Agent` is refused by
name in the header policy). The generated fix instructions forbid the agent
reading them from trying either. A verification tool that taught itself to
defeat bot protection would be a tool nobody could safely point at their own
production site.

## The two ways through

### 1. Verify an origin that does not challenge

The cheapest fix, and the one to prefer: point the project at a preview or
staging hostname with no bot protection. No rule to write, nothing relaxed,
production untouched. Both the console and the generated prompt tell the reader
to weigh this first.

### 2. Open a door only Forge can walk through

A project can carry **verification headers**: name/value pairs that runs attach
to every request they make to that target. Store a secret there, then write one
rule at your edge that lets requests carrying it past the challenge. Everyone
else still meets the challenge.

Set them on the project page, under **Request headers**. Values are encrypted
at rest (AES-GCM under `FORGE_CREDENTIAL_KEY`), decrypted only inside the run's
Durable Object, never returned by the API, and registered for redaction before
the first request. Adding a name that already exists replaces its value, which
is how a secret gets rotated.

Two properties matter, and both are enforced in `server/security/headers.ts`:

- **One origin only.** A header is attached only to requests whose origin
  matches the project's target — scheme, host, and port. A target page is
  attacker-controlled and journeys follow the links they find; without this, one
  link to another host would hand a stranger the key to your edge. The browser
  executor intercepts requests individually (CDP `Fetch`, scoped to the target
  origin) rather than using `Network.setExtraHTTPHeaders`, which would attach
  the secret to every font, beacon, and third-party subresource the page loads.
  The HTTP executor follows redirects by hand for the same reason: `redirect:
  follow` re-sends headers to wherever a `Location` points, and an OAuth
  redirect would have handed the secret to an identity provider.
- **Nothing that disguises the client.** `User-Agent` is refused, as are the
  headers the transport and the session own (`Host`, `Cookie`,
  `Content-Length`, the hop-by-hop set, and the `Sec-`/`Proxy-` prefixes).
  Values carrying CR, LF, or control characters are refused — that is request
  splitting.

## Where the rule goes, by service

The rule is the same shape everywhere: **evaluated before whatever issues the
challenge, matching a header name and its exact value, on that hostname only,
skipping or allowing that challenge and nothing else.** Menu labels move around;
that shape does not.

Prefer a change you keep in version control. Where a service only offers a
dashboard, record the click path in your own runbook — the finding's generated
prompt asks the agent to produce exactly that.

### Cloudflare

Dashboard → your zone → **Security → WAF → Custom rules**. Expression, with the
header name lowercased:

```
(http.host eq "app.example.com"
 and http.request.headers["x-forge-verify"][0] eq "<the stored secret>")
```

Action **Skip**, ticking the components that issue the challenge (Super Bot
Fight Mode, managed rules), ordered above whatever is challenging.

Check which product is challenging before writing the rule: plain **Bot Fight
Mode** cannot be exempted by a custom rule. If that is what is in the way, turn
it off for the hostname or verify a different origin instead.

Cloudflare Access is a different mechanism with the same shape: create a service
token and store its two headers, `CF-Access-Client-Id` and
`CF-Access-Client-Secret`, as verification headers. That is why the panel takes
a list of pairs rather than a single token.

### AWS WAF (also in front of CloudFront or ALB)

Console → **WAF & Shield → Web ACLs** → your ACL → **Rules**. Add a custom rule
whose statement matches a single header (`x-forge-verify`) against the exact
value, action **Allow**, at a **lower priority number** than the bot-control or
challenge rule so it is evaluated first. Scope it with an AND on the `Host`
header if the ACL covers more than one hostname.

### Vercel

Vercel has this built in, and it is the neatest case: **Project → Settings →
Deployment Protection → Protection Bypass for Automation** issues a secret.
Store it as a verification header named `x-vercel-protection-bypass`. Nothing
else to configure — no rule, no expression.

Vercel's own firewall rules (Project → Firewall) take a custom rule matching a
header if you also need one there.

### Netlify

Netlify's protection is site-wide rather than rule-based. Either use a branch
deploy that is not password-protected, or, on plans with edge firewall rules,
add a rule matching the header. If neither is available, option 1 — verify a
preview origin — is the answer.

### Fastly

A VCL snippet or a Compute service that skips the bot-detection logic when
`req.http.x-forge-verify` equals the stored secret, placed before the check.
Keep it in the service configuration you deploy, not a one-off.

### Akamai

Control Center → **Security** → your security configuration → **Bot Manager**:
an exception, or a bypass match target, for requests carrying the header.

### Imperva

Cloud WAF console → your site → **Security → Bot Access Control**: an allow rule
for requests carrying the header, above the challenge policy.

### DataDome

Dashboard → **Management → Custom rules**: an allow rule matching the header, so
those requests are never scored.

### reCAPTCHA and hCaptcha

These are not an edge. Your own code renders the widget, so there is no rule to
write and no infrastructure owner to send the reader to — Forge classifies the
remediation as owned by **application code** in this case. Gate the widget on
the verification header in preview environments only, never in production, and
never remove it.

## Verifying the fix

Two requests. The point is that the second one still fails:

```bash
# With the header: your own HTML.
curl -sI https://app.example.com/ -H 'x-forge-verify: <secret>' | head -1

# Without it: still challenged.
curl -sI https://app.example.com/ | head -1
```

Then re-run the verification. A run that got through discovers journeys from
your own pages instead of from the challenge screen — that is the tell.

If it is still blocked, in order of likelihood: the rule is evaluated after the
one that challenges; it matches the header name but not the value (or vice
versa); the header name in the expression is not lowercased where the vendor
requires it; the challenge is coming from a product that rule cannot skip; or
the value on the project and the value in the rule have drifted.

## Rotation and blast radius

The value is a credential for your edge. Treat it like one:

- Rotate by pasting a new value over the old one in **Request headers**, then
  updating the rule. Runs pick up the new value immediately.
- Keep the rule scoped to the hostname under verification, and keep that
  hostname off production data where you can.
- If the secret leaks, whoever holds it can skip that challenge on that
  hostname — nothing more, if the rule is scoped as above. Rotate and move on.
- Never key the rule on something a stranger can also send. A user agent, a
  path, or an IP range you do not control is not a secret.

## Where the instructions appear

Every finding carries how to fix it — the owner, the steps, and a brief written
for a coding agent, derived by deterministic rules in
`server/domain/remediation.ts` rather than written by a model, so it says the
same thing every time. For a `BOT_CHALLENGE` it adapts to how far you have got:
with no header configured it asks for the secret first; with one configured it
names it and asks for the rule.

| Surface | What it shows |
|---|---|
| Finding page | **How to fix this**: owner, steps, and the full prompt with a copy button |
| GitHub check | The same, collapsed into the check summary for the finding that decided it |
| CLI | The steps, and a link to the prompt. `forge verify --fix` prints the prompt itself, verbatim |
| `--json` / REST | A `remediation` object on the run report: `jq -r .remediation.prompt` |
| Monitoring webhook | One **How to fix** line and the finding link in `text`; the steps and prompt in `remediation` |

A blocked run also stops claiming the application was reachable: the CLI's first
line reads "Blocked before the application was reached", and the run summary
says nothing in the application was verified.

## Related

- [`security-model.md`](security-model.md) — how header values are stored, and
  the two rules the header policy enforces
- [`architecture.md`](architecture.md) — where `domain`, `security`, and
  `execution` sit relative to each other
