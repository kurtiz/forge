import { describe, expect, it } from 'vitest'
import {
  MIN_CADENCE_MINUTES,
  nextRunAt,
  notificationText,
  shouldNotify,
} from '#/server/monitoring/schedule'

const NOW = new Date('2026-09-01T12:00:00.000Z')

describe('nextRunAt', () => {
  it('schedules from now, not from the last due time', () => {
    // Anchoring to `now` is what stops a schedule that was paused for a week
    // from firing a week of missed runs the moment it is re-enabled.
    expect(nextRunAt(NOW, 60)).toBe('2026-09-01T13:00:00.000Z')
  })

  it('enforces a floor on the cadence', () => {
    expect(nextRunAt(NOW, 1)).toBe(
      new Date(NOW.getTime() + MIN_CADENCE_MINUTES * 60_000).toISOString(),
    )
  })
})

describe('shouldNotify', () => {
  it('notifies on the first failure', () => {
    expect(
      shouldNotify({
        previousOutcome: 'passed',
        outcome: 'failed',
        consecutiveFailures: 1,
      }),
    ).toEqual({ notify: true, reason: 'first_failure' })
  })

  it('notifies on recovery', () => {
    expect(
      shouldNotify({
        previousOutcome: 'failed',
        outcome: 'passed',
        consecutiveFailures: 0,
      }),
    ).toEqual({ notify: true, reason: 'recovered' })
  })

  it('says nothing while everything is fine', () => {
    expect(
      shouldNotify({
        previousOutcome: 'passed',
        outcome: 'passed',
        consecutiveFailures: 0,
      }).notify,
    ).toBe(false)
  })

  it('does not re-alert on every tick of a long outage', () => {
    // A monitor that shouts every 30 minutes for a week gets muted, and a muted
    // monitor is worth nothing.
    const reminders = [2, 3, 4, 5, 6, 7, 8].filter(
      (n) =>
        shouldNotify({
          previousOutcome: 'failed',
          outcome: 'failed',
          consecutiveFailures: n,
        }).notify,
    )
    expect(reminders).toEqual([4, 8])
  })

  it('treats a run that could not complete as a failure', () => {
    expect(
      shouldNotify({
        previousOutcome: 'passed',
        outcome: 'error',
        consecutiveFailures: 1,
      }),
    ).toEqual({ notify: true, reason: 'first_failure' })
  })
})

describe('notificationText', () => {
  it('leads with the project and carries the run link', () => {
    const text = notificationText({
      reason: 'first_failure',
      projectName: 'Northbeam',
      targetUrl: 'https://northbeam.example.com',
      summary: '5 of 6 journeys passed. 1 finding recorded.',
      runUrl: 'https://forge.dev/runs/run_abc',
      consecutiveFailures: 1,
    })

    expect(text).toContain('Northbeam')
    expect(text).toContain('https://forge.dev/runs/run_abc')
  })

  it('says how long something has been failing', () => {
    expect(
      notificationText({
        reason: 'still_failing',
        projectName: 'Northbeam',
        targetUrl: 'https://northbeam.example.com',
        summary: 'still broken',
        runUrl: 'https://forge.dev/runs/run_abc',
        consecutiveFailures: 8,
      }),
    ).toContain('8 runs in a row')
  })
})
