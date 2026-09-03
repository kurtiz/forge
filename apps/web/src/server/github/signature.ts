/**
 * GitHub webhook signature verification.
 *
 * Pure by design, like `security/target-url.ts`: the secret is passed in, so
 * this is unit tested without a Workers environment and the env lookup stays
 * at the edge.
 *
 * The webhook endpoint is public and unauthenticated. The HMAC is the only
 * thing standing between a stranger and the ability to start billable runs on
 * someone else's account, so it is checked before the body is parsed, and the
 * comparison is constant-time.
 */

const encoder = new TextEncoder()

/** Compares two strings without leaking where they first differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Computes the `sha256=...` value GitHub sends in `X-Hub-Signature-256`. */
export async function signPayload(
  payload: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const hex = Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return `sha256=${hex}`
}

/**
 * Verifies a delivery. Returns false for a missing, malformed, or wrong
 * signature; the caller answers 401 without saying which.
 */
export async function verifySignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false
  if (!header.startsWith('sha256=')) return false
  return timingSafeEqual(header, await signPayload(payload, secret))
}
