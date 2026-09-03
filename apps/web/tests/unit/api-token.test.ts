import { describe, expect, it } from 'vitest'
import {
  bearerToken,
  displayPrefix,
  generateToken,
  hashToken,
  isTokenShaped,
  TOKEN_PREFIX,
} from '@/server/tokens/token'

describe('generateToken', () => {
  it('produces a prefixed, well-shaped token', () => {
    const token = generateToken()
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true)
    expect(isTokenShaped(token)).toBe(true)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()))
    expect(tokens.size).toBe(200)
  })
})

describe('isTokenShaped', () => {
  it('rejects anything that is not a Forge token', () => {
    // Cheap rejection before a hash and a database round-trip, and it keeps a
    // session cookie or a stray header from being looked up as a token.
    for (const value of [
      '',
      'forge_',
      'sk_live_abcdef',
      'Bearer forge_abc',
      `${TOKEN_PREFIX}TOOSHORT`,
      `${TOKEN_PREFIX}${'a'.repeat(41)}`,
      `${TOKEN_PREFIX}${'A'.repeat(40)}`,
      `${TOKEN_PREFIX}${'l'.repeat(40)}`,
    ]) {
      expect(isTokenShaped(value)).toBe(false)
    }
  })
})

describe('hashToken', () => {
  it('is stable and never contains the token', async () => {
    const token = generateToken()
    const hash = await hashToken(token)
    expect(hash).toHaveLength(64)
    expect(hash).toBe(await hashToken(token))
    expect(hash).not.toContain(token.slice(TOKEN_PREFIX.length))
  })

  it('differs for different tokens', async () => {
    expect(await hashToken(generateToken())).not.toBe(
      await hashToken(generateToken()),
    )
  })
})

describe('displayPrefix', () => {
  it('shows enough to tell tokens apart and no more', () => {
    const token = generateToken()
    const prefix = displayPrefix(token)
    expect(token.startsWith(prefix)).toBe(true)
    expect(prefix.length).toBeLessThan(token.length / 2)
  })
})

describe('bearerToken', () => {
  it('reads a bearer credential', () => {
    const headers = new Headers({ authorization: 'Bearer forge_abc' })
    expect(bearerToken(headers)).toBe('forge_abc')
  })

  it('is case-insensitive about the scheme', () => {
    expect(bearerToken(new Headers({ authorization: 'bearer x' }))).toBe('x')
  })

  it('ignores other schemes and missing headers', () => {
    expect(bearerToken(new Headers())).toBeNull()
    expect(bearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull()
    expect(bearerToken(new Headers({ authorization: 'Bearer' }))).toBeNull()
  })
})
