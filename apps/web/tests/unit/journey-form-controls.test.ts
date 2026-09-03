/**
 * Forms that are not only inputs and a submit button.
 *
 * The failure this file exists for is a real one, captured in a run against a
 * referral form: the agent filled the phone number, the test requested and the
 * clinical notes, then stopped, because the two controls it still had to
 * operate - a "Find" that resolves the patient and a "Pick a date" that opens
 * a calendar - are neither fields nor submits, and share no words with the
 * journey. The run reported "the application does not consider it complete",
 * which was true, and useless: the form was incomplete because the agent could
 * not complete it.
 */
import { describe, expect, it } from 'vitest'
import {
  chooseRevealed,
  findPrerequisiteControl,
  matchSampleValue,
  revealedElements,
  runJourney,
} from '@/server/agent/operator'
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
  url: 'https://app.example.com/referrals/new',
  title: 'New referral',
  status: 200,
  headings: [],
  elements: [],
  text: '',
  consoleErrors: [],
  networkErrors: [],
  ...patch,
})

const addReferral: DiscoveredJourney = {
  name: 'Add referral',
  goal: 'Add a referral for a patient',
  priority: 0.9,
  entryPath: '/referrals/new',
}

/**
 * The referral form, as the application actually behaves.
 *
 * The patient is resolved by a lookup, the date by a popover calendar, and the
 * submit button stays disabled until both have happened. Nothing here is
 * reachable by matching the journey's words against a label, which is the
 * whole point of the fixture.
 */
class ReferralFormExecutor implements BrowserExecutor {
  readonly kind = 'fetch' as const
  readonly sessionId = null
  readonly actions: string[] = []

  private phone = ''
  private test = ''
  private notes = ''
  private patient: string | null = null
  private date: string | null = null
  private calendarOpen = false
  private sent = false

  private observation(): PageObservation {
    if (this.sent) {
      return page({
        url: 'https://app.example.com/referrals',
        title: 'Referrals',
        headings: ['Referrals'],
        text: 'Referral sent.',
        elements: [element({ ref: 'back', role: 'link', name: 'Referrals', href: '/referrals' })],
      })
    }

    const form: PageElement[] = [
      element({ ref: 'phone', role: 'input', name: 'Phone number', inputType: 'tel', value: this.phone }),
      element({ ref: 'find', name: 'Find' }),
      ...(this.patient
        ? [element({ ref: 'patient', role: 'input', name: 'Patient', value: this.patient })]
        : []),
      element({ ref: 'test', role: 'input', name: 'Test requested', required: true, value: this.test }),
      element({ ref: 'notes', role: 'textarea', name: 'Clinical notes', value: this.notes }),
      element({ ref: 'date', name: this.date ?? 'Pick a date' }),
      element({
        ref: 'send',
        name: 'Send referral',
        disabled: !(this.patient && this.date),
      }),
      element({ ref: 'cancel', name: 'Cancel' }),
    ]

    // The calendar renders in a popover, so its cells only exist while open.
    const calendar: PageElement[] = this.calendarOpen
      ? [
          element({ ref: 'prev', name: 'Previous month' }),
          element({ ref: 'next', name: 'Next month' }),
          ...Array.from({ length: 30 }, (_, i) =>
            element({
              ref: `day-${i + 1}`,
              name: String(i + 1),
              // Everything before today is refused, as a booking form does.
              disabled: i + 1 < 15,
              current: i + 1 === 15,
            }),
          ),
        ]
      : []

    return page({ elements: [...form, ...calendar] })
  }

  private result(detail: string): ActionResult {
    return { ok: true, detail, observation: this.observation() }
  }

  async navigate(url: string) {
    this.actions.push(`navigate ${new URL(url).pathname}`)
    return this.result('Opened')
  }

  async readPage() {
    return this.observation()
  }

  async click(ref: string) {
    this.actions.push(`click ${ref}`)
    if (ref === 'find' && this.phone) this.patient = 'Nadia Okonjo'
    if (ref === 'date') this.calendarOpen = true
    if (ref.startsWith('day-')) {
      this.date = `September ${ref.slice(4)}, 2026`
      this.calendarOpen = false
    }
    return this.result('Clicked')
  }

  async fill(ref: string, value: string) {
    this.actions.push(`fill ${ref}=${value}`)
    if (ref === 'phone') this.phone = value
    if (ref === 'test') this.test = value
    if (ref === 'notes') this.notes = value
    return this.result('Filled')
  }

  async selectOption(ref: string, value: string) {
    this.actions.push(`select ${ref}=${value}`)
    return this.result('Chose')
  }

  async check(ref: string) {
    this.actions.push(`check ${ref}`)
    return this.result('Ticked')
  }

  async pressKey(key: PageKey) {
    this.actions.push(`key ${key}`)
    return this.result('Pressed')
  }

  async submit(ref: string) {
    this.actions.push(`submit ${ref}`)
    if (this.patient && this.date) this.sent = true
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

describe('a form whose submit is gated on more than typing', () => {
  it('resolves the lookup, picks a date, and submits', async () => {
    const executor = new ReferralFormExecutor()

    const run = await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('passed')

    // The two controls the journey could not name, in the order the form needs
    // them, and the day cell chosen from inside the popover.
    expect(executor.actions).toContain('click find')
    expect(executor.actions).toContain('click date')
    expect(executor.actions).toContain('click day-16')
    expect(executor.actions).toContain('submit send')
  })

  it('chooses the first date after today, not the first cell in the grid', async () => {
    const executor = new ReferralFormExecutor()
    await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    // Day 15 is today and days before it are refused. A journey that took the
    // first cell it could would book the past.
    expect(executor.actions).not.toContain('click day-1')
    expect(executor.actions).not.toContain('click day-15')
  })

  it('does not type over what the application filled in', async () => {
    const executor = new ReferralFormExecutor()
    await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    // The lookup put the patient there. Typing into it afterwards would undo
    // the step that had just been taken.
    expect(executor.actions.some((a) => a.startsWith('fill patient='))).toBe(false)
    // And nothing gets typed twice, however many times the loop comes round.
    const phoneFills = executor.actions.filter((a) => a.startsWith('fill phone='))
    expect(phoneFills).toHaveLength(1)
  })

  it('says what it worked through when the form still will not submit', async () => {
    /*
     * The same form, with a lookup that never resolves. The report has to name
     * the controls the run operated, or a reader cannot tell a form the agent
     * failed to complete from one the application will not accept.
     */
    class UnresolvableForm extends ReferralFormExecutor {
      override async click(ref: string) {
        // The lookup finds nobody, so the submit stays disabled forever.
        return ref === 'find' ? super.click('cancel') : super.click(ref)
      }
    }

    const executor = new UnresolvableForm()
    const run = await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('skipped')
    const last = run.steps.at(-1)?.actual ?? ''
    expect(last).toContain('"Send referral" is disabled')
    expect(last).toContain('Worked through')
    expect(last).toContain('Find')
  })
})

describe('a control the executor cannot operate', () => {
  /**
   * The fetch executor cannot activate anything that only works through
   * JavaScript, and a date picker is exactly that. Its refusal is a limit of
   * the run, not a defect in the application.
   */
  class ScriptlessExecutor extends ReferralFormExecutor {
    override async click(ref: string) {
      if (ref === 'date' || ref === 'find') {
        return {
          ok: false,
          detail: `"${ref}" is a scripted control. The fetch executor cannot activate it.`,
          observation: await this.readPage(),
        }
      }
      return super.click(ref)
    }
  }

  it('reports a journey it could not complete, not a bug it did not find', async () => {
    const run = await runJourney(
      new ScriptlessExecutor(),
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('skipped')
    expect(run.signal.consoleErrors).toHaveLength(0)
  })

  it('still fails when the application itself breaks on the way', async () => {
    class BrokenPicker extends ReferralFormExecutor {
      override async click(ref: string) {
        const result = await super.click(ref)
        return ref === 'find'
          ? {
              ...result,
              ok: false,
              observation: {
                ...result.observation,
                consoleErrors: ['TypeError: patients.find is not a function'],
              },
            }
          : result
      }
    }

    const run = await runJourney(
      new BrokenPicker(),
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    expect(run.outcome).toBe('failed')
    expect(run.signal.consoleErrors).toContain(
      'TypeError: patients.find is not a function',
    )
  })
})

describe('typed fields', () => {
  /** A page that never changes, so the fills can be inspected on their own. */
  class RecordingExecutor implements BrowserExecutor {
    readonly kind = 'fetch' as const
    readonly sessionId = null
    readonly actions: string[] = []

    constructor(
      private readonly observation: PageObservation,
      private readonly fillOk = true,
    ) {}

    private result(detail: string, ok = true): ActionResult {
      return { ok, detail, observation: this.observation }
    }

    async navigate() {
      return this.result('Opened')
    }
    async readPage() {
      return this.observation
    }
    async click(ref: string) {
      this.actions.push(`click ${ref}`)
      return this.result('Clicked')
    }
    async fill(ref: string, value: string) {
      this.actions.push(`fill ${ref}=${value}`)
      return this.fillOk
        ? this.result('Filled')
        : this.result(`"${ref}" did not accept "${value}": the field is still empty.`, false)
    }
    async selectOption(ref: string, value: string) {
      this.actions.push(`select ${ref}=${value}`)
      return this.result('Chose')
    }
    async check(ref: string) {
      this.actions.push(`check ${ref}`)
      return this.result('Ticked')
    }
    async pressKey(key: PageKey) {
      this.actions.push(`key ${key}`)
      return this.result('Pressed')
    }
    async submit(ref: string) {
      this.actions.push(`submit ${ref}`)
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

  it('gives a date input a date', async () => {
    // The failure this guards against: a date input was filled with "Forge
    // verification", kept nothing, and the form sat behind a disabled submit
    // with no indication of why.
    const executor = new RecordingExecutor(
      page({
        elements: [
          element({ ref: 'when', role: 'input', name: 'Preferred date', inputType: 'date', value: '' }),
          element({ ref: 'save', name: 'Save' }),
        ],
      }),
    )

    await runJourney(executor, 'https://app.example.com', addReferral, new Budget(DEFAULT_BUDGET))

    const fill = executor.actions.find((a) => a.startsWith('fill when='))
    expect(fill).toMatch(/^fill when=\d{4}-\d{2}-\d{2}$/)
  })

  it('chooses a real option in a select, not its placeholder', async () => {
    const executor = new RecordingExecutor(
      page({
        elements: [
          element({
            ref: 'kind',
            role: 'select',
            name: 'Test requested',
            value: '',
            options: ['Select a test', 'Blood test', 'X-ray'],
          }),
          element({ ref: 'save', name: 'Save' }),
        ],
      }),
    )

    await runJourney(executor, 'https://app.example.com', addReferral, new Budget(DEFAULT_BUDGET))

    expect(executor.actions).toContain('select kind=Blood test')
  })

  it('ticks the box the form requires and leaves the rest alone', async () => {
    const executor = new RecordingExecutor(
      page({
        elements: [
          element({ ref: 'terms', role: 'checkbox', name: 'I agree to the terms', checked: false }),
          element({ ref: 'archived', role: 'checkbox', name: 'Show archived', checked: false }),
          element({ ref: 'notes', role: 'input', name: 'Clinical notes', value: '' }),
          element({ ref: 'save', name: 'Save' }),
        ],
      }),
    )

    await runJourney(executor, 'https://app.example.com', addReferral, new Budget(DEFAULT_BUDGET))

    expect(executor.actions).toContain('check terms')
    // Ticking every box on a page changes filters and settings nobody asked to
    // change, and none of it is what the journey was about.
    expect(executor.actions).not.toContain('check archived')
  })

  it('records a rejected fill as unattempted rather than as a defect', async () => {
    const executor = new RecordingExecutor(
      page({
        elements: [
          element({ ref: 'when', role: 'input', name: 'Preferred date', inputType: 'date', required: true, value: '' }),
          element({ ref: 'save', name: 'Save', disabled: true }),
        ],
      }),
      false,
    )

    const run = await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
    )

    const fill = run.steps.find((s) => s.action === 'Fill')
    expect(fill?.status).toBe('skipped')

    // Retrying a value the field already refused only spends the budget.
    expect(executor.actions.filter((a) => a.startsWith('fill when='))).toHaveLength(1)

    // And the field is named as empty, from the page rather than from what the
    // agent remembers typing into it.
    expect(run.steps.at(-1)?.actual).toContain('Preferred date')
  })
})

describe("values the project says are true of its application", () => {
  const field = (name: string, inputType?: string): PageElement =>
    element({ ref: 'f', role: 'input', name, inputType })

  it('matches a field by every word of the label', () => {
    const samples = [{ label: 'Phone number', value: '0244123456' }]
    expect(matchSampleValue(field('Phone number'), samples)).toBe('0244123456')
    expect(matchSampleValue(field('Patient phone number'), samples)).toBe('0244123456')
    // "number" alone is not what this is for.
    expect(matchSampleValue(field('Number of copies'), samples)).toBeNull()
    expect(matchSampleValue(field('Clinical notes'), samples)).toBeNull()
  })

  it('lets the more specific label win', () => {
    const samples = [
      { label: 'Phone', value: '0000000000' },
      { label: 'Referring phone', value: '0244123456' },
    ]
    expect(matchSampleValue(field('Referring phone'), samples)).toBe('0244123456')
    expect(matchSampleValue(field('Patient phone'), samples)).toBe('0000000000')
  })

  it('is not defeated by a plural', () => {
    expect(
      matchSampleValue(field('Order numbers'), [
        { label: 'Order number', value: 'ORD-4471' },
      ]),
    ).toBe('ORD-4471')
  })

  it('types the project value into the form instead of an invented one', async () => {
    /*
     * The failure this guards against: the referral form looks a patient up by
     * phone number, no number Forge invents will find one, and the journey
     * stops at a submit the application will not enable - correctly, and
     * uselessly.
     */
    const executor = new ReferralFormExecutor()

    await runJourney(
      executor,
      'https://app.example.com',
      addReferral,
      new Budget(DEFAULT_BUDGET),
      { sampleValues: [{ label: 'Phone number', value: '0244123456' }] },
    )

    expect(executor.actions).toContain('fill phone=0244123456')
    // Everything without a sample still gets a synthetic value.
    expect(executor.actions).toContain('fill notes=Forge verification')
  })
})

describe('finding what a form is waiting for', () => {
  const button = (name: string, patch: Partial<PageElement> = {}): PageElement =>
    element({ ref: name, role: 'button', name, ...patch })

  it('finds the control that opens a picker, and not the submit', () => {
    expect(
      findPrerequisiteControl([button('Send referral'), button('Pick a date')])?.name,
    ).toBe('Pick a date')
    expect(findPrerequisiteControl([button('Find')])?.name).toBe('Find')
    expect(findPrerequisiteControl([button('Search patients')])?.name).toBe(
      'Search patients',
    )
  })

  it('will not press something that leaves or undoes the form', () => {
    expect(findPrerequisiteControl([button('Cancel'), button('Delete')])).toBeNull()
    // "Save" and "Create" complete a form; they are not a step towards one.
    expect(findPrerequisiteControl([button('Save'), button('Create')])).toBeNull()
  })

  it('skips what is disabled or already worked through', () => {
    expect(findPrerequisiteControl([button('Pick a date', { disabled: true })])).toBeNull()
    expect(
      findPrerequisiteControl([button('Pick a date')], new Set(['button:pick a date'])),
    ).toBeNull()
  })
})

describe('choosing inside whatever opened', () => {
  const day = (n: number, patch: Partial<PageElement> = {}): PageElement =>
    element({ ref: `d${n}`, role: 'button', name: String(n), ...patch })

  it('reads a grid of day cells as a calendar and takes the day after today', () => {
    const grid = [
      ...Array.from({ length: 10 }, (_, i) => day(i + 1, { disabled: i + 1 < 5 })),
      day(11),
    ]
    grid[4] = day(5, { current: true })

    expect(chooseRevealed(grid)?.name).toBe('6')
  })

  it('does not mistake a single numbered button for a calendar', () => {
    // A page that revealed a "2" is not offering a date, and pressing it would
    // be a click the journey could not explain.
    expect(chooseRevealed([day(2), element({ ref: 'x', name: 'Close' })])).toBeNull()
  })

  it('answers a listbox with its first usable option', () => {
    expect(
      chooseRevealed([
        element({ ref: 'o1', role: 'option', name: 'Any', disabled: true }),
        element({ ref: 'o2', role: 'option', name: 'Blood test' }),
      ])?.name,
    ).toBe('Blood test')
  })
})

describe('what appeared after an action', () => {
  it('compares by role and name, because refs are handed out fresh', () => {
    const before = page({
      elements: [element({ ref: 'a1', name: 'Pick a date' })],
    })
    const after = page({
      elements: [
        // Same control, new ref: not something that appeared.
        element({ ref: 'b7', name: 'Pick a date' }),
        element({ ref: 'b8', role: 'button', name: '16' }),
      ],
    })

    const revealed = revealedElements(before, after)
    expect(revealed.map((e) => e.name)).toEqual(['16'])
  })
})
