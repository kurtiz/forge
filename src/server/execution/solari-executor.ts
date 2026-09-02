/**
 * Solari browser executor.
 *
 * Creates a recorded Solari session over the REST API, drives it over raw CDP,
 * and releases it in `close()`. Sessions are billable and concurrency is
 * capped by plan, so release is unconditional: the run engine calls `close()`
 * in a `finally`, including on cancellation.
 */
import { CdpConnection } from './cdp'
import {
  checkScript,
  clickScript,
  fillScript,
  OBSERVE_SCRIPT,
  selectScript,
  submitScript,
} from './page-script'
import {
  condenseText,
  ExecutorError,
  type ActionResult,
  type BrowserExecutor,
  type PageElement,
  type PageKey,
  type PageObservation,
  type Screenshot,
} from './types'
import { assertSafeTargetUrl } from '../security'

/**
 * The create-session response.
 *
 * Two fields are read defensively. The identifier is `sessionId` on the wire but
 * `id` on the SDKs' own `Session` type, and the published sources disagree about
 * which one the gateway returns, so both are accepted. `cdpEndpoint` is optional:
 * when the gateway omits it, the SDKs derive it from `wsEndpoint`.
 */
type SolariSessionResponse = {
  sessionId?: string
  id?: string
  wsEndpoint: string
  cdpEndpoint?: string
  expiresAt?: string
}

type SolariSession = {
  sessionId: string
  cdpEndpoint: string
}

export type SolariConfig = {
  apiKey: string
  baseUrl?: string
  recording?: boolean
  stealth?: boolean
}

const DEFAULT_BASE_URL = 'https://api.getsolari.com'

/**
 * The gateway contract, kept in one block so a correction is a one-place edit.
 * Paths are unversioned - verified against Solari's published SDKs, which use
 * `https://api.getsolari.com` with no version prefix.
 */
const ENDPOINTS = {
  create: '/sessions',
  replay: (id: string) => `/sessions/${encodeURIComponent(id)}/replay-url`,
  release: (id: string) => `/sessions/${encodeURIComponent(id)}`,
}

/**
 * How long the page is given to stop changing after an action.
 *
 * A fixed pause was the original approach and it was the wrong one. A sign-in
 * that posts credentials, waits for a response, and then redirects takes longer
 * than any pause anyone would want to hard-code, so the page was read while the
 * login form was still on screen and a successful sign-in was reported as a
 * rejected one. These bound a wait that ends when the page actually goes quiet.
 */
/** Minimum wait, so a synchronous DOM update is never read mid-write. */
const SETTLE_MIN_MS = 250
/** How long the network has to stay quiet before the page counts as settled. */
const SETTLE_QUIET_MS = 500
/** Hard ceiling. A page that never goes quiet is read as it stands. */
const SETTLE_MAX_MS = 8_000
/** Poll interval while waiting for quiet. */
const SETTLE_POLL_MS = 100

/**
 * The window the agent sees.
 *
 * A headless browser's default window is small, and a small window is a
 * different application: responsive layouts collapse navigation behind a menu,
 * move actions into overflow, and render fewer rows. Verifying that and calling
 * it the product would be a quiet lie, so the viewport is pinned to an ordinary
 * desktop size - which is also what makes a screenshot worth looking at.
 */
const VIEWPORT = { width: 1440, height: 900 }

type ObservedPayload = {
  url: string
  title: string
  headings: string[]
  elements: PageElement[]
  text: string
}

export class SolariBrowserExecutor implements BrowserExecutor {
  readonly kind = 'solari' as const

  private session: SolariSession | null = null
  private cdp: CdpConnection | null = null
  private cdpSessionId: string | null = null
  private lastObservation: PageObservation | null = null

  private consoleErrors: string[] = []
  private networkErrors: string[] = []
  private documentStatus = 0

  /** Requests started but not yet finished, from the CDP network events. */
  private inFlight = 0
  /** When the page last did anything. Drives the quiet-period wait. */
  private lastActivityAt = Date.now()

  private constructor(private readonly config: SolariConfig) {}

  get sessionId(): string | null {
    return this.session?.sessionId ?? null
  }

  static async create(config: SolariConfig): Promise<SolariBrowserExecutor> {
    const executor = new SolariBrowserExecutor(config)
    await executor.start()
    return executor
  }

  private get baseUrl() {
    return this.config.baseUrl ?? DEFAULT_BASE_URL
  }

  private async api(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      // Concurrency and plan limits are worth retrying later; a bad key is not.
      const retryable = response.status === 429 || response.status >= 500
      throw new ExecutorError(
        `Solari ${method} ${path} failed (${response.status}): ${detail.slice(0, 200)}`,
        retryable,
      )
    }
    return response
  }

  private async start() {
    const response = await this.api('POST', ENDPOINTS.create, {
      recording: this.config.recording ?? true,
      stealth: this.config.stealth ?? false,
    })
    const created = (await response.json()) as SolariSessionResponse
    const createdId = created.sessionId ?? created.id

    if (!createdId || !created.wsEndpoint) {
      throw new ExecutorError(
        'Solari create-session returned no session id or wsEndpoint.',
        false,
      )
    }

    this.session = {
      sessionId: createdId,
      // The gateway may omit the CDP endpoint; the SDKs derive it from the
      // WebSocket endpoint by swapping the path segment.
      cdpEndpoint: created.cdpEndpoint ?? created.wsEndpoint.replace('/ws/', '/cdp/'),
    }

    const cdp = new CdpConnection()
    await cdp.connect(this.session.cdpEndpoint)
    this.cdp = cdp

    const { targetId } = await cdp.send<{ targetId: string }>(
      'Target.createTarget',
      { url: 'about:blank' },
    )
    const { sessionId } = await cdp.send<{ sessionId: string }>(
      'Target.attachToTarget',
      { targetId, flatten: true },
    )
    this.cdpSessionId = sessionId

    cdp.onEvent((event) => this.recordEvent(event.method, event.params))

    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Network.enable', {}, sessionId)
    await cdp.send('Log.enable', {}, sessionId)

    /*
     * Not fatal if the provider will not take it: a run in the default window
     * is worse than one at desktop size, but far better than no run at all.
     */
    try {
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        {
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      )
    } catch {
      console.debug('[solari] viewport override refused; using the default window')
    }
  }

  /**
   * Marks the page as busy.
   *
   * Every network request, navigation, and load event pushes the quiet point
   * forward, which is what lets `settle` wait for a redirect chain to finish
   * instead of guessing how long one takes.
   */
  private touch() {
    this.lastActivityAt = Date.now()
  }

  /** Collects the runtime signals a finding is later judged against. */
  private recordEvent(method: string, params: Record<string, unknown>) {
    switch (method) {
      case 'Network.requestWillBeSent':
        this.inFlight++
        this.touch()
        break
      case 'Network.loadingFinished':
      case 'Network.loadingFailed':
        this.inFlight = Math.max(0, this.inFlight - 1)
        this.touch()
        break
      case 'Page.frameStartedLoading':
      case 'Page.frameNavigated':
      case 'Page.loadEventFired':
      case 'Page.domContentEventFired':
      case 'Page.frameStoppedLoading':
        this.touch()
        break
      default:
        break
    }

    if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails as
        | { text?: string; exception?: { description?: string } }
        | undefined
      const text = details?.exception?.description ?? details?.text
      if (text) this.consoleErrors.push(String(text).slice(0, 400))
      return
    }

    if (method === 'Runtime.consoleAPICalled') {
      if (params.type !== 'error') return
      const args = (params.args ?? []) as Array<{ value?: unknown; description?: string }>
      const text = args
        .map((a) => a.description ?? String(a.value ?? ''))
        .join(' ')
        .trim()
      if (text) this.consoleErrors.push(text.slice(0, 400))
      return
    }

    if (method === 'Log.entryAdded') {
      const entry = params.entry as { level?: string; text?: string } | undefined
      if (entry?.level === 'error' && entry.text) {
        this.consoleErrors.push(entry.text.slice(0, 400))
      }
      return
    }

    if (method === 'Network.loadingFailed') {
      const text = params.errorText
      if (typeof text === 'string' && params.canceled !== true) {
        this.networkErrors.push(text.slice(0, 200))
      }
      return
    }

    if (method === 'Network.responseReceived') {
      const response = params.response as { status?: number; url?: string } | undefined
      const status = response?.status ?? 0
      if (params.type === 'Document') {
        this.documentStatus = status
      }
      if (status >= 400 && response?.url) {
        this.networkErrors.push(`${status} ${new URL(response.url).pathname}`)
      }
    }
  }

  private get connection(): CdpConnection {
    if (!this.cdp || !this.cdpSessionId) {
      throw new ExecutorError('Solari session is not connected.', true)
    }
    return this.cdp
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const result = await this.connection.send<{
      result?: { value?: unknown }
      exceptionDetails?: { text?: string }
    }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      this.cdpSessionId!,
    )
    if (result.exceptionDetails) {
      throw new ExecutorError(
        `Page evaluation failed: ${result.exceptionDetails.text ?? 'unknown'}`,
        false,
      )
    }
    return result.result?.value as T
  }

  async navigate(url: string): Promise<ActionResult> {
    const target = assertSafeTargetUrl(url)
    this.resetSignals()

    await this.connection.send(
      'Page.navigate',
      { url: target.toString() },
      this.cdpSessionId!,
    )
    await this.settle()

    const observation = await this.readPage()
    return {
      ok: observation.status < 400 && !observation.transportError,
      detail: `Opened ${target.pathname}${target.search} (${observation.status || 'no status'})`,
      observation,
    }
  }

  async readPage(): Promise<PageObservation> {
    const raw = await this.evaluate<string>(OBSERVE_SCRIPT)
    const payload = JSON.parse(raw) as ObservedPayload

    const observation: PageObservation = {
      url: payload.url,
      title: payload.title,
      status: this.documentStatus,
      headings: payload.headings,
      elements: payload.elements,
      text: condenseText(payload.text),
      consoleErrors: [...new Set(this.consoleErrors)].slice(0, 10),
      networkErrors: [...new Set(this.networkErrors)].slice(0, 10),
    }
    this.lastObservation = observation
    return observation
  }

  async click(ref: string): Promise<ActionResult> {
    return this.act(ref, clickScript(ref), 'Clicked')
  }

  /**
   * Types into a field, then reports what the field kept.
   *
   * The page-side script returns the value after the write, and an empty
   * result for a non-empty write means the control rejected it - the case a
   * date input makes silently, and the one that used to leave a run convinced
   * it had filled a field that was still blank.
   */
  async fill(ref: string, value: string): Promise<ActionResult> {
    return this.act(ref, fillScript(ref, value), 'Typed into', value)
  }

  async selectOption(ref: string, value: string): Promise<ActionResult> {
    return this.act(ref, selectScript(ref, value), 'Chose in', value)
  }

  async check(ref: string): Promise<ActionResult> {
    return this.act(ref, checkScript(ref), 'Turned on')
  }

  /**
   * Sends a key through CDP rather than a synthetic KeyboardEvent.
   *
   * An overlay is dismissed by the browser's own key handling as often as by
   * the page's, and a dispatched event is not the same thing to either.
   */
  async pressKey(key: PageKey): Promise<ActionResult> {
    const codes: Record<PageKey, number> = { Escape: 27, Enter: 13, Tab: 9 }
    try {
      for (const type of ['keyDown', 'keyUp'] as const) {
        await this.connection.send(
          'Input.dispatchKeyEvent',
          {
            type,
            key,
            code: key,
            windowsVirtualKeyCode: codes[key],
            nativeVirtualKeyCode: codes[key],
          },
          this.cdpSessionId!,
        )
      }
    } catch {
      return {
        ok: false,
        detail: `The page did not accept the ${key} key.`,
        observation: await this.readPage(),
      }
    }
    await this.settle()
    return {
      ok: true,
      detail: `Pressed ${key}.`,
      observation: await this.readPage(),
    }
  }

  async submit(ref: string): Promise<ActionResult> {
    return this.act(ref, submitScript(ref), 'Submitted the form from')
  }

  /**
   * Runs one page-side action and reads the page back.
   *
   * `wrote` is the value the action was supposed to leave behind. When it is
   * given, the script's `filled:<value>` answer is checked against it, so a
   * control that quietly discarded the input reports a failed action instead
   * of a successful one.
   */
  private async act(
    ref: string,
    script: string,
    verb: string,
    wrote?: string,
  ): Promise<ActionResult> {
    const element = this.lastObservation?.elements.find((e) => e.ref === ref)
    const name = element?.name ?? ref
    // Never quote back what was typed into a password field.
    const quoted =
      element?.inputType === 'password' ? 'what it was given' : `"${wrote ?? ''}"`
    const outcome = await this.evaluate<string>(script)

    if (outcome === 'missing') {
      return {
        ok: false,
        detail: `"${name}" is no longer on the page.`,
        observation: await this.readPage(),
      }
    }

    if (outcome === 'unmatched') {
      return {
        ok: false,
        detail: `"${name}" offers no option matching ${quoted}.`,
        observation: await this.readPage(),
      }
    }

    if (outcome === 'unchanged') {
      return {
        ok: false,
        detail: `"${name}" did not react.`,
        observation: await this.readPage(),
      }
    }

    if (wrote !== undefined && typeof outcome === 'string' && outcome.startsWith('filled:')) {
      const kept = outcome.slice('filled:'.length)
      if (wrote.trim() !== '' && kept.trim() === '') {
        return {
          ok: false,
          detail: `"${name}" did not accept ${quoted}: the field is still empty.`,
          observation: await this.readPage(),
        }
      }
    }

    await this.settle()
    const observation = await this.readPage()
    return {
      ok:
        observation.status < 400 &&
        observation.consoleErrors.length === 0 &&
        observation.networkErrors.length === 0,
      detail: `${verb} "${name}".`,
      observation,
    }
  }

  async screenshot(): Promise<Screenshot | null> {
    try {
      const result = await this.connection.send<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false },
        this.cdpSessionId!,
      )
      return { bytes: decodeBase64(result.data), contentType: 'image/png' }
    } catch {
      // A screenshot failing must not fail the journey it was documenting.
      return null
    }
  }

  async replayUrl(): Promise<string | null> {
    if (!this.session) return null
    try {
      const response = await this.api(
        'GET',
        ENDPOINTS.replay(this.session.sessionId),
      )
      const body = (await response.json()) as { url?: string }
      return body.url ?? null
    } catch {
      return null
    }
  }

  async close(): Promise<void> {
    this.cdp?.close()
    this.cdp = null
    this.cdpSessionId = null

    if (!this.session) return
    try {
      await this.api('DELETE', ENDPOINTS.release(this.session.sessionId))
    } catch {
      // The session also expires on its own; a failed release must not mask
      // whatever error is already unwinding the run.
    }
  }

  private resetSignals() {
    this.consoleErrors = []
    this.networkErrors = []
    this.documentStatus = 0
    // In-flight requests are deliberately not reset: a request still running
    // from before the action is still a reason to keep waiting.
    this.touch()
  }

  /**
   * Waits for the page to stop changing.
   *
   * Quiet means no request has started or finished for `SETTLE_QUIET_MS` and
   * nothing is in flight. Capped, because a page that polls forever never goes
   * quiet and is better read as it stands than waited on indefinitely.
   */
  private async settle(): Promise<void> {
    const startedAt = Date.now()
    await sleep(SETTLE_MIN_MS)

    while (Date.now() - startedAt < SETTLE_MAX_MS) {
      const quietFor = Date.now() - this.lastActivityAt
      if (this.inFlight === 0 && quietFor >= SETTLE_QUIET_MS) return
      await sleep(SETTLE_POLL_MS)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
