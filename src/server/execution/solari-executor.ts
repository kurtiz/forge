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
  clickScript,
  fillScript,
  OBSERVE_SCRIPT,
  submitScript,
} from './page-script'
import {
  condenseText,
  ExecutorError,
  type ActionResult,
  type BrowserExecutor,
  type PageElement,
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

const SETTLE_MS = 900

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
  }

  /** Collects the runtime signals a finding is later judged against. */
  private recordEvent(method: string, params: Record<string, unknown>) {
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
    await settle()

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

  async fill(ref: string, value: string): Promise<ActionResult> {
    return this.act(ref, fillScript(ref, value), 'Typed into')
  }

  async submit(ref: string): Promise<ActionResult> {
    return this.act(ref, submitScript(ref), 'Submitted the form from')
  }

  private async act(
    ref: string,
    script: string,
    verb: string,
  ): Promise<ActionResult> {
    const name =
      this.lastObservation?.elements.find((e) => e.ref === ref)?.name ?? ref
    const outcome = await this.evaluate<string>(script)

    if (outcome === 'missing') {
      return {
        ok: false,
        detail: `"${name}" is no longer on the page.`,
        observation: await this.readPage(),
      }
    }

    await settle()
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
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
