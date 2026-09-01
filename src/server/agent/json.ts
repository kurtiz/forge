/**
 * Model output parsing.
 *
 * Models return prose around their JSON often enough that a bare `JSON.parse`
 * is a reliability bug rather than an edge case. This extracts the first
 * balanced object or array, tolerating code fences and commentary. It is kept
 * free of runtime imports so it can be unit tested directly.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? text).trim()

  const start = candidate.search(/[[{]/)
  if (start === -1) throw new Error('Model returned no JSON.')

  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1))
    }
  }

  throw new Error('Model returned unbalanced JSON.')
}
