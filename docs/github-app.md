# The GitHub App

Pull request verification is one GitHub App. Forge signs a JWT with the app's
private key, mints a short-lived installation token with it, and uses that token
to post a check run on the head commit. It never stores a long-lived GitHub
credential.

Everything here is optional. Without the three secrets the webhook endpoint
refuses every delivery, the console hides the GitHub section entirely rather
than telling visitors which secrets are missing, and a project's **Pull
requests** panel does not appear. In development the section stays visible and
names what is unset, because a feature that silently does not exist is the
hardest kind to configure.

This document assumes the deployment used below. Substitute your own origin
throughout.

| | |
|---|---|
| Production | `https://forge.papiliocurtis.workers.dev` |
| Development | `http://localhost:3000` |

---

## 1. Create the app

<https://github.com/settings/apps/new> — or, for an organisation,
`https://github.com/organizations/<org>/settings/apps/new`.

Fill it in exactly like this. Anything not listed keeps its default.

### Identity

| Field | Value |
|---|---|
| **GitHub App name** | `Forge Verification` |
| **Description** | Forge verifies each pull request's preview deployment in a real browser and posts the result as a check on the commit. A confirmed defect fails the check; a flaky or environmental failure is reported without blocking the pull request. |
| **Homepage URL** | `https://forge.papiliocurtis.workers.dev` |

The name is global across GitHub, so it may be taken. Whatever you settle on,
GitHub derives the URL slug from it — `Forge Verification` becomes
`forge-verification` — and that slug is `GITHUB_APP_SLUG`. Read it off the app's
URL after creating it rather than guessing.

### Identifying and authorizing users

These fields are the OAuth half of the app, and they matter only if you reuse
this app for **Continue with GitHub** on the sign-in page. That is the usual
choice: one app, two credentials. If you would rather keep a separate OAuth app
for sign-in, leave the redirect URI blank and skip to the next section.

| Field | Value |
|---|---|
| **Redirect URI** | `https://forge.papiliocurtis.workers.dev/api/auth/callback/github` |
| **Allow wildcard matching** | off |
| **Expire user authorization tokens** | **off** |
| **Request user authorization (OAuth) during installation** | **off** |
| **Enable Device Flow** | off |

Add a second redirect URI for local work — the field accepts up to ten:

```
http://localhost:3000/api/auth/callback/github
```

Both boxes are unchecked deliberately. Forge uses the user token once, to learn
who signed in, and never calls GitHub as that person afterwards, so an expiring
token buys a refresh flow for nothing. And authorizing during installation
would send the browser to the OAuth callback instead of the setup URL below,
which is the one moment Forge can attach an installation to a Forge account.

### Post installation

| Field | Value |
|---|---|
| **Setup URL** | `https://forge.papiliocurtis.workers.dev/api/github/setup` |
| **Redirect on update** | **on** |

This is the link step. A webhook announces an installation but names only a
GitHub account; the setup redirect arrives in a signed-in browser, which is what
lets Forge say *this installation belongs to this user*. An installation nobody
has claimed stays inert — its pull requests are ignored, not guessed at.

Visiting it again is harmless: re-linking to the same account succeeds, and an
installation another Forge account already holds is refused with a message
rather than being stolen.

### Webhook

| Field | Value |
|---|---|
| **Active** | on |
| **Webhook URL** | `https://forge.papiliocurtis.workers.dev/api/github/webhook` |
| **Secret** | generate one, see below |

```bash
openssl rand -hex 32
```

Keep that value. It goes into GitHub's form and into `GITHUB_WEBHOOK_SECRET`,
and it is the entire security boundary on that endpoint: the HMAC is verified
against the raw body before anything is parsed, and a delivery that fails gets
a bare 401.

### Repository permissions

Only three, plus the mandatory one:

| Permission | Access | Why |
|---|---|---|
| **Checks** | Read and write | Opening and concluding the check run — the only thing Forge writes to GitHub |
| **Pull requests** | Read-only | Required to receive `pull_request` deliveries |
| **Deployments** | Read-only | Required to receive `deployment_status`, which carries the preview URL |
| **Metadata** | Read-only | Granted automatically |

Leave organisation, account, and enterprise permissions untouched. Forge reads
no code: repository investigation, when Solari is configured, happens in a
sandbox with its own credentials.

### Subscribe to events

Tick exactly two:

- **Pull request** — opened, reopened, synchronize, ready for review
- **Deployment status** — where the preview URL actually comes from

`installation` and `meta` are delivered without subscribing. Everything else is
answered with *no handler for this event* and ignored.

### Where can this GitHub App be installed?

**Any account.** Forge is multi-tenant; each installation is claimed by whoever
completes the setup redirect. Restrict this to your own account only if the
deployment is genuinely private.

---

## 2. Collect the credentials

On the app's settings page after creation:

1. **App ID** — the number near the top. → `GITHUB_APP_ID`
2. **Client ID** and a generated **client secret**, under *Client secrets* —
   only if you are reusing this app for sign-in. → `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET`
3. **Private keys → Generate a private key.** A `.pem` downloads. →
   `GITHUB_APP_PRIVATE_KEY`, after the conversion below
4. The **slug** from the app's public URL, `github.com/apps/<slug>`. →
   `GITHUB_APP_SLUG`

### Two client ids, one slot

A GitHub App has a client id and client secret of its own, and they look exactly
like an OAuth app's. Forge reads neither. The App authenticates by signing a JWT
with its private key and trading it for an installation token, so
`GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are the whole credential.

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are read in one place —
Better Auth's social provider — and mean one thing: sign in to Forge with
GitHub. Whichever app you point them at, the other app's client credentials go
unused.

Two workable arrangements:

- **A standalone OAuth app for sign-in.** Nothing else to configure. Users see
  two entries in their GitHub authorizations: the OAuth app they signed in
  with, and the App they installed.
- **This App for both.** One identity, one consent screen, and the direction
  GitHub itself recommends. It needs the redirect URI above *and* **Account
  permissions → Email addresses: Read-only**. A GitHub App's user token ignores
  OAuth scopes and is governed by permissions instead, so without that
  permission Better Auth cannot read a verified address — which is what account
  linking trusts GitHub for in the first place.

Note also that `GITHUB_APP_ID` is the **numeric App ID**, not the `Iv23li…`
client id sitting a few lines above it on the same page.

### Convert the private key

GitHub issues PKCS#1 (`BEGIN RSA PRIVATE KEY`). WebCrypto imports PKCS#8 only,
so Forge rejects the raw file with an error naming this command rather than
failing obscurely at webhook time:

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in ~/Downloads/forge-verification.private-key.pem \
  -out ~/forge-app.pkcs8.pem
```

The header should now read `BEGIN PRIVATE KEY`. Flatten it to one line —
literal `\n` between the lines, which Forge expands on import — and put it on
the clipboard:

```bash
perl -pe 's/\n/\\n/' ~/forge-app.pkcs8.pem | pbcopy
```

Delete both files once the secret is set. Nothing needs them again; a new key
can be generated at any time, and the old one revoked.

---

## 3. Set the secrets

### Production

```bash
cd apps/web

wrangler secret put GITHUB_APP_ID           # 123456
wrangler secret put GITHUB_APP_PRIVATE_KEY  # paste the single-line PKCS#8
wrangler secret put GITHUB_WEBHOOK_SECRET   # the openssl rand -hex 32 value
wrangler secret put GITHUB_APP_SLUG         # forge-verification

# Only if this app also handles sign-in
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

Or add them to the untracked `apps/web/.env.production` and push the lot:

```bash
pnpm push:secrets
```

Secrets take effect on the next request; no redeploy is needed for a value
change, but do redeploy after `pnpm build` if code changed too.

The three that matter are `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and
`GITHUB_WEBHOOK_SECRET`. Any one missing turns the integration off completely —
there is no half-configured state. `GITHUB_APP_SLUG` is separate: without it the
integration still works, but the console has no install link to offer, so the
section stays hidden for anyone who has not installed the app already.

### Development

Local secrets live in `apps/web/.dev.vars`, which is gitignored:

```
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET="the-dev-secret"
GITHUB_APP_SLUG="forge-verification-dev"
```

A GitHub App has exactly one webhook URL and one setup URL, and neither can
point at `localhost`. To exercise the full loop locally, create a second app —
`Forge Verification (dev)` — identical to the first except:

| Field | Value |
|---|---|
| Homepage URL | `http://localhost:3000` |
| Setup URL | `<tunnel>/api/github/setup` |
| Webhook URL | `<tunnel>/api/github/webhook` |

where `<tunnel>` is a public origin forwarding to port 3000:

```bash
cloudflared tunnel --url http://localhost:3000
```

Sign-in is the exception — its redirect URI may be `http://localhost:3000`
directly, since the browser, not GitHub's servers, follows it. That is why the
production app carries both redirect URIs and needs no tunnel for sign-in work.

---

## 4. Verify it

1. Restart or redeploy, then open **Settings**. The **GitHub** section now
   exists, with **Install the GitHub App**.
2. Install it on an account, selecting the repositories to verify. GitHub
   returns you to the setup URL and the section lists the installation.
3. In the app's **Advanced** tab, check the `installation` delivery: 200, with
   a body saying the installation was recorded.
4. Add a project whose **GitHub repository** is one of the selected ones. Its
   **Pull requests** panel now appears.
5. Open a pull request. The check *Forge verification* should appear on the head
   commit within a few seconds of the preview deployment being announced.

If nothing happens, the delivery response says why in plain words — no project
points at that repository, the installation is not linked to a Forge account,
the deployment reported no environment URL, the preview URL failed the SSRF
policy. Each is a `handled: false` with a sentence, visible in GitHub's own
redelivery UI.

### Previews that GitHub is never told about

Most hosts publish a `deployment_status` and nothing else is needed. If yours
does not, give the project a **Preview URL pattern** and the run starts on the
pull request event instead:

```
https://pr-{number}.yourapp.pages.dev
```

Placeholders: `{number}`, `{branch}`, `{sha}`, `{sha7}`.

---

## What the check says

A run only *fails* the check on findings the deterministic classifier called
`confirmed_bug`. Flaky, environmental, and agent-error findings conclude
neutral: blocking a pull request on a rate limit or on Forge's own hiccup would
teach a team to ignore the check, which is worse than not having one.

One check per commit, however many events describe it — the run carries an
idempotency key derived from the commit SHA, and a second event finds the check
already open.
