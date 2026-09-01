import { describe, expect, it } from 'vitest'
import { redactDeep, redactSecrets, REDACTED } from '#/server/security/redact'

describe('redactSecrets', () => {
  it('replaces every occurrence, not just the first', () => {
    const text = 'tried hunter2000 then hunter2000 again'
    expect(redactSecrets(text, ['hunter2000'])).toBe(
      `tried ${REDACTED} then ${REDACTED} again`,
    )
  })

  it('replaces the longest secret first so it is not fragmented', () => {
    // "pass" is contained in "password123". Shortest-first would leave
    // "«redacted»word123" behind, which still exposes most of the secret.
    const output = redactSecrets('password123', ['pass', 'password123'])
    expect(output).toBe(REDACTED)
  })

  it('treats secrets as literals, not patterns', () => {
    // Unescaped, `.` would match any character and redact "abcd" too.
    expect(redactSecrets('a.cd and abcd', ['a.cd'])).toBe(
      `${REDACTED} and abcd`,
    )
  })

  it('escapes a password full of regex metacharacters', () => {
    const password = 'p*ss[w]ord+$'
    expect(redactSecrets(`typed ${password} ok`, [password])).toBe(
      `typed ${REDACTED} ok`,
    )
  })

  it('ignores secrets too short to redact safely', () => {
    // Redacting "abc" would scribble over ordinary prose.
    expect(redactSecrets('abc is everywhere', ['abc'])).toBe('abc is everywhere')
  })

  it('returns the text unchanged when there are no secrets', () => {
    expect(redactSecrets('nothing to hide', [])).toBe('nothing to hide')
  })
})

describe('redactDeep', () => {
  it('walks nested objects and arrays', () => {
    const input = {
      message: 'login failed for s3cret-value',
      steps: [{ actual: 'typed s3cret-value' }],
      count: 2,
    }
    expect(redactDeep(input, ['s3cret-value'])).toEqual({
      message: `login failed for ${REDACTED}`,
      steps: [{ actual: `typed ${REDACTED}` }],
      count: 2,
    })
  })

  it('leaves binary payloads intact', () => {
    // A naive walk rebuilds a Uint8Array as {"0":137,...}, destroying every
    // screenshot that passes through the evidence store.
    const bytes = new Uint8Array([137, 80, 78, 71])
    const output = redactDeep(
      { body: { bytes, contentType: 'image/png' }, label: 'shot s3cret-value' },
      ['s3cret-value'],
    )

    expect(output.body.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(output.body.bytes)).toEqual([137, 80, 78, 71])
    expect(output.label).toBe(`shot ${REDACTED}`)
  })

  it('is a no-op when no secrets are registered', () => {
    const input = { a: 'b' }
    expect(redactDeep(input, [])).toBe(input)
  })
})
