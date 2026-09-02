import { describe, expect, it } from 'vitest'
import { runJourney } from '#/server/agent/operator'
import { Budget } from '#/server/domain/budget'
import { summariseRun } from '#/server/domain/analysis'
import { DEFAULT_BUDGET, type DiscoveredJourney } from '#/server/contracts'
import type {
  ActionResult,
  BrowserExecutor,
  PageElement,
  PageObservation,
} from '#/server/execution/types'

const page = (patch: Partial<PageObservation> = {}): PageObservation => ({
  url: 'https://app.example.com/',
  title: 'Example',
  status: 200,
  headings: [],
  elements: [],
  text: '',
  consoleErrors: [],
  networkErrors: [],
  ...patch,
})

const element = (patch: Partial<PageElement> & { ref: string }): PageElement => ({
  role: 'button',
  name: 'Button',
  ...patch,
})

/** Answers every action with the same page, which is what an empty site does. */
class StubExecutor implements BrowserExecutor {
  readonly kind = 'fetch' as const
  readonly sessionId = null
  /** Values typed into the page, so a test can assert nothing was typed. */
  readonly filled: Array<{ ref: string; value: string }> = []

  constructor(private readonly observation: PageObservation) {}

  private result(detail: string): ActionResult {
    return { ok: true, detail, observation: this.observation }
  }

  async navigate(url: string) {
    return this.result(`Opened ${url}`)
  }
  async readPage() {
    return this.observation
  }
  async click() {
    return this.result('Clicked')
  }
  async fill(ref: string, value: string) {
    this.filled.push({ ref, value })
    return this.result('Filled')
  }
  async submit() {
    return this.result('Submitted')
  }
  async screenshot() {
    return null
  }
  async replayUrl() {
    return null
  }
  async close() {}
}

const journey: DiscoveredJourney = {
  name: 'Complete checkout',
  goal: 'Buy an item with a coupon applied',
  priority: 0.9,
  entryPath: '/',
}

describe('runJourney', () => {
  it('skips rather than passes when nothing on the page matches', async () => {
    // The failure this guards against: a page with no matching control used to
    // return passed, so a run that exercised nothing reported the application
    // working.
    const run = await runJourney(
      new StubExecutor(page({ elements: [] })),
      'https://app.example.com',
      journey,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('skipped')
    expect(run.steps.at(-1)?.status).toBe('skipped')
  })

  it('fails when a sign-in form is standing in the way', async () => {
    const run = await runJourney(
      new StubExecutor(
        page({
          elements: [
            element({ ref: 'e1', role: 'input', name: 'Email', inputType: 'email' }),
            element({
              ref: 'e2',
              role: 'input',
              name: 'Password',
              inputType: 'password',
            }),
          ],
        }),
      ),
      'https://app.example.com',
      journey,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('failed')
    expect(run.signal.authWall).toBe(true)
  })

  it('refuses to type invented credentials into a login form', async () => {
    /*
     * The failure this guards against: the Operator filled a signed-in session's
     * login form with synthetic values, which at best wastes the run and at
     * worst signs it out or trips the account's lockout.
     */
    const executor = new StubExecutor(
      page({
        url: 'https://app.example.com/login',
        elements: [
          element({ ref: 'e1', role: 'input', name: 'Email', inputType: 'email' }),
          element({
            ref: 'e2',
            role: 'input',
            name: 'Password',
            inputType: 'password',
          }),
          element({ ref: 'e3', name: 'Sign in' }),
        ],
      }),
    )

    const run = await runJourney(
      executor,
      'https://app.example.com',
      journey,
      new Budget(DEFAULT_BUDGET),
      { authenticated: true },
    )

    expect(run.outcome).toBe('failed')
    expect(run.signal.staleAuth).toBe(true)
    expect(executor.filled).toEqual([])
    expect(run.steps.at(-1)?.actual).toContain('already signed in')
  })

  it('still fills a sign-up form on a run that is not signed in', async () => {
    const executor = new StubExecutor(
      page({
        url: 'https://app.example.com/signup',
        elements: [
          element({ ref: 'e1', role: 'input', name: 'Email', inputType: 'email' }),
          element({
            ref: 'e2',
            role: 'input',
            name: 'Password',
            inputType: 'password',
          }),
          element({ ref: 'e3', name: 'Create account' }),
        ],
      }),
    )

    await runJourney(
      executor,
      'https://app.example.com',
      {
        name: 'Create an account',
        goal: 'Register a new account with an email and password',
        priority: 0.8,
        entryPath: '/signup',
      },
      new Budget(DEFAULT_BUDGET),
    )

    expect(executor.filled.length).toBe(2)
  })

  it('does not treat a word that merely contains the journey word as a match', async () => {
    /*
     * The failure this guards against: "Refer a patient" clicked a profile chip
     * reading "Joey Benson Referring doctor", then reported a pass for having
     * opened a menu.
     */
    const run = await runJourney(
      new StubExecutor(
        page({
          elements: [
            element({ ref: 'e1', name: 'JB\nJoey Benson\nReferring doctor' }),
          ],
        }),
      ),
      'https://app.example.com',
      {
        name: 'Refer a patient',
        goal: 'Refer a patient to the diagnostic centre',
        priority: 0.9,
        entryPath: '/',
      },
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('skipped')
  })

  it('ignores a label the journey only partly accounts for', async () => {
    const run = await runJourney(
      new StubExecutor(
        page({
          elements: [
            element({ ref: 'e1', name: 'JB Joey Benson Referring doctor' }),
          ],
        }),
      ),
      'https://app.example.com',
      {
        name: 'View all referrals',
        goal: 'See every referral made by the referring doctor',
        priority: 0.7,
        entryPath: '/',
      },
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('skipped')
  })

  it('still matches a short label on a single word', async () => {
    const run = await runJourney(
      new StubExecutor(
        page({ elements: [element({ ref: 'e1', name: 'Referrals' })] }),
      ),
      'https://app.example.com',
      {
        name: 'View all referrals',
        goal: 'See every referral made by the referring doctor',
        priority: 0.7,
        entryPath: '/',
      },
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('passed')
  })

  it('passes when the matching control is there and nothing breaks', async () => {
    const run = await runJourney(
      new StubExecutor(
        page({ elements: [element({ ref: 'e1', name: 'Checkout now' })] }),
      ),
      'https://app.example.com',
      journey,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('passed')
  })
})

describe('summariseRun', () => {
  it('reserves "no failures detected" for a run that exercised something', () => {
    expect(
      summariseRun({
        total: 6,
        passed: 6,
        failed: 0,
        skipped: 0,
        findings: 0,
        authFailed: false,
      }),
    ).toBe('6 of 6 journeys passed. No failures detected.')
  })

  it('never claims a clean run when nothing could be attempted', () => {
    const summary = summariseRun({
      total: 1,
      passed: 0,
      failed: 0,
      skipped: 1,
      findings: 0,
      authFailed: false,
    })

    expect(summary).toContain('could not be attempted')
    expect(summary).not.toContain('No failures detected')
  })

  it('says so when the sign-in did not work', () => {
    const summary = summariseRun({
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
      findings: 1,
      authFailed: true,
    })

    expect(summary).toContain('could not sign in')
    expect(summary).not.toContain('No failures detected')
  })

  it('reports an entry page that offered nothing', () => {
    expect(
      summariseRun({
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        findings: 0,
        authFailed: false,
      }),
    ).toBe('No journeys were discovered on the entry page.')
  })
})
