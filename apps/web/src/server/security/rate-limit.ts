/**
 * Rate limiting.
 *
 * Three doors on a public deployment cost something to walk through: signing
 * in, which can be guessed at; the token API, which reads the database before
 * it knows whether the caller is anyone at all; and starting a run, which buys
 * a Solari session and a handful of model calls. `domain/budget` bounds what a
 * single run may spend. Nothing bounded how many runs a caller could start, or
 * how fast a password could be tried.
 *
 * Cloudflare's rate limiting binding does the counting. It counts per colo
 * rather than globally, so the real ceiling is somewhat higher than the number
 * configured. That is the right trade here: these limits exist to stop abuse,
 * not to meter a quota, and an approximate limit that costs nothing to check is
 * worth more than an exact one that needs a round trip to storage on every
 * request.
 *
 * This module is kept free of Cloudflare imports so it can be unit tested;
 * `security/index.ts` supplies the bindings and the policy, the same split
 * `target-url` uses.
 */

/** Which door was closed. It decides what the caller is told. */
export type RateLimitScope = 'auth' | 'api' | 'run'

/**
 * What each scope says when it refuses.
 *
 * Written for whoever reads it: the person at the sign-in form, the script
 * reading a JSON error, the person who pressed Verify twice too often. None of
 * them are told which limit they hit or how much of it is left, because that
 * turns the limiter into an oracle for how hard it can be pushed.
 */
const MESSAGES: Record<RateLimitScope, string> = {
  auth: 'Too many sign-in attempts from this address. Wait a minute and try again.',
  api: 'Too many requests. Wait a minute and try again.',
  run: 'Too many runs started in the last minute. Wait a moment, then start another.',
}

export class RateLimitError extends Error {
  constructor(
    readonly scope: RateLimitScope,
    /** Seconds to wait, for a `Retry-After` header. Matches the bindings' period. */
    readonly retryAfterSeconds = 60,
  ) {
    super(MESSAGES[scope])
    this.name = 'RateLimitError'
  }
}

/**
 * The address a request came from.
 *
 * `CF-Connecting-IP` is written by Cloudflare on every request that reaches a
 * Worker and cannot be set by the client, so it is the only header trusted
 * here. `x-forwarded-for` is read as a fallback for a request that did not come
 * through the edge - a local dev server, a `wrangler dev` proxy - and its first
 * entry is the original client by convention.
 *
 * Everything unattributable shares the single `unknown` bucket. That is
 * deliberate rather than a gap: such a request is either local development or
 * one the edge could not label, and counting those together is the conservative
 * reading of both.
 */
export function clientAddress(headers: Headers): string {
  const direct = headers.get('cf-connecting-ip')?.trim()
  if (direct) return direct
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}

/**
 * Whether an `/api/auth` path is one that offers a credential.
 *
 * Better Auth serves the whole sign-in surface and the session reads from the
 * same prefix, and a session read is not worth limiting: the console makes them
 * routinely, and they tell an attacker nothing. `sign-in` and `sign-up` are
 * where a password is guessed or an account is created, which is the traffic
 * this limit is for.
 */
export function isCredentialPath(pathname: string): boolean {
  return /\/sign-(in|up)(\/|$)/.test(pathname)
}

/**
 * Counts one request against `limiter`, and throws when the bucket is empty.
 *
 * An absent or failing limiter allows the request. A limiter is a guard, not a
 * gate: if the service behind it is unreachable, refusing every request would
 * turn a rate limiting outage into a Forge outage, which is the worse of the
 * two failures. The absent case is ordinary - a deployment configured without
 * the binding - and the failing case is logged so it is visible rather than
 * silently unlimited.
 */
export async function enforce(
  limiter: RateLimit | undefined,
  scope: RateLimitScope,
  key: string,
): Promise<void> {
  if (!limiter) return

  let allowed: boolean
  try {
    allowed = (await limiter.limit({ key })).success
  } catch (error) {
    console.error(`[rate-limit] ${scope} limiter unavailable, allowing:`, error)
    return
  }

  if (!allowed) throw new RateLimitError(scope)
}
