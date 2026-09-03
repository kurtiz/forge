import { describe, expect, it } from 'vitest'
import {
  remediationFor,
  type RemediationInput,
} from '@/server/domain/remediation'

type Overrides = {
  finding?: Partial<RemediationInput['finding']>
  run?: RemediationInput['run']
  journey?: RemediationInput['journey']
  steps?: RemediationInput['steps']
  verificationHeaders?: readonly string[]
}

function input(over: Overrides = {}): RemediationInput {
  return {
    finding: {
      title: 'Checkout fails at payment',
      description: 'The order button returned HTTP 500.',
      failureClass: 'APPLICATION_BUG',
      severity: 'high',
      rootCause: null,
      affectedFiles: [],
      reproductionAttempts: 3,
      reproductionFailures: 3,
      ...over.finding,
    },
    run: { targetUrl: 'https://app.example.com', executor: 'solari', ...over.run },
    journey:
      over.journey === undefined
        ? { name: 'Complete checkout', goal: 'Buy one item', entryPath: '/cart' }
        : over.journey,
    steps: over.steps ?? [
      {
        action: 'Navigate',
        target: '/cart',
        expected: 'Page loads',
        actual: 'Opened /cart (200)',
        status: 'passed',
      },
      {
        action: 'Click',
        target: 'Place order',
        expected: 'The order is placed',
        actual: 'The page returned HTTP 500',
        status: 'failed',
      },
    ],
    verificationHeaders: over.verificationHeaders,
  }
}

describe('remediationFor an application defect', () => {
  it('hands the agent the evidence, not a conclusion', () => {
    const { prompt, owner } = remediationFor(input())
    expect(owner).toBe('application')
    expect(prompt).toContain('Complete checkout')
    expect(prompt).toContain('[FAIL] Click "Place order"')
    expect(prompt).toContain('Reproduced on 3 of 3 attempts')
  })

  it('forbids the two shortcuts that produce a green check over a live bug', () => {
    const { prompt } = remediationFor(input())
    expect(prompt).toContain('Do not change tests')
    expect(prompt).toContain('Do not special-case')
  })

  it('marks a root cause as a lead', () => {
    const { prompt } = remediationFor(
      input({ finding: { rootCause: 'The price is read before the cart loads' } }),
    )
    expect(prompt).toContain('a lead, not a conclusion')
  })

  it('says when no JavaScript ran, so an empty page is not read as a defect', () => {
    const { prompt } = remediationFor(
      input({ run: { targetUrl: 'https://app.example.com', executor: 'fetch' } }),
    )
    expect(prompt).toContain('HTTP executor')
  })

  it('leads with reproduction when the failure was intermittent', () => {
    const { headline } = remediationFor(
      input({
        finding: { reproductionAttempts: 3, reproductionFailures: 1 },
      }),
    )
    expect(headline).toContain('Reproduce it before changing anything')
  })
})

describe('remediationFor a bot challenge', () => {
  const blocked = {
    title: 'Cloudflare bot protection blocked the run',
    description:
      'Cloudflare answered app.example.com with a bot challenge ("Verify you are human") instead of the application.',
    failureClass: 'BOT_CHALLENGE' as const,
    severity: 'high' as const,
    rootCause: null,
    affectedFiles: [],
    reproductionAttempts: 1,
    reproductionFailures: 1,
  }

  const challenge = (verificationHeaders?: readonly string[]) =>
    remediationFor(
      input({ finding: blocked, journey: null, steps: [], verificationHeaders }),
    )

  it('sends the reader to the edge, not to the application code', () => {
    const remediation = challenge()
    expect(remediation.owner).toBe('infrastructure')
    expect(remediation.headline).toContain('Cloudflare')
    expect(remediation.prompt).toContain('app.example.com')
  })

  it('refuses the shortcut in the prompt itself', () => {
    // The agent reading this will otherwise reach for a solver or a stealth
    // flag, which is how a verification tool becomes something nobody can
    // safely point at their own site.
    const { prompt } = challenge()
    expect(prompt).toContain('Do not attempt to solve, bypass, or automate past')
    expect(prompt).toContain('No CAPTCHA solvers')
    expect(prompt).toContain('stealth')
  })

  it('says plainly that the application was not implicated', () => {
    expect(challenge().prompt).toContain(
      'not evidence of any defect in the application code',
    )
  })

  it('asks for the header first when the project sends none', () => {
    // A rule keyed on a header the verifier does not send matches nothing, so
    // the secret has to exist before the rule is worth writing.
    const remediation = challenge()
    expect(remediation.headline).toContain('verification header')
    expect(remediation.steps.join(' ')).toContain('Request headers')
    expect(remediation.prompt).toContain('sends no verification header')
  })

  it('names the header to match once the project sends one', () => {
    const remediation = challenge(['X-Forge-Verify'])
    expect(remediation.headline).toContain('X-Forge-Verify')
    expect(remediation.prompt).toContain('Forge already sends X-Forge-Verify')
    expect(remediation.prompt).toContain('Match on the header name AND its exact value')
  })

  it('names both headers when an access token needs two', () => {
    const remediation = challenge(['CF-Access-Client-Id', 'CF-Access-Client-Secret'])
    expect(remediation.prompt).toContain(
      'CF-Access-Client-Id, CF-Access-Client-Secret',
    )
  })

  it('refuses an allowlist a stranger could also satisfy', () => {
    // A user agent or a path is not a secret; a rule keyed on one lets every
    // scraper through the door it just opened.
    expect(challenge(['X-Forge-Verify']).prompt).toContain(
      'Do not key the rule on anything a stranger can also send',
    )
  })
})

describe('remediationFor everything else', () => {
  it('points a sign-in failure at the test account', () => {
    const remediation = remediationFor(
      input({
        finding: {
          title: 'Forge could not sign in',
          description: 'Still on a login form after signing in.',
          failureClass: 'AUTH_FAILURE',
          severity: 'high',
          rootCause: null,
          affectedFiles: [],
          reproductionAttempts: 1,
          reproductionFailures: 1,
        },
        journey: null,
        steps: [],
      }),
    )
    expect(remediation.owner).toBe('forge')
    expect(remediation.prompt).toContain('second factor')
  })

  it('offers no prompt when the run itself broke', () => {
    const remediation = remediationFor(
      input({
        finding: {
          title: 'The browser session ended',
          description: 'The executor lost its session.',
          failureClass: 'BROWSER_FAILURE',
          severity: 'low',
          rootCause: null,
          affectedFiles: [],
          reproductionAttempts: 0,
          reproductionFailures: 0,
        },
        journey: null,
        steps: [],
      }),
    )
    expect(remediation.owner).toBe('none')
    expect(remediation.prompt).toBeNull()
  })
})
