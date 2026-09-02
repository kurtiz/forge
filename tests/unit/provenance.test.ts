/**
 * Where a run says it came from.
 *
 * `/api/v1/runs` used to hardcode `cli`, so a run started from the browser -
 * which authenticates with a session cookie, on the same endpoint - appeared
 * in the project's history tagged "CLI". These lock the trigger to the
 * credential instead of the route.
 */
import { describe, expect, it } from 'vitest'
import { apiRunTrigger, usedApiToken } from '#/server/domain/provenance'

const headers = (init?: Record<string, string>) => new Headers(init)

describe('usedApiToken', () => {
  it('sees a bearer token', () => {
    expect(usedApiToken(headers({ authorization: 'Bearer forge_abc' }))).toBe(true)
  })

  it('accepts the scheme in any case, the way the resolver does', () => {
    expect(usedApiToken(headers({ authorization: 'bearer forge_abc' }))).toBe(true)
  })

  it('is false with no authorization header at all', () => {
    expect(usedApiToken(headers())).toBe(false)
  })

  it('is false for a cookie', () => {
    expect(usedApiToken(headers({ cookie: 'better-auth.session_token=x' }))).toBe(
      false,
    )
  })

  it('is false for a scheme that is not bearer', () => {
    expect(usedApiToken(headers({ authorization: 'Basic abc' }))).toBe(false)
  })
})

describe('apiRunTrigger', () => {
  it('calls a token-authenticated run a CLI run', () => {
    expect(apiRunTrigger(headers({ authorization: 'Bearer forge_abc' }))).toBe(
      'cli',
    )
  })

  it('calls a cookie-authenticated run manual, whatever endpoint it arrived on', () => {
    expect(
      apiRunTrigger(headers({ cookie: 'better-auth.session_token=x' })),
    ).toBe('manual')
  })
})
