import { describe, expect, it } from 'vitest'
import { renderCheckReport } from '@/server/github/report'
import type { Finding, Journey, Run } from '@/server/contracts'

const BASE = 'https://forge.example.com'

const run = (patch: Partial<Run> = {}): Run => ({
  id: 'run_abc',
  projectId: 'prj_abc',
  status: 'completed',
  trigger: 'pull_request',
  executor: 'solari',
  targetUrl: 'https://pr-42.example.dev',
  repoUrl: 'https://github.com/acme/app',
  sessionId: 'sess_1',
  replayUrl: null,
  verifiesFindingId: null,
  commitSha: '0123456789abcdef',
  pullRequestNumber: 42,
  summary: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-01T12:00:00.000Z',
  ...patch,
})

const journey = (status: Journey['status'], name = 'Checkout'): Journey => ({
  id: `jny_${name}_${status}`,
  runId: 'run_abc',
  name,
  goal: 'Complete a purchase',
  entryPath: '/',
  priority: 0.9,
  status,
  confidence: null,
  createdAt: '2026-09-01T12:00:00.000Z',
})

const finding = (patch: Partial<Finding> = {}): Finding => ({
  id: 'fnd_abc',
  runId: 'run_abc',
  journeyId: 'jny_1',
  title: 'Applying a coupon returns 500',
  description: 'The checkout endpoint fails when a coupon is applied.',
  failureClass: 'APPLICATION_BUG',
  classification: 'confirmed_bug',
  severity: 'critical',
  confidence: 0.9,
  reproductionAttempts: 3,
  reproductionFailures: 3,
  rootCause: null,
  rootCauseConfidence: null,
  affectedFiles: [],
  status: 'open',
  createdAt: '2026-09-01T12:00:00.000Z',
  ...patch,
})

describe('renderCheckReport', () => {
  it('passes a clean run', () => {
    const report = renderCheckReport({
      run: run(),
      journeys: [journey('passed'), journey('passed', 'Sign up')],
      findings: [],
      baseUrl: BASE,
    })

    expect(report.conclusion).toBe('success')
    expect(report.title).toBe('2 of 2 journeys passed')
    expect(report.summary).toContain(`${BASE}/runs/run_abc`)
  })

  it('fails the check on a confirmed defect', () => {
    const report = renderCheckReport({
      run: run(),
      journeys: [journey('passed'), journey('failed', 'Checkout')],
      findings: [finding()],
      baseUrl: BASE,
    })

    expect(report.conclusion).toBe('failure')
    expect(report.title).toBe('1 confirmed defect')
    expect(report.summary).toContain('Applying a coupon returns 500')
    expect(report.summary).toContain('3/3')
    expect(report.summary).toContain(`${BASE}/findings/fnd_abc`)
  })

  it('does not block a pull request on a flaky or environmental failure', () => {
    // The load-bearing policy: blocking a merge on a rate limit teaches people
    // to ignore the check.
    const report = renderCheckReport({
      run: run(),
      journeys: [journey('failed')],
      findings: [
        finding({ classification: 'flaky' }),
        finding({ id: 'fnd_env', classification: 'environment' }),
      ],
      baseUrl: BASE,
    })

    expect(report.conclusion).toBe('neutral')
    expect(report.summary).toContain('did not fail this check')
  })

  it('does not pass a check when no journey was actually attempted', () => {
    // A green check has to mean the application was exercised. Otherwise it
    // means "Forge found nothing to do", which a reviewer will read as "fine".
    const report = renderCheckReport({
      run: run(),
      journeys: [journey('skipped'), journey('skipped', 'Sign up')],
      findings: [],
      baseUrl: BASE,
    })

    expect(report.conclusion).toBe('neutral')
    expect(report.summary).toContain('could not be attempted')
  })

  it('is inconclusive when the run itself failed', () => {
    const report = renderCheckReport({
      run: run({ status: 'failed' }),
      journeys: [],
      findings: [],
      baseUrl: BASE,
    })

    expect(report.conclusion).toBe('neutral')
    expect(report.title).toBe('Verification could not complete')
  })

  it('reports a cancellation as cancelled', () => {
    const report = renderCheckReport({
      run: run({ status: 'canceled' }),
      journeys: [],
      findings: [],
      baseUrl: BASE,
    })

    expect(report.conclusion).toBe('cancelled')
  })

  it('discloses the executor that produced the evidence', () => {
    const report = renderCheckReport({
      run: run({ executor: 'fetch' }),
      journeys: [journey('passed')],
      findings: [],
      baseUrl: BASE,
    })

    expect(report.summary).toContain('no JavaScript ran')
  })

  it('escapes a pipe so a finding title cannot break the table', () => {
    const report = renderCheckReport({
      run: run(),
      journeys: [journey('failed')],
      findings: [finding({ title: 'Checkout | coupon fails' })],
      baseUrl: BASE,
    })

    expect(report.summary).toContain('Checkout \\| coupon fails')
  })
})
