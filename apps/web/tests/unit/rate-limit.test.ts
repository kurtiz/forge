import { describe, expect, it, vi } from 'vitest'
import {
  clientAddress,
  enforce,
  isCredentialPath,
  RateLimitError,
} from '@/server/security/rate-limit'

/** A limiter that answers the same way every time. */
function limiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) }
}

describe('clientAddress', () => {
  it('trusts the header Cloudflare writes', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.1',
    })
    expect(clientAddress(headers)).toBe('203.0.113.7')
  })

  it('falls back to the first forwarded hop off the edge', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.1, 10.0.0.4, 10.0.0.5',
    })
    expect(clientAddress(headers)).toBe('198.51.100.1')
  })

  it('puts everything it cannot attribute in one bucket', () => {
    expect(clientAddress(new Headers())).toBe('unknown')
    expect(clientAddress(new Headers({ 'cf-connecting-ip': '  ' }))).toBe('unknown')
  })
})

describe('isCredentialPath', () => {
  it.each([
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/social',
    '/api/auth/sign-in/anonymous',
  ])('limits %s', (path) => {
    expect(isCredentialPath(path)).toBe(true)
  })

  it.each([
    '/api/auth/get-session',
    '/api/auth/sign-out',
    '/api/auth/callback/github',
    // The console reads a session on nearly every navigation, and a session
    // read proves nothing to an attacker.
    '/api/auth/session',
  ])('leaves %s alone', (path) => {
    expect(isCredentialPath(path)).toBe(false)
  })
})

describe('enforce', () => {
  it('allows when no limiter is bound', async () => {
    await expect(enforce(undefined, 'api', 'key')).resolves.toBeUndefined()
  })

  it('allows while the bucket has room', async () => {
    const rl = limiter(true)
    await enforce(rl, 'api', '203.0.113.7')
    expect(rl.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('refuses once the bucket is empty, naming the scope', async () => {
    await expect(enforce(limiter(false), 'run', 'user_1')).rejects.toMatchObject({
      name: 'RateLimitError',
      scope: 'run',
      retryAfterSeconds: 60,
    })
  })

  it('says what a caller should do about it', async () => {
    const error = await enforce(limiter(false), 'auth', 'ip').catch((e) => e)
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error.message).toMatch(/sign-in attempts/i)
    // Nothing about which limit was hit, or how much of it is left.
    expect(error.message).not.toMatch(/\d/)
  })

  it('allows when the limiter itself fails, rather than taking the door down', async () => {
    const broken = {
      limit: vi.fn(async () => {
        throw new Error('rate limiting service unavailable')
      }),
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(enforce(broken, 'api', 'key')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
