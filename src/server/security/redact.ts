/**
 * Secret redaction.
 *
 * The primary defence against leaking a target application's credentials is
 * structural: the authenticator never writes a credential into a trace line, and
 * the model is never shown one. This is the backstop for the paths that are not
 * under that control - a page that echoes a submitted value back, a console
 * error that quotes it, a validation message that repeats it.
 *
 * It is applied at the two choke points every recorded byte passes through: the
 * run event emitter and the evidence store. Text, not structure, is what leaks.
 */

/** Below this length a "secret" would match too much ordinary text to redact. */
const MIN_REDACTABLE_LENGTH = 4

export const REDACTED = '«redacted»'

/** Escapes a literal for use inside a RegExp. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces every occurrence of every secret with a marker.
 *
 * Longest first, so that a secret which contains another secret is replaced
 * whole rather than being broken into fragments by the shorter one.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  if (!text) return text

  const usable = secrets
    .filter((secret) => secret && secret.length >= MIN_REDACTABLE_LENGTH)
    .sort((a, b) => b.length - a.length)

  let output = text
  for (const secret of usable) {
    output = output.replace(new RegExp(escapeLiteral(secret), 'g'), REDACTED)
  }
  return output
}

/**
 * True only for `{}`-shaped objects.
 *
 * Binary evidence passes through this function - a screenshot's `Uint8Array`
 * would be rebuilt as `{"0":137,"1":80,...}` by a naive walk, silently
 * destroying every image. Anything that is not a plain object or array is
 * returned untouched.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Redacts every string in a JSON-shaped value, leaving the structure - and any
 * binary payload it carries - intact.
 */
export function redactDeep<T>(value: T, secrets: string[]): T {
  if (secrets.length === 0) return value

  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return redactSecrets(input, secrets)
    if (Array.isArray(input)) return input.map(walk)
    if (isPlainObject(input)) {
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [key, walk(item)]),
      )
    }
    return input
  }

  return walk(value) as T
}
