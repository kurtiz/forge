/**
 * GitHub App client.
 *
 * Two credentials, in sequence: the app's private key signs a short-lived JWT,
 * that JWT mints an installation access token, and the installation token is
 * what actually touches a repository. Installation tokens are scoped to one
 * installation and expire in an hour, which is why Forge never stores a
 * long-lived GitHub credential of any kind.
 *
 * Everything here is optional. A deployment without the App configured simply
 * has no GitHub integration, the same way a deployment without a Solari key
 * has no browser: `githubConfigured()` is the one gate, and callers branch on
 * it rather than assuming.
 */
import { env } from 'cloudflare:workers'

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

const API = 'https://api.github.com'
const USER_AGENT = 'Forge-Verification'

export function githubConfigured(): boolean {
  return Boolean(
    env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET,
  )
}

export function githubAppSlug(): string | null {
  return env.GITHUB_APP_SLUG ?? null
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Imports the app's PEM private key.
 *
 * GitHub issues PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto imports PKCS#8
 * only. Rather than implement a converter, this asks for the PKCS#8 form and
 * says so, because `openssl pkcs8` is one command and a silently wrong key is
 * a bad thing to debug at webhook time.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalised = pem.replace(/\\n/g, '\n').trim()

  if (normalised.includes('BEGIN RSA PRIVATE KEY')) {
    throw new GitHubError(
      'GITHUB_APP_PRIVATE_KEY is in PKCS#1 format. Convert it first: openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key.pkcs8.pem',
    )
  }

  const body = normalised
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')

  if (!body) throw new GitHubError('GITHUB_APP_PRIVATE_KEY is empty.')

  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/**
 * Mints the app JWT. Valid for nine minutes: GitHub rejects anything over ten,
 * and the minute of slack absorbs clock skew between here and GitHub.
 */
async function appJwt(): Promise<string> {
  const appId = env.GITHUB_APP_ID
  const privateKey = env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKey) {
    throw new GitHubError('The GitHub App is not configured on this deployment.')
  }

  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)))

  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const payload = encode({ iat: now - 60, exp: now + 9 * 60, iss: appId })
  const signingInput = `${header}.${payload}`

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await importPrivateKey(privateKey),
    new TextEncoder().encode(signingInput),
  )

  return `${signingInput}.${base64url(new Uint8Array(signature))}`
}

type TokenCacheEntry = { token: string; expiresAt: number }

/**
 * Installation tokens live an hour and a webhook burst can need several calls,
 * so they are cached in the isolate. This is a best-effort cache: a cold
 * isolate simply mints a new one.
 */
const tokenCache = new Map<string, TokenCacheEntry>()

export async function installationToken(installationId: string): Promise<string> {
  const cached = tokenCache.get(installationId)
  // Refreshed five minutes early so a token cannot expire mid-request.
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token

  const response = await fetch(
    `${API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await appJwt()}`,
        accept: 'application/vnd.github+json',
        'user-agent': USER_AGENT,
        'x-github-api-version': '2022-11-28',
      },
    },
  )

  if (!response.ok) {
    throw new GitHubError(
      `Could not mint an installation token (HTTP ${response.status}).`,
      response.status,
    )
  }

  const body = (await response.json()) as { token: string; expires_at: string }
  const entry: TokenCacheEntry = {
    token: body.token,
    expiresAt: Date.parse(body.expires_at),
  }
  tokenCache.set(installationId, entry)
  return entry.token
}

/** One authenticated call against a repository, as the installation. */
export async function installationFetch(
  installationId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${await installationToken(installationId)}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      'x-github-api-version': '2022-11-28',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new GitHubError(
      `GitHub ${init.method ?? 'GET'} ${path} failed (HTTP ${response.status}). ${detail.slice(0, 300)}`,
      response.status,
    )
  }

  return response.status === 204 ? null : response.json()
}
