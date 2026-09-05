/**
 * Verification headers: what a project may send, and what it may not.
 *
 * A project can carry headers that Forge attaches to every request it makes to
 * that target. The reason they exist is the bot challenge: the way to let an
 * automated verifier past an edge without weakening it for anyone else is a
 * secret nobody else can present, and a header is the only channel a browser
 * navigation offers for one. `CF-Access-Client-Id` and `CF-Access-Client-Secret`
 * are the same shape, which is why this is a list of pairs rather than a single
 * token field.
 *
 * The value is a secret and is treated like the stored password: encrypted at
 * rest, decrypted only inside the run's Durable Object, registered for
 * redaction before the first request, and never read back through the API.
 *
 * Two rules are load-bearing:
 *
 *   - A header is only ever sent to the project's own origin. A target page is
 *     attacker-controlled and journeys follow links; without this, one link to
 *     an attacker's host would hand them a credential that opens your edge.
 *     `sameOrigin` is where that is enforced, and both executors go through it.
 *   - Nothing that disguises the client is allowed. `User-Agent` is refused by
 *     name: a header set that lets a run pass for a human browser is the
 *     evasion this product will not do, and it would also be a lie in evidence.
 *
 * No Cloudflare imports, so the policy is unit testable.
 */

export class HeaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeaderError'
  }
}

/** RFC 9110 token characters. Anything else cannot be a header name. */
const TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

/**
 * Headers a project may not set.
 *
 * Three groups. The transport's own (`host`, `content-length`, the hop-by-hop
 * set) belong to whatever is making the request and would either be ignored or
 * break it. `cookie` belongs to the executor's session, which is how a run
 * stays signed in. `user-agent` is refused on purpose: see the module note.
 */
const FORBIDDEN = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'cookie',
  'cookie2',
  'set-cookie',
  'user-agent',
])

/** Prefixes the browser owns; a page cannot be allowed to forge them. */
const FORBIDDEN_PREFIXES = ['proxy-', 'sec-']

export const MAX_HEADER_NAME = 64
export const MAX_HEADER_VALUE = 2048

/**
 * Validates a header name and returns it as given.
 *
 * Case is preserved rather than normalised, because a name is shown back in the
 * console and in a WAF rule a person will write by hand, and `CF-Access-Client-Id`
 * reads as itself. Comparison is always done lowercased.
 */
export function normaliseHeaderName(input: string): string {
  const name = input.trim()

  if (!name) throw new HeaderError('Give the header a name.')
  if (name.length > MAX_HEADER_NAME) {
    throw new HeaderError(`A header name cannot be longer than ${MAX_HEADER_NAME} characters.`)
  }
  if (!TOKEN.test(name)) {
    throw new HeaderError(
      `"${name}" is not a valid header name. Use letters, digits and dashes.`,
    )
  }

  const lower = name.toLowerCase()
  if (lower === 'user-agent') {
    throw new HeaderError(
      'The user agent cannot be overridden. Forge identifies itself honestly, and a run that passes for a human browser is not something it will do.',
    )
  }
  if (FORBIDDEN.has(lower)) {
    throw new HeaderError(`${name} is set by the browser and cannot be overridden.`)
  }
  if (FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    throw new HeaderError(`Headers beginning with "${lower.split('-')[0]}-" cannot be set.`)
  }

  return name
}

/**
 * Validates a header value.
 *
 * The newline check is the one that matters: a value carrying CR or LF splits
 * the request and lets whoever set it write headers of their own.
 */
export function normaliseHeaderValue(input: string): string {
  const value = input.trim()

  if (!value) throw new HeaderError('Give the header a value.')
  if (value.length > MAX_HEADER_VALUE) {
    throw new HeaderError(`A header value cannot be longer than ${MAX_HEADER_VALUE} characters.`)
  }
  if (/[\r\n]/.test(value)) {
    throw new HeaderError('A header value cannot contain a line break.')
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new HeaderError('A header value cannot contain control characters.')
  }

  return value
}

/**
 * Whether a URL is the same origin as the project's target.
 *
 * Origin, not hostname: a target on `https://` does not get its secret sent
 * over `http://` because a page linked one, and a different port is a different
 * service. A URL that will not parse is not the target.
 */
export function sameOrigin(url: string, targetOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(targetOrigin).origin
  } catch {
    return false
  }
}

/**
 * The headers to attach to one request.
 *
 * Returns nothing at all for a URL outside the target's origin, which is the
 * check that keeps a secret from following a link off the site.
 */
export function headersForUrl(
  url: string,
  headers: Readonly<Record<string, string>>,
  targetOrigin: string,
): Record<string, string> {
  if (!sameOrigin(url, targetOrigin)) return {}
  return { ...headers }
}
