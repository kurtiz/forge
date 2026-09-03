/**
 * Fetch executor - the no-credentials fallback.
 *
 * Drives the target with real HTTP requests and parses responses with
 * HTMLRewriter. It follows links, fills forms, and submits them, and it sees
 * real status codes and real server errors. What it cannot do is run
 * JavaScript, so client-rendered pages and client-side failures are invisible
 * to it. Runs record which executor produced their evidence and the UI says so
 * plainly, because a finding is only as good as the fidelity behind it.
 */
import {
  condenseText,
  ExecutorError,
  type ActionResult,
  type BrowserExecutor,
  type ExecutorOptions,
  type PageElement,
  type PageKey,
  type PageObservation,
  type Screenshot,
} from './types'
import { assertSafeTargetUrl, headersForUrl } from '@/server/security'

type ParsedForm = {
  ref: string
  action: string
  method: 'GET' | 'POST'
  fields: Array<{ name: string; value: string; type: string }>
}

type ParsedPage = {
  title: string
  headings: string[]
  elements: PageElement[]
  forms: ParsedForm[]
  text: string
  /** ref -> which form the element belongs to. */
  fieldOwner: Map<string, { formRef: string; fieldName: string }>
  /**
   * ref of a `select` -> its options, label and submitted value both.
   *
   * The agent chooses by the label it can see; the form must be posted the
   * value the option carries, which is rarely the same string.
   */
  selectOptions: Map<string, Array<{ label: string; value: string }>>
}

const USER_AGENT =
  'Mozilla/5.0 (compatible; ForgeVerifier/1.0; +https://github.com/forge)'

const MAX_BODY_BYTES = 3 * 1024 * 1024

/** Statuses that carry a `Location` worth following. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

/** How many hops a single request may take before it is a loop. */
const MAX_REDIRECTS = 10

/**
 * Per-request ceiling. A target that never answers would otherwise stall the
 * run indefinitely: the run budget is only checked between journeys, so it
 * cannot rescue a single hanging request.
 */
const REQUEST_TIMEOUT_MS = 20_000

export class FetchBrowserExecutor implements BrowserExecutor {
  readonly kind = 'fetch' as const
  readonly sessionId = null
  /** This executor writes its own request headers; nothing can refuse them. */
  readonly headersAttached = true

  /**
   * The project's verification headers, and the only origin they may reach.
   *
   * Applied per request rather than once at construction, because this executor
   * follows links and a link can point anywhere. `headersForUrl` is what makes
   * the decision, and it decides on the URL that is about to be fetched.
   */
  private readonly extraHeaders: Readonly<Record<string, string>>
  private readonly targetOrigin: string | null

  constructor(options: ExecutorOptions = {}) {
    this.extraHeaders = options.headers ?? {}
    this.targetOrigin = options.targetOrigin ?? null
  }

  private cookies = new Map<string, string>()
  private current: PageObservation | null = null
  private parsed: ParsedPage | null = null
  /** Values typed by the agent, keyed by element ref. */
  private drafts = new Map<string, string>()

  async navigate(url: string): Promise<ActionResult> {
    const target = assertSafeTargetUrl(url)
    return this.request(target, 'GET')
  }

  async readPage(): Promise<PageObservation> {
    if (!this.current) {
      throw new ExecutorError('No page has been opened yet.', false)
    }
    return this.current
  }

  async click(ref: string): Promise<ActionResult> {
    const element = this.element(ref)

    if (element.role === 'link' && element.href) {
      // Re-validated: a link on the target page is attacker-controlled input.
      return this.request(assertSafeTargetUrl(this.resolve(element.href)), 'GET')
    }
    if (element.role === 'button') {
      const owner = this.parsed?.fieldOwner.get(ref)
      const form = owner
        ? this.parsed?.forms.find((f) => f.ref === owner.formRef)
        : this.parsed?.forms[0]
      if (form) return this.submitForm(form)
    }

    // A button with no form and no href only does something through JavaScript,
    // which this executor cannot run. Reporting that honestly matters more than
    // inventing a result.
    return {
      ok: false,
      detail: `"${element.name}" is a scripted control. The fetch executor cannot activate it.`,
      observation: await this.readPage(),
    }
  }

  async fill(ref: string, value: string): Promise<ActionResult> {
    const element = this.element(ref)
    this.drafts.set(ref, value)
    return {
      ok: true,
      detail: `Typed into "${element.name}".`,
      observation: await this.readPage(),
    }
  }

  async selectOption(ref: string, value: string): Promise<ActionResult> {
    const element = this.element(ref)
    const options = this.parsed?.selectOptions.get(ref) ?? []
    const wanted = value.trim().toLowerCase()
    const match =
      options.find((o) => o.label.toLowerCase() === wanted) ??
      options.find((o) => o.value.toLowerCase() === wanted) ??
      options.find((o) => o.label.toLowerCase().includes(wanted))

    if (!match) {
      return {
        ok: false,
        detail: `"${element.name}" offers no option matching "${value}".`,
        observation: await this.readPage(),
      }
    }

    this.drafts.set(ref, match.value || match.label)
    element.value = match.label
    return {
      ok: true,
      detail: `Chose "${match.label}" in "${element.name}".`,
      observation: await this.readPage(),
    }
  }

  async check(ref: string): Promise<ActionResult> {
    const element = this.element(ref)
    if (element.checked) {
      return {
        ok: true,
        detail: `"${element.name}" was already on.`,
        observation: await this.readPage(),
      }
    }
    this.drafts.set(ref, element.value || 'on')
    element.checked = true
    return {
      ok: true,
      detail: `Turned on "${element.name}".`,
      observation: await this.readPage(),
    }
  }

  /**
   * There is no renderer here, so there is nothing a key could reach. Said
   * plainly rather than answered with a pretend success.
   */
  async pressKey(key: PageKey): Promise<ActionResult> {
    return {
      ok: false,
      detail: `The fetch executor cannot send the ${key} key.`,
      observation: await this.readPage(),
    }
  }

  async submit(ref: string): Promise<ActionResult> {
    const owner = this.parsed?.fieldOwner.get(ref)
    const form = owner
      ? this.parsed?.forms.find((f) => f.ref === owner.formRef)
      : this.parsed?.forms[0]
    if (!form) {
      return {
        ok: false,
        detail: 'No form is available to submit on this page.',
        observation: await this.readPage(),
      }
    }
    return this.submitForm(form)
  }

  /** The fetch executor has no renderer, so there is nothing to capture. */
  async screenshot(): Promise<Screenshot | null> {
    return null
  }

  async replayUrl(): Promise<string | null> {
    return null
  }

  async close(): Promise<void> {
    this.cookies.clear()
    this.drafts.clear()
  }

  /* ------------------------------------------------------------- internals */

  private element(ref: string): PageElement {
    const found = this.current?.elements.find((e) => e.ref === ref)
    if (!found) throw new ExecutorError(`Unknown element "${ref}".`, false)
    return found
  }

  private resolve(href: string): string {
    const base = this.current?.url ?? ''
    return new URL(href, base).toString()
  }

  private async submitForm(form: ParsedForm): Promise<ActionResult> {
    const body = new URLSearchParams()
    for (const field of form.fields) {
      const draftRef = [...this.drafts.keys()].find((ref) => {
        const owner = this.parsed?.fieldOwner.get(ref)
        return owner?.formRef === form.ref && owner.fieldName === field.name
      })
      body.set(field.name, draftRef ? this.drafts.get(draftRef)! : field.value)
    }

    const action = assertSafeTargetUrl(this.resolve(form.action))
    if (form.method === 'GET') {
      for (const [k, v] of body) action.searchParams.set(k, v)
      return this.request(action, 'GET')
    }
    return this.request(action, 'POST', body)
  }

  /** Whether this run has a secret that must not follow a redirect off-origin. */
  private get hasHeaders(): boolean {
    return Boolean(this.targetOrigin) && Object.keys(this.extraHeaders).length > 0
  }

  /**
   * Performs one request, redirects included.
   *
   * Two paths, and the reason is the secret. Without verification headers there
   * is nothing to protect, so the platform follows redirects itself - faster,
   * and the behaviour every run has had until now.
   *
   * With them, redirects are followed by hand. `redirect: 'follow'` re-sends
   * the request headers to wherever the Location points, and an application
   * that answers `/dashboard` with a redirect to an identity provider - or a
   * compromised one that redirects anywhere at all - would hand that provider
   * the secret that opens the edge. Each hop is decided separately: the target
   * URL is re-validated, and the headers are re-computed for the origin the hop
   * is actually going to.
   */
  private async send(
    url: URL,
    method: 'GET' | 'POST',
    headers: Headers,
    body?: URLSearchParams,
  ): Promise<Response> {
    // One deadline for the whole chain: a redirect loop that renews the clock
    // on every hop is a request that never ends.
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)

    if (!this.hasHeaders) {
      return fetch(url.toString(), {
        method,
        headers,
        body: body?.toString(),
        redirect: 'follow',
        signal,
      })
    }

    let current = url
    let currentMethod = method
    let currentBody = body

    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const hopHeaders = new Headers(headers)
      for (const name of Object.keys(this.extraHeaders)) hopHeaders.delete(name)
      const extra = headersForUrl(
        current.toString(),
        this.extraHeaders,
        this.targetOrigin ?? '',
      )
      for (const [name, value] of Object.entries(extra)) {
        hopHeaders.set(name, value)
      }
      if (!currentBody) hopHeaders.delete('content-type')

      const response = await fetch(current.toString(), {
        method: currentMethod,
        headers: hopHeaders,
        body: currentBody?.toString(),
        redirect: 'manual',
        signal,
      })

      const location = response.headers.get('location')
      if (!REDIRECT_STATUS.has(response.status) || !location) return response

      // Cookies set on the way through are what a sign-in redirect is for.
      this.storeCookies(response)
      const next = assertSafeTargetUrl(new URL(location, current).toString())

      /*
       * A 303, and in practice a 301 or 302, turns a POST into a GET with no
       * body - which is exactly what a browser does after a form submission,
       * and what the login flows this executor walks depend on.
       */
      if (response.status !== 307 && response.status !== 308) {
        currentMethod = 'GET'
        currentBody = undefined
      }

      if (this.cookies.size > 0) {
        headers.set(
          'cookie',
          [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        )
      }

      current = next
    }

    throw new ExecutorError(
      `More than ${MAX_REDIRECTS} redirects from ${url.pathname}.`,
      false,
    )
  }

  private async request(
    url: URL,
    method: 'GET' | 'POST',
    body?: URLSearchParams,
  ): Promise<ActionResult> {
    const headers = new Headers({
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
    })
    if (this.targetOrigin) {
      const extra = headersForUrl(
        url.toString(),
        this.extraHeaders,
        this.targetOrigin,
      )
      for (const [name, value] of Object.entries(extra)) headers.set(name, value)
    }
    if (this.cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      )
    }
    if (body) headers.set('content-type', 'application/x-www-form-urlencoded')

    let response: Response
    try {
      response = await this.send(url, method, headers, body)
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? `No response within ${REQUEST_TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.message
            : String(error)
      const observation: PageObservation = {
        url: url.toString(),
        title: '',
        status: 0,
        headings: [],
        elements: [],
        text: '',
        consoleErrors: [],
        networkErrors: [message],
        transportError: message,
      }
      this.current = observation
      this.parsed = null
      return { ok: false, detail: `Request failed: ${message}`, observation }
    }

    this.storeCookies(response)

    const contentType = response.headers.get('content-type') ?? ''
    const isHtml = contentType.includes('html')
    const parsed = isHtml
      ? await parseHtml(response)
      : emptyParse(await safeText(response))

    this.parsed = parsed
    this.drafts.clear()

    const observation: PageObservation = {
      url: response.url || url.toString(),
      title: parsed.title,
      status: response.status,
      headings: parsed.headings,
      elements: parsed.elements,
      text: parsed.text,
      consoleErrors: [],
      networkErrors:
        response.status >= 400
          ? [`${method} ${url.pathname} returned ${response.status}`]
          : [],
    }
    this.current = observation

    return {
      ok: response.status < 400,
      detail: `${method} ${url.pathname} returned ${response.status}`,
      observation,
    }
  }

  private storeCookies(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      const eq = pair?.indexOf('=') ?? -1
      if (!pair || eq <= 0) continue
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
}

async function safeText(response: Response): Promise<string> {
  const text = await response.text()
  return text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text
}

function emptyParse(text: string): ParsedPage {
  return {
    title: '',
    headings: [],
    elements: [],
    forms: [],
    text: condenseText(text),
    fieldOwner: new Map(),
    selectOptions: new Map(),
  }
}

/**
 * Streams the response through HTMLRewriter and builds the compact page model.
 * HTMLRewriter is a Workers primitive, so this needs no DOM implementation.
 */
async function parseHtml(response: Response): Promise<ParsedPage> {
  const headings: string[] = []
  const elements: PageElement[] = []
  const forms: ParsedForm[] = []
  const fieldOwner = new Map<string, { formRef: string; fieldName: string }>()
  const selectOptions = new Map<
    string,
    Array<{ label: string; value: string }>
  >()
  const textParts: string[] = []

  let title = ''
  let refCounter = 0
  let formCounter = 0
  let capturingHeading: string | null = null
  let capturingLabel: string | null = null
  let inTitle = false
  let suppressText = 0
  /** The select being parsed, so its options land on the right element. */
  let currentSelect: string | null = null
  /** The option being parsed, whose label arrives as a text node. */
  let currentOption: { label: string; value: string } | null = null

  const nextRef = () => `e${++refCounter}`
  const currentForm = () => forms[forms.length - 1]

  const rewriter = new HTMLRewriter()
    .on('title', {
      element() {
        inTitle = true
      },
      text(chunk) {
        if (inTitle) title += chunk.text
        if (chunk.lastInTextNode) inTitle = false
      },
    })
    .on('script, style, noscript, svg', {
      element(el) {
        suppressText++
        el.onEndTag(() => {
          suppressText--
        })
      },
    })
    .on('h1, h2, h3', {
      element(el) {
        capturingHeading = ''
        el.onEndTag(() => {
          const value = capturingHeading?.trim()
          if (value) headings.push(value)
          capturingHeading = null
        })
      },
      text(chunk) {
        if (capturingHeading !== null) capturingHeading += chunk.text
      },
    })
    .on('form', {
      element(el) {
        formCounter++
        forms.push({
          ref: `f${formCounter}`,
          action: el.getAttribute('action') || '',
          method:
            (el.getAttribute('method') || 'GET').toUpperCase() === 'POST'
              ? 'POST'
              : 'GET',
          fields: [],
        })
      },
    })
    .on('a[href]', {
      element(el) {
        const href = el.getAttribute('href') ?? ''
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
          return
        }
        const ref = nextRef()
        const element: PageElement = { ref, role: 'link', name: '', href }
        elements.push(element)
        capturingLabel = ref
        el.onEndTag(() => {
          capturingLabel = null
        })
      },
      text(chunk) {
        if (!capturingLabel) return
        const target = elements.find((e) => e.ref === capturingLabel)
        if (target) target.name = `${target.name}${chunk.text}`.slice(0, 120)
      },
    })
    .on('button, input[type=submit], input[type=button]', {
      element(el) {
        const ref = nextRef()
        // `<button>` text is collected by the text handler below. The
        // attribute fallbacks are only for inputs, which have no text node.
        const name =
          el.tagName === 'button'
            ? ''
            : el.getAttribute('value') ||
              el.getAttribute('aria-label') ||
              el.getAttribute('name') ||
              ''
        elements.push({ ref, role: 'button', name })

        const form = currentForm()
        if (form) {
          fieldOwner.set(ref, { formRef: form.ref, fieldName: '' })
          const fieldName = el.getAttribute('name')
          if (fieldName) {
            form.fields.push({
              name: fieldName,
              value: el.getAttribute('value') ?? '',
              type: 'submit',
            })
          }
        }

        if (el.tagName === 'button') {
          capturingLabel = ref
          el.onEndTag(() => {
            capturingLabel = null
          })
        }
      },
      text(chunk) {
        if (!capturingLabel) return
        const target = elements.find((e) => e.ref === capturingLabel)
        if (target) target.name = `${target.name}${chunk.text}`.slice(0, 120)
      },
    })
    .on('input, textarea, select', {
      element(el) {
        const type = (el.getAttribute('type') ?? '').toLowerCase()
        if (type === 'submit' || type === 'button' || type === 'hidden') return

        const ref = nextRef()
        const fieldName = el.getAttribute('name') ?? ''
        const ticks = type === 'checkbox' || type === 'radio'
        const role: PageElement['role'] =
          el.tagName === 'select'
            ? 'select'
            : el.tagName === 'textarea'
              ? 'textarea'
              : ticks
                ? 'checkbox'
                : 'input'

        elements.push({
          ref,
          role,
          // Field name before placeholder: "email" reads better in an agent
          // trace than "you@company.com".
          name:
            el.getAttribute('aria-label') || fieldName || el.getAttribute('placeholder') || role,
          inputType: type || undefined,
          required: el.hasAttribute('required'),
          // A checkbox is on or off; everything else holds a value. Both are
          // reported so a form's unmet requirements can be named from the page
          // rather than from what the agent remembers typing.
          ...(ticks
            ? { checked: el.hasAttribute('checked') }
            : {
                // A server that renders a value into a password field must not
                // have it copied into an observation.
                value:
                  type === 'password'
                    ? el.getAttribute('value')
                      ? '\u2022\u2022\u2022'
                      : ''
                    : (el.getAttribute('value') ?? ''),
              }),
        })

        if (el.tagName === 'select') {
          currentSelect = ref
          selectOptions.set(ref, [])
          el.onEndTag(() => {
            currentSelect = null
          })
        }

        const form = currentForm()
        if (form && fieldName) {
          form.fields.push({
            name: fieldName,
            value: el.getAttribute('value') ?? '',
            type: type || role,
          })
          fieldOwner.set(ref, { formRef: form.ref, fieldName })
        }
      },
    })
    .on('option', {
      element(el) {
        if (!currentSelect) return
        currentOption = { label: '', value: el.getAttribute('value') ?? '' }
        const owner = currentSelect
        const option = currentOption
        el.onEndTag(() => {
          const label = option.label.replace(/\s+/g, ' ').trim()
          if (label || option.value) {
            selectOptions
              .get(owner)
              ?.push({ label: label || option.value, value: option.value || label })
          }
          currentOption = null
        })
      },
      text(chunk) {
        if (currentOption) currentOption.label += chunk.text
      },
    })
    .on('body', {
      text(chunk) {
        if (suppressText > 0) return
        const value = chunk.text.trim()
        if (value) textParts.push(value)
      },
    })

  // HTMLRewriter only runs its handlers as the body is consumed.
  await rewriter.transform(response).arrayBuffer()

  for (const element of elements) {
    element.name = element.name.replace(/\s+/g, ' ').trim() || element.role
    const options = selectOptions.get(element.ref)
    if (options?.length) element.options = options.map((o) => o.label)
  }

  return {
    title: title.trim(),
    headings: headings.slice(0, 12),
    elements: elements.slice(0, 60),
    forms,
    text: condenseText(textParts.join(' ')),
    fieldOwner,
    selectOptions,
  }
}
