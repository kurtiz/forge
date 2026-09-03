import { describe, expect, it } from 'vitest'
import {
  signPayload,
  timingSafeEqual,
  verifySignature,
} from '@/server/github/signature'

const SECRET = 'webhook-secret'
const PAYLOAD = JSON.stringify({ action: 'opened', number: 7 })

describe('verifySignature', () => {
  it('accepts a correctly signed delivery', async () => {
    const signature = await signPayload(PAYLOAD, SECRET)
    expect(await verifySignature(PAYLOAD, signature, SECRET)).toBe(true)
  })

  it('rejects a delivery signed with a different secret', async () => {
    const signature = await signPayload(PAYLOAD, 'someone-elses-secret')
    expect(await verifySignature(PAYLOAD, signature, SECRET)).toBe(false)
  })

  it('rejects a tampered body', async () => {
    // The whole point: the endpoint is public, so a body that changed after
    // signing must not be able to start a run.
    const signature = await signPayload(PAYLOAD, SECRET)
    const tampered = JSON.stringify({ action: 'opened', number: 8 })
    expect(await verifySignature(tampered, signature, SECRET)).toBe(false)
  })

  it('rejects a missing or malformed header', async () => {
    expect(await verifySignature(PAYLOAD, null, SECRET)).toBe(false)
    expect(await verifySignature(PAYLOAD, 'sha1=abc', SECRET)).toBe(false)
    expect(await verifySignature(PAYLOAD, 'garbage', SECRET)).toBe(false)
  })

  it('rejects everything when no secret is configured', async () => {
    // A deployment without the webhook secret must fail closed, not open, and
    // it must not reach WebCrypto with an empty key either.
    const signature = await signPayload(PAYLOAD, SECRET)
    expect(await verifySignature(PAYLOAD, signature, '')).toBe(false)
  })
})

describe('timingSafeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'ab')).toBe(false)
  })
})
