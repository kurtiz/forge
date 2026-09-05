/**
 * Execution abstraction.
 *
 * Forge owns this interface; Solari implements it. Nothing above this layer
 * knows which provider is running, which is what lets a run fall back to the
 * fetch executor when no Solari credentials are configured, and what would let
 * a second provider be added without touching the agent.
 */

/**
 * What kind of thing a control is.
 *
 * `option` and `checkbox` are here because a modern form is not only inputs
 * and buttons. A listbox item inside a popover and a consent checkbox each
 * need an interaction that typing cannot express, and a page model that calls
 * them both "button" leaves the agent guessing which of them it may press.
 */
export type ElementRole =
  | 'button'
  | 'link'
  | 'input'
  | 'select'
  | 'textarea'
  | 'option'
  | 'checkbox'

/** A single interactive element the agent is allowed to target. */
export type PageElement = {
  /** Stable handle the executor resolves back to a real element. */
  ref: string
  role: ElementRole
  /** Accessible name, or the closest thing the page offers. */
  name: string
  /** For links and form actions: where activating it goes. */
  href?: string
  inputType?: string
  required?: boolean
  /**
   * Present and true when the page renders the control but will not let it be
   * used. Reported rather than hidden: "the submit button is disabled" is a
   * finding, and "there is no submit button" is a different and wrong one.
   */
  disabled?: boolean
  /**
   * What the control currently holds.
   *
   * Without it a fill cannot be checked: a date input silently rejects a value
   * it cannot parse, the page reports nothing, and the run goes on believing
   * it filled a field that is still empty. It is also how a required field
   * that was never filled gets named in a report, rather than inferred from
   * which refs the agent happens to have typed into.
   */
  value?: string
  /** For checkboxes, switches and radios: whether they are on. */
  checked?: boolean
  /** The labels a `select` offers, so one can be chosen by name. */
  options?: string[]
  /**
   * Carries `aria-current`. On a calendar that marks today, which is what lets
   * a journey choose a date in the future rather than whichever cell the grid
   * happens to render first.
   */
  current?: boolean
}

/** Compact page state. Never the raw HTML - that is captured as evidence. */
export type PageObservation = {
  url: string
  title: string
  status: number
  headings: string[]
  elements: PageElement[]
  /** Visible text, truncated. Enough for the model to judge what happened. */
  text: string
  consoleErrors: string[]
  networkErrors: string[]
  /** Set when the transport itself failed rather than the page. */
  transportError?: string
}

export type ActionResult = {
  ok: boolean
  /** Human-readable outcome, e.g. `Navigated to /checkout`. */
  detail: string
  observation: PageObservation
}

export type Screenshot = {
  bytes: Uint8Array
  contentType: string
}

export type ExecutorKind = 'solari' | 'fetch'

/**
 * What a run configures on its executor, beyond the provider's own credentials.
 *
 * `headers` is the project's verification header set - a secret that opens an
 * edge, most often a WAF rule that skips a bot challenge for whoever can
 * present it. It comes with `targetOrigin` and is meaningless without it: the
 * executor sends these headers to that origin and to nothing else, because a
 * target page is attacker-controlled and a journey follows the links it finds.
 * One link to another host would otherwise hand a stranger the key to the door.
 */
export type ExecutorOptions = {
  headers?: Readonly<Record<string, string>>
  /** Origin of the project's target URL. Required when `headers` is set. */
  targetOrigin?: string
}

/** The keys a journey is allowed to send. Deliberately a very short list. */
export type PageKey = 'Escape' | 'Enter' | 'Tab'

export interface BrowserExecutor {
  readonly kind: ExecutorKind
  /** Provider session id, when the provider has one. */
  readonly sessionId: string | null
  /**
   * Whether the run's verification headers are actually being sent.
   *
   * False only when a provider refused the mechanism that attaches them. The
   * run goes ahead without them, and the report has to say so - a run that
   * quietly stopped presenting its credential would be reported as an
   * application that started challenging its own verifier.
   */
  readonly headersAttached: boolean

  navigate(url: string): Promise<ActionResult>
  readPage(): Promise<PageObservation>
  click(ref: string): Promise<ActionResult>
  /**
   * Types into a field and reports whether the field kept the value. A fill
   * the page rejected is a failed action, not a silent one.
   */
  fill(ref: string, value: string): Promise<ActionResult>
  /** Chooses an option in a `select`, by option label or by value. */
  selectOption(ref: string, value: string): Promise<ActionResult>
  /** Turns a checkbox, radio or switch on. A control already on is left alone. */
  check(ref: string): Promise<ActionResult>
  /**
   * Sends a key to the page. Used to dismiss an overlay the journey opened and
   * found nothing to use in, so it cannot sit on top of the form afterwards.
   */
  pressKey(key: PageKey): Promise<ActionResult>
  submit(ref: string): Promise<ActionResult>
  screenshot(): Promise<Screenshot | null>
  /** Replay URL for the session, once it is released. */
  replayUrl(): Promise<string | null>
  close(): Promise<void>
}

export class ExecutorError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ExecutorError'
  }
}

/** Trims page text to a size that is honest but affordable to reason over. */
export function condenseText(input: string, limit = 1400): string {
  const collapsed = input.replace(/\s+/g, ' ').trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`
}
