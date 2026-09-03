import { describe, expect, it } from 'vitest'
import { resolvePreviewTemplate, slugifyBranch } from '@/server/github/preview-url'

const CONTEXT = {
  number: 42,
  branch: 'feat/Invite-Teammates',
  sha: '0123456789abcdef0123456789abcdef01234567',
}

describe('resolvePreviewTemplate', () => {
  it('substitutes every placeholder', () => {
    expect(
      resolvePreviewTemplate(
        'https://pr-{number}--{branch}.example.pages.dev/{sha7}',
        CONTEXT,
      ),
    ).toBe(
      'https://pr-42--feat-invite-teammates.example.pages.dev/0123456',
    )
  })

  it('returns null when there is no template', () => {
    expect(resolvePreviewTemplate(null, CONTEXT)).toBeNull()
  })

  it('returns null rather than a URL with a hole in it', () => {
    // A deployment event carries no pull request number. Producing
    // "https://pr-.example.dev" would send a browser somewhere real and wrong.
    expect(
      resolvePreviewTemplate('https://pr-{number}.example.dev', {
        ...CONTEXT,
        number: null,
      }),
    ).toBeNull()
  })

  it('leaves a template with no placeholders alone', () => {
    expect(
      resolvePreviewTemplate('https://staging.example.com', CONTEXT),
    ).toBe('https://staging.example.com')
  })
})

describe('slugifyBranch', () => {
  it('produces a hostname label', () => {
    expect(slugifyBranch('feat/Invite Teammates')).toBe('feat-invite-teammates')
    expect(slugifyBranch('release/v1.2.3')).toBe('release-v1-2-3')
    expect(slugifyBranch('--weird--')).toBe('weird')
  })

  it('stays within a DNS label', () => {
    expect(slugifyBranch('x'.repeat(200))).toHaveLength(63)
  })
})
