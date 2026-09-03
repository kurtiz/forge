import { describe, expect, it } from 'vitest'
import { findSubmitControl, runJourney } from '@/server/agent/operator'
import { Budget } from '@/server/domain/budget'
import { DEFAULT_BUDGET, type DiscoveredJourney } from '@/server/contracts'
import type {
  ActionResult,
  BrowserExecutor,
  PageElement,
  PageKey,
  PageObservation,
} from '@/server/execution/types'

const element = (patch: Partial<PageElement> & { ref: string }): PageElement => ({
  role: 'button',
  name: 'Button',
  ...patch,
})

const page = (patch: Partial<PageObservation>): PageObservation => ({
  url: 'https://app.example.com/',
  title: 'App',
  status: 200,
  headings: [],
  elements: [],
  text: '',
  consoleErrors: [],
  networkErrors: [],
  ...patch,
})

/**
 * An application with more than one page.
 *
 * Activating a control moves to the next page, which is what a real journey
 * does and what a single-action operator could never follow.
 */
class WalkingExecutor implements BrowserExecutor {
  readonly kind = 'fetch' as const
  readonly sessionId = null
  readonly actions: string[] = []

  private index = 0

  constructor(private readonly pages: PageObservation[]) {}

  private get current(): PageObservation {
    return this.pages[Math.min(this.index, this.pages.length - 1)]
  }

  private advance(detail: string): ActionResult {
    this.index = Math.min(this.index + 1, this.pages.length - 1)
    return { ok: true, detail, observation: this.current }
  }

  async navigate(url: string) {
    this.actions.push(`navigate ${new URL(url).pathname}`)
    return { ok: true, detail: `Opened ${url}`, observation: this.current }
  }
  async readPage() {
    return this.current
  }
  async click(ref: string) {
    this.actions.push(`click ${ref}`)
    return this.advance('Clicked')
  }
  async fill(ref: string, value: string) {
    this.actions.push(`fill ${ref}=${value}`)
    return { ok: true, detail: 'Filled', observation: this.current }
  }
  async selectOption(ref: string, value: string) {
    this.actions.push(`select ${ref}=${value}`)
    return { ok: true, detail: 'Chose', observation: this.current }
  }
  async check(ref: string) {
    this.actions.push(`check ${ref}`)
    return { ok: true, detail: 'Ticked', observation: this.current }
  }
  async pressKey(key: PageKey) {
    this.actions.push(`key ${key}`)
    return { ok: true, detail: `Pressed ${key}`, observation: this.current }
  }
  async submit(ref: string) {
    this.actions.push(`submit ${ref}`)
    return this.advance('Submitted')
  }
  async screenshot() {
    return null
  }
  async replayUrl() {
    return null
  }
  async close() {}
}

const addReferral: DiscoveredJourney = {
  name: 'Add referral',
  goal: 'Add a referral for a patient',
  priority: 0.9,
  entryPath: '/referrals',
}

describe('runJourney, multi-step', () => {
  it('walks a list, opens the form, fills it and submits it', async () => {
    /*
     * The failure this guards against: a single action stopped at whichever of
     * these steps came first and reported a pass for having got there. Opening
     * the form is not adding a referral.
     */
    const executor = new WalkingExecutor([
      page({
        url: 'https://app.example.com/referrals',
        elements: [element({ ref: 'new', name: 'New referral' })],
      }),
      page({
        url: 'https://app.example.com/referrals/new',
        title: 'New referral',
        elements: [
          element({ ref: 'patient', role: 'input', name: 'Patient name' }),
          // Named nothing like the journey, which is the normal case.
          element({ ref: 'save', name: 'Save' }),
        ],
      }),
      page({
        url: 'https://app.example.com/referrals',
        title: 'Referrals',
        elements: [element({ ref: 'done', role: 'link', name: 'Back' })],
      }),
    ])

    const run = await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('passed')
    expect(executor.actions).toEqual([
      'navigate /referrals',
      'click new',
      'fill patient=Nadia Okonjo',
      'submit save',
    ])
    // The verdict has to say the form was submitted, not merely reached.
    expect(run.steps.at(-1)?.actual).toContain('Submitted and settled')
  })

  it('stops when the application does not react', async () => {
    // One page that never changes: clicking a second control would wander away
    // from the journey rather than advance it.
    const stuck = page({
      url: 'https://app.example.com/referrals',
      elements: [
        element({ ref: 'a', name: 'Add referral' }),
        element({ ref: 'b', name: 'Referral archive' }),
      ],
    })

    const executor = new WalkingExecutor([stuck])
    const run = await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('passed')
    expect(executor.actions.filter((a) => a.startsWith('click'))).toHaveLength(1)
  })

  it('fails the moment a step breaks, without walking on', async () => {
    const executor = new WalkingExecutor([
      page({
        url: 'https://app.example.com/referrals',
        elements: [element({ ref: 'new', name: 'New referral' })],
      }),
      page({
        url: 'https://app.example.com/referrals/new',
        status: 500,
        consoleErrors: ['TypeError: cannot read properties of undefined'],
        elements: [element({ ref: 'save', name: 'Create referral' })],
      }),
    ])

    const run = await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('failed')
    expect(run.signal.consoleErrors).toHaveLength(1)
    expect(executor.actions).toEqual(['navigate /referrals', 'click new'])
  })

  it('never activates the same control twice', async () => {
    const executor = new WalkingExecutor([
      page({
        url: 'https://app.example.com/referrals',
        elements: [element({ ref: 'only', name: 'Add referral' })],
      }),
      page({
        url: 'https://app.example.com/referrals?added=1',
        title: 'Referrals',
        elements: [element({ ref: 'only', name: 'Add referral' })],
      }),
    ])

    await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(executor.actions.filter((a) => a === 'click only')).toHaveLength(1)
  })
})

describe('findSubmitControl', () => {
  const button = (name: string): PageElement =>
    element({ ref: name, role: 'button', name })

  it('finds the button that submits, whatever the journey is called', () => {
    // The failure this guards against: a run filled three fields on a referral
    // form and then passed without submitting, because "Save" shares no words
    // with "Add referral".
    expect(findSubmitControl([button('Save')])?.name).toBe('Save')
    expect(findSubmitControl([button('Create referral')])?.name).toBe(
      'Create referral',
    )
  })

  it('will not press a button that throws the work away', () => {
    expect(findSubmitControl([button('Cancel'), button('Delete')])).toBeNull()
    expect(
      findSubmitControl([button('Discard'), button('Submit')])?.name,
    ).toBe('Submit')
  })

  it('ignores links, and anything already used', () => {
    expect(
      findSubmitControl([element({ ref: 'l', role: 'link', name: 'Save' })]),
    ).toBeNull()
    expect(findSubmitControl([button('Save')], new Set(['Save']))).toBeNull()
  })

  it('guesses at nothing it cannot identify', () => {
    expect(findSubmitControl([button('Options'), button('More')])).toBeNull()
  })
})

describe('matching a control to a journey', () => {
  it('follows a plural link towards a singular journey', async () => {
    /*
     * The failure this guards against: "Add referral" could not match the
     * "Referrals" link that leads to the page where referrals are added, so
     * the journey was skipped on the dashboard it started from.
     */
    const executor = new WalkingExecutor([
      page({
        url: 'https://app.example.com/dashboard',
        elements: [element({ ref: 'nav', role: 'link', name: 'Referrals', href: '/referrals' })],
      }),
      page({
        url: 'https://app.example.com/referrals',
        title: 'Referrals',
        elements: [element({ ref: 'new', name: 'New referral' })],
      }),
      page({
        url: 'https://app.example.com/referrals/new',
        title: 'New referral',
        elements: [
          element({ ref: 'patient', role: 'input', name: 'Patient name' }),
          element({ ref: 'save', name: 'Save' }),
        ],
      }),
      page({
        url: 'https://app.example.com/referrals',
        title: 'Referrals',
        elements: [element({ ref: 'back', role: 'link', name: 'Back' })],
      }),
    ])

    const run = await runJourney(
      executor,
      'https://app.example.com',
      { ...addReferral, entryPath: '/dashboard' },
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('passed')
    expect(executor.actions).toEqual([
      'navigate /dashboard',
      'click nav',
      'click new',
      'fill patient=Nadia Okonjo',
      'submit save',
    ])
  })

  it('still refuses a word that merely contains the journey word', async () => {
    const executor = new WalkingExecutor([
      page({
        url: 'https://app.example.com/referrals',
        elements: [element({ ref: 'chip', name: 'JB Joey Benson Referring doctor' })],
      }),
    ])

    const run = await runJourney(
      executor,
      'https://app.example.com',
      { ...addReferral, entryPath: '/referrals' },
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('skipped')
  })
})
