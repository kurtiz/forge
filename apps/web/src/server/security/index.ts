/**
 * Security helpers bound to the runtime environment.
 *
 * `target-url` is kept free of Cloudflare imports so it can be unit tested;
 * this module supplies the environment-dependent policy on top of it.
 */
import { env } from 'cloudflare:workers'
import {
  assertSafeTargetUrl as assertSafeTargetUrlPure,
  normaliseRepoUrl,
  UnsafeTargetError,
} from './target-url'
import {
  CredentialError,
  decryptSecret,
  encryptSecret,
  normaliseLoginPath,
} from './credentials'
import {
  clientAddress,
  enforce,
  isCredentialPath,
  RateLimitError,
} from './rate-limit'

export { normaliseRepoUrl, UnsafeTargetError }
export { CredentialError, normaliseLoginPath }
export {
  headersForUrl,
  HeaderError,
  normaliseHeaderName,
  normaliseHeaderValue,
  sameOrigin,
} from './headers'
export { redactSecrets, redactDeep, REDACTED } from './redact'
export { RateLimitError }

/**
 * The key protecting stored target-application passwords. Absent by default:
 * without it a project simply cannot carry credentials, which is a better
 * failure than encrypting them under a predictable key.
 */
function credentialKey(): string {
  const key = env.FORGE_CREDENTIAL_KEY
  if (!key) {
    throw new CredentialError(
      'Credentials are not configured on this deployment. Set FORGE_CREDENTIAL_KEY (wrangler secret put FORGE_CREDENTIAL_KEY) to store target-application logins.',
    )
  }
  return key
}

export function credentialsAvailable(): boolean {
  return Boolean(env.FORGE_CREDENTIAL_KEY)
}

export function encryptCredential(plaintext: string): Promise<string> {
  return encryptSecret(plaintext, credentialKey())
}

export function decryptCredential(encoded: string): Promise<string> {
  return decryptSecret(encoded, credentialKey())
}

/**
 * Loopback targets are allowed in local development only, so the bundled demo
 * application can be verified end to end without deploying it first.
 */
export function assertSafeTargetUrl(input: string): URL {
  return assertSafeTargetUrlPure(input, {
    allowLoopback: env.FORGE_ENV === 'development',
  })
}

/* ------------------------------------------------------------ rate limits */

/**
 * Sign-in and sign-up attempts, counted by address.
 *
 * Applied to the whole Better Auth surface and enforced only on the paths that
 * offer a credential, so the console's session reads are unaffected. The
 * address is the key rather than the email: an attacker chooses the email.
 */
export function limitCredentialAttempt(request: Request): Promise<void> {
  if (!isCredentialPath(new URL(request.url).pathname)) return Promise.resolve()
  return enforce(env.AUTH_LIMITER, 'auth', clientAddress(request.headers))
}

/**
 * The public REST API, counted by address, before the token is resolved.
 *
 * Deliberately loose. The CLI polls a run every three seconds and CI runners
 * share egress addresses, so a limit tight enough to meter one client would
 * break several honest ones sharing an address. What it stops is the flood: a
 * caller with no token, or a stolen one, making the database look up a token on
 * every request.
 */
export function limitApiRequest(request: Request): Promise<void> {
  return enforce(env.API_LIMITER, 'api', clientAddress(request.headers))
}

/**
 * Starting a run, counted by account.
 *
 * The one limit here that is about money rather than about abuse, so it is
 * keyed by the account that will be billed for the browser session rather than
 * by where the request came from. Scheduled and pull request runs are not
 * counted: their rate is already bounded by the cadence a project chose and by
 * how often a branch is pushed, and dropping one of those silently would look
 * like Forge missing a deployment.
 */
export function limitRunStart(userId: string): Promise<void> {
  return enforce(env.RUN_LIMITER, 'run', userId)
}
