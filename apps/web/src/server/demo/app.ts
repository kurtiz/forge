/**
 * Fixture application ("Northbeam").
 *
 * A small, deliberately broken web app served from this Worker so the whole
 * verification loop can be demonstrated without depending on somebody else's
 * site staying up. It is plain server-rendered HTML with real status codes, so
 * either executor can drive it.
 *
 * Checkout and invitations sit behind a login (`/demo/login`,
 * ines@northbeam.test / northbeam-demo). An unauthenticated request gets the
 * login form at HTTP 200 rather than a redirect or a 401, which is exactly the
 * auth wall a verifier cannot detect from status codes.
 *
 * Seeded defects:
 *   1. Applying a coupon at checkout throws a 500. The handler reads a discount
 *      record that only exists for signed-in customers.
 *   2. Inviting a teammate outside the org domain returns 500.
 *   3. The Pricing link in the navigation points at a page that was renamed.
 *
 * `FORGE_DEMO_FIXED=1` repairs 1 and 2, which is what makes "Verify fix"
 * demonstrable: run it, read the finding, flip the flag, re-run the exact
 * journey, watch it pass.
 */
import { env } from 'cloudflare:workers'

const PAGE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #f7f7f8; color: #18181b;
  }
  header {
    display: flex; align-items: center; gap: 20px;
    padding: 14px 24px; background: #fff; border-bottom: 1px solid #e4e4e7;
  }
  header strong { font-size: 15px; letter-spacing: -0.01em; }
  nav { display: flex; gap: 18px; flex-wrap: wrap; }
  nav a { color: #52525b; text-decoration: none; font-size: 14px; }
  nav a:hover { color: #18181b; }
  main { max-width: 640px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 8px; }
  p { color: #52525b; margin: 0 0 20px; }
  form { display: grid; gap: 14px; background: #fff; border: 1px solid #e4e4e7;
         border-radius: 10px; padding: 20px; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: #3f3f46; }
  input, select {
    padding: 9px 11px; border: 1px solid #d4d4d8; border-radius: 7px;
    font: inherit; background: #fff; color: #18181b;
  }
  button {
    justify-self: start; padding: 9px 16px; border-radius: 7px; border: 0;
    background: #18181b; color: #fff; font: inherit; font-weight: 600; cursor: pointer;
  }
  .ok { border-left: 3px solid #16a34a; padding-left: 14px; }
  code { font-family: ui-monospace, monospace; font-size: 13px; }
  ul { padding-left: 18px; color: #52525b; }
`

/**
 * The fixture's login gate.
 *
 * `/demo/checkout` and `/demo/invite` require a session. An unauthenticated
 * request is answered with the login form **at HTTP 200**, not a 302 or a 401 -
 * that is the case a verifier cannot see from status codes alone, and the one
 * worth having regression coverage for.
 */
const DEMO_USER = 'ines@northbeam.test'
const DEMO_PASSWORD = 'northbeam-demo'
const SESSION_COOKIE = 'northbeam_session'
const SESSION_VALUE = 'signed-in'

const GATED_PATHS = new Set(['/demo/checkout', '/demo/invite'])

function isSignedIn(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? ''
  return cookie
    .split(';')
    .map((part) => part.trim())
    .includes(`${SESSION_COOKIE}=${SESSION_VALUE}`)
}

function loginPage(message?: string): Response {
  return page(
    'Sign in',
    `<h1>Sign in</h1>
     <p>Northbeam needs a signed-in account for checkout and invitations.</p>
     ${message ? `<p class="ok">${escapeHtml(message)}</p>` : ''}
     <form method="post" action="/demo/login">
       <label>Email<input name="email" type="email" required placeholder="you@northbeam.test"></label>
       <label>Password<input name="password" type="password" required></label>
       <button type="submit" name="action" value="signin">Sign in</button>
     </form>`,
  )
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Northbeam</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header>
  <strong>Northbeam</strong>
  <nav>
    <a href="/demo">Dashboard</a>
    <a href="/demo/checkout">Checkout</a>
    <a href="/demo/invite">Invite teammate</a>
    <a href="/demo/login">Sign in</a>
    <!-- Seeded defect 3: this page was renamed to /demo/plans and the link was missed. -->
    <a href="/demo/pricing">Pricing</a>
  </nav>
</header>
<main>${body}</main>
</body>
</html>`

  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

const isFixed = () => env.FORGE_DEMO_FIXED === '1'

export async function handleDemoRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/(.)\/$/, '$1')

  if (request.method === 'POST') {
    const form = new URLSearchParams(await request.text())
    if (path === '/demo/login') return signIn(form)
    if (GATED_PATHS.has(path) && !isSignedIn(request)) return loginPage()
    if (path === '/demo/checkout') return checkout(form)
    if (path === '/demo/invite') return invite(form)
    return notFound(path)
  }

  // The gate. 200 with a login form, so the redirect is invisible to anything
  // reading status codes alone.
  if (GATED_PATHS.has(path) && !isSignedIn(request)) return loginPage()

  switch (path) {
    case '/demo/login':
      return isSignedIn(request)
        ? page('Signed in', `<h1>Signed in</h1><p>You are signed in as ${DEMO_USER}.</p>`)
        : loginPage()

    case '/demo':
      return page(
        'Dashboard',
        `<h1>Good afternoon, Ines</h1>
         <p>Northbeam is a sample application with known defects. Forge uses it
            to demonstrate the verification loop end to end.</p>
         <ul>
           <li>2 active workspaces</li>
           <li>Billing renews on the 4th</li>
           <li>3 teammates</li>
         </ul>`,
      )

    case '/demo/checkout':
      return page(
        'Checkout',
        `<h1>Checkout</h1>
         <p>Northbeam Team, billed monthly.</p>
         <form method="post" action="/demo/checkout">
           <label>Email<input name="email" type="email" required placeholder="you@company.com"></label>
           <label>Card number<input name="card" required placeholder="4242 4242 4242 4242"></label>
           <label>Coupon code<input name="coupon" placeholder="Optional"></label>
           <button type="submit" name="action" value="pay">Complete purchase</button>
         </form>`,
      )

    case '/demo/invite':
      return page(
        'Invite teammate',
        `<h1>Invite a teammate</h1>
         <p>They will get access to every workspace you own.</p>
         <form method="post" action="/demo/invite">
           <label>Email<input name="email" type="email" required placeholder="teammate@company.com"></label>
           <label>Role
             <select name="role">
               <option value="member">Member</option>
               <option value="admin">Admin</option>
             </select>
           </label>
           <button type="submit" name="action" value="invite">Send invite</button>
         </form>`,
      )

    case '/demo/plans':
      return page(
        'Plans',
        `<h1>Plans</h1>
         <p>Solo is free. Team is 19 per seat per month.</p>`,
      )

    default:
      // Seeded defect 3 lands here: /demo/pricing no longer exists.
      return notFound(path)
  }
}

function notFound(path: string): Response {
  return page(
    'Not found',
    `<h1>Page not found</h1>
     <p>The page <code>${escapeHtml(path)}</code> does not exist.</p>`,
    404,
  )
}

function signIn(form: URLSearchParams): Response {
  const email = (form.get('email') ?? '').trim()
  const password = form.get('password') ?? ''

  if (email !== DEMO_USER || password !== DEMO_PASSWORD) {
    // Re-rendering the form is what tells a verifier the sign-in did not take.
    return loginPage('Those credentials were not recognised.')
  }

  const response = page(
    'Signed in',
    `<h1>Signed in</h1>
     <p>Welcome back, Ines. Checkout and invitations are now available.</p>`,
  )
  response.headers.append(
    'set-cookie',
    `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/demo; HttpOnly; SameSite=Lax`,
  )
  return response
}

function checkout(form: URLSearchParams): Response {
  const coupon = (form.get('coupon') ?? '').trim()

  if (coupon && !isFixed()) {
    // Seeded defect 1. The discount ledger row only exists for signed-in
    // customers, and guest checkout reads it unconditionally.
    return page(
      'Checkout failed',
      `<h1>Something went wrong</h1>
       <p><code>TypeError: Cannot read properties of undefined (reading 'amountOff')
          at applyCoupon (src/server/billing/coupons.ts:47)</code></p>`,
      500,
    )
  }

  return page(
    'Order confirmed',
    `<h1>Order confirmed</h1>
     <p class="ok">Northbeam Team is active${
       coupon ? `, coupon ${escapeHtml(coupon)} applied` : ''
     }.</p>`,
  )
}

function invite(form: URLSearchParams): Response {
  const email = (form.get('email') ?? '').trim()
  const sameDomain = email.endsWith('@northbeam.example')

  if (!sameDomain && !isFixed()) {
    // Seeded defect 2. External invitations were never wired to the mailer.
    return page(
      'Invite failed',
      `<h1>Something went wrong</h1>
       <p><code>Error: mailer transport "external" is not registered
          at sendInvitation (src/server/invitations/send.ts:22)</code></p>`,
      500,
    )
  }

  return page(
    'Invite sent',
    `<h1>Invite sent</h1>
     <p class="ok">${escapeHtml(email || 'Your teammate')} will receive an email shortly.</p>`,
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
