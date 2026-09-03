/**
 * Target URL validation.
 *
 * A verification run points a browser (and, in the fallback executor, this
 * Worker's own fetch) at a user-supplied URL. Without validation that is an
 * SSRF primitive against Cloudflare's internal network and cloud metadata
 * services, so URLs are checked before any run is created and again before
 * every navigation.
 */
export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeTargetError'
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

/** Hostname suffixes that resolve inside private infrastructure. */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa']

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = nums as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // multicast + reserved
  return false
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === '::1' || h === '::') return true
  if (h.startsWith('fe80')) return true // link-local
  if (/^f[cd]/.test(h)) return true // unique local
  if (h.startsWith('::ffff:')) return isPrivateIPv4(h.slice(7))
  return false
}

export type TargetUrlOptions = {
  /**
   * Permits loopback targets. Only ever true in local development, where the
   * bundled demo application is served from localhost and self-verification is
   * the fastest way to exercise the whole loop.
   */
  allowLoopback?: boolean
}

/**
 * Parses and normalises a user-supplied target. Returns the canonical URL, or
 * throws `UnsafeTargetError` with a message safe to show the user.
 */
export function assertSafeTargetUrl(
  input: string,
  options: TargetUrlOptions = {},
): URL {
  const trimmed = input.trim()
  if (!trimmed) throw new UnsafeTargetError('Enter a URL to verify.')

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new UnsafeTargetError(`"${input}" is not a valid URL.`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeTargetError('Only http and https targets are supported.')
  }

  const host = url.hostname.toLowerCase()

  const loopback =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  if (loopback && options.allowLoopback) {
    url.hash = ''
    return url
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeTargetError(
      'Local addresses cannot be verified. Deploy a preview and use its public URL.',
    )
  }
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeTargetError('Internal hostnames cannot be verified.')
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new UnsafeTargetError(
      'Private and link-local addresses cannot be verified.',
    )
  }
  if (!host.includes('.') && !host.includes(':')) {
    throw new UnsafeTargetError('Enter a fully qualified hostname.')
  }
  if (url.username || url.password) {
    throw new UnsafeTargetError('Credentials in the URL are not supported.')
  }

  url.hash = ''
  return url
}

/** GitHub repository URLs only, read-only clone targets. */
export function normaliseRepoUrl(input: string | null): string | null {
  if (!input) return null
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (!trimmed) return null

  const match = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)$/i,
  )
  if (!match) {
    throw new UnsafeTargetError(
      'Repository must be a public GitHub URL, e.g. https://github.com/owner/repo',
    )
  }
  return `https://github.com/${match[1]}/${match[2]}`
}
