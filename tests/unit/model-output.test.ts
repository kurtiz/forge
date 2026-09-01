import { describe, expect, it } from 'vitest'
import { extractJson } from '#/server/agent/json'
import { explorerOutputSchema, judgeOutputSchema } from '#/server/contracts'

describe('extractJson', () => {
  it('reads bare JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('reads JSON out of a fenced block', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nHope that helps.')).toEqual({
      a: 1,
    })
  })

  it('reads JSON surrounded by commentary', () => {
    expect(extractJson('Here you go: {"a":[1,2]} — let me know.')).toEqual({
      a: [1, 2],
    })
  })

  it('is not confused by braces inside strings', () => {
    expect(extractJson('{"note":"a } brace","ok":true}')).toEqual({
      note: 'a } brace',
      ok: true,
    })
  })

  it('is not confused by escaped quotes', () => {
    expect(extractJson('{"note":"say \\"hi\\"","ok":true}')).toEqual({
      note: 'say "hi"',
      ok: true,
    })
  })

  it('handles a top-level array', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }])
  })

  it('throws when there is no JSON', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/no JSON/)
  })

  it('throws on unbalanced JSON rather than returning a partial object', () => {
    expect(() => extractJson('{"a":1')).toThrow(/unbalanced/)
  })
})

describe('agent output contracts', () => {
  it('accepts a well formed explorer response', () => {
    const parsed = explorerOutputSchema.safeParse(
      extractJson(
        '```json\n{"journeys":[{"name":"Checkout","goal":"A user can pay","priority":0.9,"entryPath":"/checkout"}]}\n```',
      ),
    )
    expect(parsed.success).toBe(true)
  })

  it('defaults a missing entry path to the root', () => {
    const parsed = explorerOutputSchema.parse({
      journeys: [{ name: 'Checkout', goal: 'A user can pay', priority: 0.9 }],
    })
    expect(parsed.journeys[0].entryPath).toBe('/')
  })

  it('rejects an out-of-range priority', () => {
    const parsed = explorerOutputSchema.safeParse({
      journeys: [
        { name: 'Checkout', goal: 'A user can pay', priority: 4, entryPath: '/' },
      ],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a judge verdict with an invented classification', () => {
    const parsed = judgeOutputSchema.safeParse({
      classification: 'definitely_broken',
      severity: 'high',
      confidence: 0.9,
      title: 'Checkout is broken',
      summary: 'It returned a 500.',
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a judge verdict with no root cause', () => {
    const parsed = judgeOutputSchema.parse({
      classification: 'confirmed_bug',
      severity: 'high',
      confidence: 0.9,
      title: 'Checkout is broken',
      summary: 'It returned a 500 on every attempt.',
    })
    expect(parsed.rootCause).toBeNull()
  })
})
