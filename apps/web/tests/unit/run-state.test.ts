import { describe, expect, it } from 'vitest'
import {
  assertTransition,
  canTransition,
  isTerminal,
  phaseIndex,
  RUN_PHASES,
} from '@/server/domain/run-state'

describe('run state machine', () => {
  it('walks the happy path', () => {
    const path = [...RUN_PHASES, 'completed'] as const
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true)
    }
  })

  it('allows skipping investigation when nothing failed', () => {
    expect(canTransition('testing', 'reporting')).toBe(true)
    expect(canTransition('discovering', 'reporting')).toBe(true)
  })

  it('refuses to move backwards or skip to completion', () => {
    expect(canTransition('testing', 'discovering')).toBe(false)
    expect(canTransition('queued', 'completed')).toBe(false)
    expect(() => assertTransition('queued', 'completed')).toThrow(
      /Illegal run transition/,
    )
  })

  it('allows cancellation and failure from every live phase', () => {
    for (const phase of RUN_PHASES) {
      expect(canTransition(phase, 'canceled')).toBe(true)
      expect(canTransition(phase, 'failed')).toBe(true)
    }
  })

  it('treats terminal states as terminal', () => {
    for (const status of ['completed', 'failed', 'canceled'] as const) {
      expect(isTerminal(status)).toBe(true)
      expect(canTransition(status, 'queued')).toBe(false)
    }
  })

  it('reports phase position for the progress rail', () => {
    expect(phaseIndex('queued')).toBe(0)
    expect(phaseIndex('reporting')).toBe(RUN_PHASES.length - 1)
    expect(phaseIndex('completed')).toBe(RUN_PHASES.length)
    expect(phaseIndex('failed')).toBe(-1)
  })
})

describe('cancellation reachability', () => {
  it('can reach canceled from every non-terminal phase', () => {
    for (const phase of RUN_PHASES) {
      expect(canTransition(phase, 'canceled')).toBe(true)
    }
  })

  it('cannot leave canceled', () => {
    for (const phase of RUN_PHASES) {
      expect(canTransition('canceled', phase)).toBe(false)
    }
  })
})
