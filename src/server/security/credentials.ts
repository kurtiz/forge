/**
 * Credential encryption for target applications.
 *
 * A project may carry a test account for an application that requires login.
 * That password is the only user-supplied secret Forge stores at rest, so it is
 * encrypted with AES-GCM before it reaches D1 and decrypted only inside the run
 * Durable Object, at the moment it is typed into the target's login form.
 *
 * No Workers import: the key material is passed in, which keeps this unit
 * testable and keeps the env lookup at the edge, the same split as
 * `target-url.ts` (pure) and `index.ts` (env-bound).
 */

export class CredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}

const IV_BYTES = 12

/**
 * Derives a 256-bit AES key from arbitrary key material.
 *
 * Hashing rather than importing raw bytes means the operator's
 * `FORGE_CREDENTIAL_KEY` can be any passphrase of any length, instead of having
 * to be exactly 32 base64-encoded bytes.
 */
async function deriveKey(keyMaterial: string): Promise<CryptoKey> {
  if (!keyMaterial || keyMaterial.length < 16) {
    throw new CredentialError(
      'FORGE_CREDENTIAL_KEY must be at least 16 characters.',
    )
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(keyMaterial),
  )
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Returns base64 of `iv || ciphertext`. The IV is fresh for every call. */
export async function encryptSecret(
  plaintext: string,
  keyMaterial: string,
): Promise<string> {
  const key = await deriveKey(keyMaterial)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )

  const packed = new Uint8Array(iv.length + ciphertext.byteLength)
  packed.set(iv, 0)
  packed.set(new Uint8Array(ciphertext), iv.length)
  return toBase64(packed)
}

/**
 * Reverses `encryptSecret`. Throws rather than returning null: a credential that
 * cannot be decrypted is an operational fault (a rotated or missing key), not an
 * empty password to be typed into someone's login form.
 */
export async function decryptSecret(
  encoded: string,
  keyMaterial: string,
): Promise<string> {
  const key = await deriveKey(keyMaterial)

  let packed: Uint8Array
  try {
    packed = fromBase64(encoded)
  } catch {
    throw new CredentialError('Stored credential is not valid base64.')
  }

  if (packed.length <= IV_BYTES) {
    throw new CredentialError('Stored credential is truncated.')
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(0, IV_BYTES) },
      key,
      packed.slice(IV_BYTES),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    // AES-GCM authentication failed: wrong key, or the ciphertext was altered.
    throw new CredentialError(
      'Stored credential could not be decrypted. The encryption key may have changed.',
    )
  }
}

/** Normalises the login path a project stores. Always a same-origin path. */
export function normaliseLoginPath(input: string | null | undefined): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return '/login'
  if (/^https?:\/\//i.test(trimmed)) {
    throw new CredentialError(
      'The login path must be a path on the target site, e.g. /login',
    )
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}
