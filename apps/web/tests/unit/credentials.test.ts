import { describe, expect, it } from 'vitest'
import {
  CredentialError,
  decryptSecret,
  encryptSecret,
  normaliseLoginPath,
} from '@/server/security/credentials'

const KEY = 'a-test-key-of-sufficient-length'

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a password', async () => {
    const encrypted = await encryptSecret('northbeam-demo', KEY)
    expect(await decryptSecret(encrypted, KEY)).toBe('northbeam-demo')
  })

  it('never stores the plaintext', async () => {
    const encrypted = await encryptSecret('northbeam-demo', KEY)
    expect(encrypted).not.toContain('northbeam-demo')
  })

  it('produces a different ciphertext each time', async () => {
    // A fresh IV per call: identical passwords must not be correlatable across
    // projects by comparing stored values.
    const a = await encryptSecret('same', KEY)
    const b = await encryptSecret('same', KEY)
    expect(a).not.toBe(b)
    expect(await decryptSecret(b, KEY)).toBe('same')
  })

  it('refuses to decrypt under a different key', async () => {
    const encrypted = await encryptSecret('secret', KEY)
    await expect(
      decryptSecret(encrypted, 'another-key-entirely-here'),
    ).rejects.toBeInstanceOf(CredentialError)
  })

  it('refuses tampered ciphertext', async () => {
    const encrypted = await encryptSecret('secret', KEY)
    const flipped = `${encrypted.slice(0, -4)}AAAA`
    await expect(decryptSecret(flipped, KEY)).rejects.toBeInstanceOf(
      CredentialError,
    )
  })

  it('rejects a truncated payload', async () => {
    await expect(decryptSecret('AAAA', KEY)).rejects.toBeInstanceOf(
      CredentialError,
    )
  })

  it('rejects weak key material', async () => {
    await expect(encryptSecret('secret', 'short')).rejects.toBeInstanceOf(
      CredentialError,
    )
  })

  it('round-trips unicode', async () => {
    const password = 'pá$$wörd–✓'
    expect(await decryptSecret(await encryptSecret(password, KEY), KEY)).toBe(
      password,
    )
  })
})

describe('normaliseLoginPath', () => {
  it('defaults to /login', () => {
    expect(normaliseLoginPath(null)).toBe('/login')
    expect(normaliseLoginPath('  ')).toBe('/login')
  })

  it('adds a leading slash', () => {
    expect(normaliseLoginPath('account/signin')).toBe('/account/signin')
  })

  it('rejects an absolute URL, which would send credentials off-origin', () => {
    expect(() => normaliseLoginPath('https://evil.example.com/login')).toThrow(
      CredentialError,
    )
  })
})
