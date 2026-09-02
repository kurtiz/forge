import { describe, expect, it } from 'vitest'
import {
  classificationFor,
  classifyFailure,
  confidenceFor,
  rankJourneys,
  severityFor,
  shouldReproduce,
  type FailureSignal,
} from '#/server/domain/analysis'

const signal = (over: Partial<FailureSignal> = {}): FailureSignal => ({
  consoleErrors: [],
  ...over,
})

describe('classifyFailure', () => {
  it('separates infrastructure faults from application defects', () => {
    expect(classifyFailure(signal({ executorError: true }))).toBe('BROWSER_FAILURE')
    expect(classifyFailure(signal({ transportError: true }))).toBe('NETWORK_FAILURE')
    expect(classifyFailure(signal({ timedOut: true }))).toBe('TIMEOUT')
    expect(classifyFailure(signal({ status: 429 }))).toBe('ENVIRONMENT_FAILURE')
    expect(classifyFailure(signal({ status: 401 }))).toBe('AUTH_FAILURE')
    expect(classifyFailure(signal({ authWall: true }))).toBe('AUTH_FAILURE')
  })

  it('calls a server error an application bug', () => {
    expect(classifyFailure(signal({ status: 500 }))).toBe('APPLICATION_BUG')
    expect(classifyFailure(signal({ status: 404 }))).toBe('APPLICATION_BUG')
  })

  it('does not blame the application for a 404 on a path Forge invented', () => {
    // Discovery may propose a path nothing linked to. The application
    // answering 404 about a URL it never claimed is correct behaviour, and
    // reporting it as a defect is the false positive this product cannot
    // afford.
    expect(classifyFailure(signal({ status: 404, inventedPath: true }))).toBe(
      'AGENT_ERROR',
    )
  })

  it('still blames the application for a broken link it published', () => {
    expect(classifyFailure(signal({ status: 404, inventedPath: false }))).toBe(
      'APPLICATION_BUG',
    )
  })

  it('calls a login form shown to a signed-in session an application bug', () => {
    // Distinct from an auth wall, which is Forge arriving without credentials.
    expect(classifyFailure(signal({ staleAuth: true }))).toBe('APPLICATION_BUG')
    expect(classifyFailure(signal({ staleAuth: true, authWall: true }))).toBe(
      'APPLICATION_BUG',
    )
  })

  it('treats an uncaught page error as an application bug', () => {
    expect(
      classifyFailure(signal({ consoleErrors: ['TypeError: x is undefined'] })),
    ).toBe('APPLICATION_BUG')
  })

  it('says unknown when there is no signal at all', () => {
    expect(classifyFailure(signal())).toBe('UNKNOWN')
  })

  it('ranks the executor fault above every other signal', () => {
    expect(
      classifyFailure(signal({ executorError: true, status: 500 })),
    ).toBe('BROWSER_FAILURE')
  })
})

describe('shouldReproduce', () => {
  it('spends reproduction budget only where a defect is plausible', () => {
    expect(shouldReproduce('APPLICATION_BUG')).toBe(true)
    expect(shouldReproduce('UNKNOWN')).toBe(true)
    expect(shouldReproduce('NETWORK_FAILURE')).toBe(false)
    expect(shouldReproduce('BROWSER_FAILURE')).toBe(false)
    expect(shouldReproduce('AUTH_FAILURE')).toBe(false)
  })
})

describe('classificationFor', () => {
  it('confirms a bug only when every attempt failed', () => {
    expect(classificationFor('APPLICATION_BUG', 3, 3)).toBe('confirmed_bug')
  })

  it('calls a partial reproduction flaky', () => {
    expect(classificationFor('APPLICATION_BUG', 3, 1)).toBe('flaky')
  })

  it('will not confirm anything without an attempt', () => {
    expect(classificationFor('APPLICATION_BUG', 0, 0)).toBe('unknown')
  })

  it('routes infrastructure faults away from the bug verdict', () => {
    expect(classificationFor('NETWORK_FAILURE', 3, 3)).toBe('environment')
    expect(classificationFor('BROWSER_FAILURE', 3, 3)).toBe('agent_error')
  })
})

describe('severityFor', () => {
  it('scales with journey importance and reproduction rate', () => {
    expect(severityFor('APPLICATION_BUG', 0.95, 1)).toBe('critical')
    expect(severityFor('APPLICATION_BUG', 0.7, 1)).toBe('high')
    expect(severityFor('APPLICATION_BUG', 0.5, 0.5)).toBe('medium')
    expect(severityFor('APPLICATION_BUG', 0.2, 0.2)).toBe('low')
  })

  it('caps severity for anything that is not an application defect', () => {
    expect(severityFor('ENVIRONMENT_FAILURE', 1, 1)).toBe('medium')
    expect(severityFor('NETWORK_FAILURE', 0.3, 1)).toBe('low')
  })
})

describe('confidenceFor', () => {
  it('is highest when every attempt reproduced a server error', () => {
    const full = confidenceFor('APPLICATION_BUG', 3, 3, signal({ status: 500 }))
    expect(full).toBeGreaterThan(0.9)
  })

  it('is penalised for intermittent failures', () => {
    const flaky = confidenceFor('APPLICATION_BUG', 3, 1, signal({ status: 500 }))
    const solid = confidenceFor('APPLICATION_BUG', 3, 3, signal({ status: 500 }))
    expect(flaky).toBeLessThan(solid)
  })

  it('is low when nothing was attempted', () => {
    expect(confidenceFor('UNKNOWN', 0, 0, signal())).toBeLessThan(0.5)
  })

  it('never leaves the unit interval', () => {
    for (const [a, f] of [[0, 0], [1, 1], [5, 5], [5, 2]] as const) {
      const value = confidenceFor('APPLICATION_BUG', a, f, signal({ status: 500 }))
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe('rankJourneys', () => {
  const journey = (name: string, priority: number) => ({
    name,
    goal: `Do ${name}`,
    priority,
    entryPath: '/',
  })

  it('promotes business-critical journeys over a confident model score', () => {
    const ranked = rankJourneys(
      [journey('Theme settings', 0.9), journey('Complete checkout', 0.8)],
      2,
    )
    expect(ranked[0].name).toBe('Complete checkout')
  })

  it('honours the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => journey(`Step ${i}`, 0.5))
    expect(rankJourneys(many, 4)).toHaveLength(4)
  })

  it('keeps priorities inside the unit interval', () => {
    const ranked = rankJourneys([journey('Complete checkout', 1)], 1)
    expect(ranked[0].priority).toBeLessThanOrEqual(1)
  })
})

describe('rankJourneys with credentials', () => {
  const journey = (name: string, priority = 0.5) => ({
    name,
    goal: `Do ${name}`,
    priority,
    entryPath: '/',
  })

  it('boosts sign-in journeys when Forge cannot get through the door', () => {
    const ranked = rankJourneys([journey('Sign in'), journey('View about page')], 5)
    expect(ranked.map((j) => j.name)).toContain('Sign in')
    expect(ranked[0].name).toBe('Sign in')
  })

  it('drops them once already signed in', () => {
    const ranked = rankJourneys(
      [journey('Sign in'), journey('Create an account'), journey('Complete checkout')],
      5,
      { authenticated: true },
    )
    expect(ranked.map((j) => j.name)).toEqual(['Complete checkout'])
  })

  it('keeps non-auth journeys untouched when authenticated', () => {
    const ranked = rankJourneys([journey('Complete checkout')], 5, {
      authenticated: true,
    })
    expect(ranked).toHaveLength(1)
  })
})
