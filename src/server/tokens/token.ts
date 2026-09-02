/**
 * API token format and hashing.
 *
 * Pure: no Workers imports, so it is unit tested alongside the credential
 * code. A token is `forge_` followed by 40 characters from a 32-symbol
 * alphabet (200 bits of entropy). Only the SHA-256 of the token is stored, so
 * a database read cannot yield a usable secret, and there is no need for a
 * per-token salt: the input space is far too large to enumerate.
 */

export const TOKEN_PREFIX = 'forge_'
const TOKEN_BODY_LENGTH = 40
/** Unambiguous lowercase alphabet: no 0/o, 1/l/i confusion when read aloud. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}[${ALPHABET}]{${TOKEN_BODY_LENGTH}}$`)

/** Characters shown in the console so tokens can be told apart. */
export const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 6

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BODY_LENGTH))
  let body = ''
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length]
  return TOKEN_PREFIX + body
}

/** Cheap shape check before a hash and a database round-trip. */
export function isTokenShaped(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

export function displayPrefix(token: string): string {
  return token.slice(0, DISPLAY_PREFIX_LENGTH)
}

/** Reads a bearer token from a request, or null when there is none. */
export function bearerToken(headers: Headers): string | null {
  const header = headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : null
}
