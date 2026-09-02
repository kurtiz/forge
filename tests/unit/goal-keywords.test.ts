import { describe, expect, it } from 'vitest'
import { goalKeywords } from '#/server/agent/explorer'

describe('goalKeywords', () => {
  it('keeps the words that identify the feature', () => {
    // The failure this guards against: a project stating "Users should be able
    // to add referrals" produced a journey called "Load the entry page",
    // because the goal reached the model and nothing else.
    expect(goalKeywords('Users should be able to add referrals')).toEqual([
      'referrals',
    ])
  })

  it('drops the words every goal contains', () => {
    // "User" would otherwise match a "User settings" link on any page and send
    // the run somewhere nobody asked about.
    expect(goalKeywords('Users should be able to')).toEqual([])
  })

  it('handles no goal at all', () => {
    expect(goalKeywords(null)).toEqual([])
    expect(goalKeywords('')).toEqual([])
  })

  it('deduplicates and lowercases', () => {
    expect(goalKeywords('Checkout with a coupon, then checkout again')).toEqual([
      'checkout',
      'coupon',
      'again',
    ])
  })

  it('splits on punctuation rather than choking on it', () => {
    expect(goalKeywords('Invite/remove teammates')).toEqual([
      'invite',
      'remove',
      'teammates',
    ])
  })
})
