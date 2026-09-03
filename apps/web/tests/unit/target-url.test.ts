import { describe, expect, it } from 'vitest'
import {
  assertSafeTargetUrl,
  normaliseRepoUrl,
  UnsafeTargetError,
} from '@/server/security/target-url'

describe('assertSafeTargetUrl', () => {
  it('accepts a public https URL and strips the fragment', () => {
    const url = assertSafeTargetUrl('https://preview.example.com/app#top')
    expect(url.toString()).toBe('https://preview.example.com/app')
  })

  it('defaults a bare hostname to https', () => {
    expect(assertSafeTargetUrl('example.com').protocol).toBe('https:')
  })

  it.each([
    ['127.0.0.1', 'http://127.0.0.1:8080'],
    ['loopback ipv6', 'http://[::1]/'],
    ['private class A', 'http://10.1.2.3/'],
    ['private class B', 'http://172.20.0.5/'],
    ['private class C', 'http://192.168.1.1/'],
    ['carrier NAT', 'http://100.70.0.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['unique local ipv6', 'http://[fd00::1]/'],
    ['localhost', 'http://localhost:3000'],
    ['internal suffix', 'https://db.internal/'],
    ['mdns suffix', 'https://printer.local/'],
    ['gcp metadata host', 'http://metadata.google.internal/'],
  ])('rejects %s', (_label, input) => {
    expect(() => assertSafeTargetUrl(input)).toThrow(UnsafeTargetError)
  })

  it('rejects non-http protocols', () => {
    expect(() => assertSafeTargetUrl('file:///etc/passwd')).toThrow(
      UnsafeTargetError,
    )
    expect(() => assertSafeTargetUrl('ftp://example.com')).toThrow(
      UnsafeTargetError,
    )
  })

  it('rejects credentials embedded in the URL', () => {
    expect(() => assertSafeTargetUrl('https://user:pw@example.com')).toThrow(
      UnsafeTargetError,
    )
  })

  it('allows loopback only when explicitly opted in', () => {
    expect(() =>
      assertSafeTargetUrl('http://localhost:3000/demo'),
    ).toThrow(UnsafeTargetError)

    expect(
      assertSafeTargetUrl('http://localhost:3000/demo', {
        allowLoopback: true,
      }).toString(),
    ).toBe('http://localhost:3000/demo')
  })

  it('still rejects private ranges when loopback is allowed', () => {
    expect(() =>
      assertSafeTargetUrl('http://169.254.169.254/', { allowLoopback: true }),
    ).toThrow(UnsafeTargetError)
  })
})

describe('normaliseRepoUrl', () => {
  it('normalises accepted GitHub forms to a canonical URL', () => {
    for (const input of [
      'https://github.com/acme/app',
      'github.com/acme/app',
      'https://www.github.com/acme/app.git',
      'https://github.com/acme/app/',
    ]) {
      expect(normaliseRepoUrl(input)).toBe('https://github.com/acme/app')
    }
  })

  it('returns null for empty input', () => {
    expect(normaliseRepoUrl(null)).toBeNull()
    expect(normaliseRepoUrl('  ')).toBeNull()
  })

  it('rejects hosts other than GitHub', () => {
    expect(() => normaliseRepoUrl('https://gitlab.com/acme/app')).toThrow(
      UnsafeTargetError,
    )
  })
})
