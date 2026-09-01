/**
 * Execution abstraction.
 *
 * Forge owns this interface; Solari implements it. Nothing above this layer
 * knows which provider is running, which is what lets a run fall back to the
 * fetch executor when no Solari credentials are configured, and what would let
 * a second provider be added without touching the agent.
 */

/** A single interactive element the agent is allowed to target. */
export type PageElement = {
  /** Stable handle the executor resolves back to a real element. */
  ref: string
  role: 'button' | 'link' | 'input' | 'select' | 'textarea'
  /** Accessible name, or the closest thing the page offers. */
  name: string
  /** For links and form actions: where activating it goes. */
  href?: string
  inputType?: string
  required?: boolean
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

export interface BrowserExecutor {
  readonly kind: ExecutorKind
  /** Provider session id, when the provider has one. */
  readonly sessionId: string | null

  navigate(url: string): Promise<ActionResult>
  readPage(): Promise<PageObservation>
  click(ref: string): Promise<ActionResult>
  fill(ref: string, value: string): Promise<ActionResult>
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
