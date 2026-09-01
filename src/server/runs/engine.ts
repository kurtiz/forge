/**
 * Verification run engine.
 *
 * Walks a run through the state machine: start an executor, discover journeys,
 * execute them, reproduce failures, judge the evidence, write findings. It runs
 * inside the run's Durable Object so live progress has somewhere to fan out
 * from and cancellation has somewhere to land.
 *
 * Cleanup is unconditional. The executor is released in a `finally` whatever
 * happens, because a leaked Solari session costs money for as long as it lives.
 */
import {
  DEFAULT_BUDGET,
  type Classification,
  type JsonValue,
  type RunStatus,
} from '../contracts'
import { Budget, BudgetExceededError } from '../domain/budget'
import { classifyFailure, shouldReproduce } from '../domain/analysis'
import { assertTransition } from '../domain/run-state'
import { createExecutor, type BrowserExecutor } from '../execution'
import { discoverJourneys } from '../agent/explorer'
import { judgeFinding } from '../agent/judge'
import { runJourney, type JourneyRun } from '../agent/operator'
import { modelProvider } from '../agent/provider'
import { recordEvidence, linkEvidenceToFinding } from '../evidence/store'
import { recordRunMetrics } from './telemetry'
import * as repo from './repository'

export type EngineHooks = {
  /** Persists and fans out one event. Returns nothing; never throws. */
  emit(type: string, message: string, data?: Record<string, JsonValue>): Promise<void>
  /** Checked between steps so cancellation lands promptly. */
  isCanceled(): boolean
}

export type EngineInput = {
  runId: string
  projectId: string
  targetUrl: string
  repoUrl: string | null
  goal: string | null
  verifiesFindingId: string | null
}

export async function executeRun(
  input: EngineInput,
  hooks: EngineHooks,
): Promise<void> {
  const budget = new Budget(DEFAULT_BUDGET)
  const provider = modelProvider()
  let status: RunStatus = 'queued'
  let executor: BrowserExecutor | null = null

  const canceled = () => hooks.isCanceled()

  /**
   * Advances the run. Once the user has canceled, the only reachable state is
   * `canceled`: without this guard the engine would keep announcing phases and
   * would overwrite the terminal status the cancel request already wrote.
   */
  const setStatus = async (next: RunStatus, message: string) => {
    const target = canceled() && next !== 'canceled' ? 'canceled' : next
    if (status === target) return

    assertTransition(status, target)
    status = target
    await repo.updateRun(input.runId, { status: target })
    await hooks.emit(
      'phase.changed',
      target === 'canceled' ? 'Run canceled' : message,
      { status: target },
    )
  }

  try {
    await setStatus('starting', 'Starting the verification run')
    await repo.updateRun(input.runId, { startedAt: new Date().toISOString() })

    executor = await createExecutor()
    await repo.updateRun(input.runId, { sessionId: executor.sessionId })
    await hooks.emit(
      'run.started',
      executor.kind === 'solari'
        ? 'Solari browser session started'
        : 'HTTP executor started (no Solari credentials configured)',
      { executor: executor.kind, sessionId: executor.sessionId },
    )

    /* ------------------------------------------------------------ discover */

    await setStatus('discovering', 'Exploring the application')

    budget.spend('browserActions')
    const entry = await executor.navigate(input.targetUrl)
    await hooks.emit('browser.action', entry.detail, {
      url: entry.observation.url,
      status: entry.observation.status,
    })

    await recordEvidence({
      runId: input.runId,
      kind: 'page',
      label: 'Entry page state',
      metadata: {
        url: entry.observation.url,
        status: entry.observation.status,
        title: entry.observation.title,
        headings: entry.observation.headings,
      },
      body: {
        bytes: JSON.stringify(entry.observation, null, 2),
        contentType: 'application/json',
      },
    })

    await captureScreenshot(executor, input.runId, null, 'Entry page')

    if (!entry.ok) {
      // The target is unreachable or erroring before any journey runs. That is
      // a finding in itself, and there is nothing left to explore.
      await recordUnreachable(input, entry.observation.status, entry.detail, hooks)
      await setStatus('reporting', 'Writing the report')
      await finish(input.runId, 'Target did not load successfully.', hooks)
      await setStatus('completed', 'Run complete')
      return
    }

    budget.spend('aiCalls')
    const exploration = await discoverJourneys(
      provider,
      entry.observation,
      input.goal,
      budget.canSpend('browserActions', 20) ? DEFAULT_BUDGET.maxJourneys : 2,
    )

    await hooks.emit(
      'journeys.discovered',
      `Discovered ${exploration.journeys.length} journeys (${exploration.source})`,
      { source: exploration.source, model: exploration.model },
    )

    const journeys = []
    for (const discovered of exploration.journeys) {
      const journey = await repo.insertJourney({
        runId: input.runId,
        name: discovered.name,
        goal: discovered.goal,
        entryPath: discovered.entryPath,
        priority: discovered.priority,
      })
      journeys.push({ record: journey, discovered })
      await hooks.emit('journey.discovered', `Journey: ${journey.name}`, {
        journeyId: journey.id,
        priority: journey.priority,
      })
    }

    /* --------------------------------------------------------------- test */

    await setStatus('testing', 'Executing journeys')

    const failures: Array<{
      journey: (typeof journeys)[number]
      result: JourneyRun
    }> = []

    for (const journey of journeys) {
      if (canceled()) break
      if (budget.expired || !budget.canSpend('browserActions', 4)) {
        await hooks.emit(
          'budget.exhausted',
          'Run budget reached; remaining journeys were skipped.',
        )
        break
      }

      await repo.updateJourneyStatus(journey.record.id, 'running')
      await hooks.emit('journey.started', `Running: ${journey.record.name}`, {
        journeyId: journey.record.id,
      })

      let result: JourneyRun
      try {
        result = await runJourney(
          executor,
          input.targetUrl,
          journey.discovered,
          budget,
        )
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          await hooks.emit('budget.exhausted', error.message)
          break
        }
        throw error
      }

      await repo.insertJourneySteps(journey.record.id, result.steps)

      for (const step of result.steps) {
        await hooks.emit(
          'browser.action',
          `${step.action}${step.target ? ` "${step.target}"` : ''}: ${step.actual}`,
          { journeyId: journey.record.id, status: step.status },
        )
      }

      await recordEvidence({
        runId: input.runId,
        journeyId: journey.record.id,
        kind: 'action',
        label: `Agent trace: ${journey.record.name}`,
        metadata: { steps: result.steps },
        body: {
          bytes: result.trace.join('\n'),
          contentType: 'text/plain',
        },
      })

      if (result.signal.consoleErrors.length > 0) {
        await recordEvidence({
          runId: input.runId,
          journeyId: journey.record.id,
          kind: 'console',
          label: `Console errors: ${journey.record.name}`,
          metadata: { count: result.signal.consoleErrors.length },
          body: {
            bytes: result.signal.consoleErrors.join('\n'),
            contentType: 'text/plain',
          },
        })
      }

      if (result.signal.networkErrors?.length) {
        await recordEvidence({
          runId: input.runId,
          journeyId: journey.record.id,
          kind: 'network',
          label: `Network errors: ${journey.record.name}`,
          metadata: { count: result.signal.networkErrors.length },
          body: {
            bytes: result.signal.networkErrors.join('\n'),
            contentType: 'text/plain',
          },
        })
      }

      await captureScreenshot(
        executor,
        input.runId,
        journey.record.id,
        result.passed
          ? `${journey.record.name}: final state`
          : `${journey.record.name}: failure`,
      )

      await repo.updateJourneyStatus(
        journey.record.id,
        result.passed ? 'passed' : 'failed',
      )

      if (result.passed) {
        await hooks.emit('journey.passed', `Passed: ${journey.record.name}`, {
          journeyId: journey.record.id,
        })
      } else {
        failures.push({ journey, result })
        await hooks.emit('journey.failed', `Failed: ${journey.record.name}`, {
          journeyId: journey.record.id,
        })
      }
    }

    /* -------------------------------------------------------- investigate */

    const findingIds: string[] = []
    const verdicts: Array<{ classification: Classification }> = []

    if (failures.length > 0 && !canceled()) {
      await setStatus('investigating', 'Reproducing failures')

      for (const failure of failures) {
        if (canceled()) break

        const failureClass = classifyFailure(failure.result.signal)
        let attempts = 0
        let reproduced = 0

        if (shouldReproduce(failureClass)) {
          const maxAttempts = DEFAULT_BUDGET.maxReproductionAttempts
          await hooks.emit(
            'reproduction.started',
            `Reproducing "${failure.journey.record.name}" up to ${maxAttempts} times`,
            { journeyId: failure.journey.record.id },
          )

          for (let i = 0; i < maxAttempts; i++) {
            if (canceled() || !budget.canSpend('browserActions', 4)) break
            attempts++
            const attempt = await runJourney(
              executor,
              input.targetUrl,
              failure.journey.discovered,
              budget,
            )
            if (!attempt.passed) reproduced++
            await hooks.emit(
              'reproduction.attempt',
              `Attempt ${attempts}: ${attempt.passed ? 'passed' : 'failed'}`,
              { journeyId: failure.journey.record.id, failed: !attempt.passed },
            )
          }
        } else {
          await hooks.emit(
            'reproduction.skipped',
            `Classified as ${failureClass}; not an application defect, so no reproduction budget was spent.`,
            { journeyId: failure.journey.record.id },
          )
        }

        budget.spend('aiCalls')
        const verdict = await judgeFinding(provider, {
          journeyName: failure.journey.record.name,
          journeyGoal: failure.journey.record.goal,
          journeyPriority: failure.journey.record.priority,
          failureClass,
          signal: failure.result.signal,
          attempts,
          failures: reproduced,
          trace: failure.result.trace,
          executorKind: executor.kind,
        })

        const finding = await repo.insertFinding({
          runId: input.runId,
          journeyId: failure.journey.record.id,
          title: verdict.title,
          description: verdict.summary,
          failureClass,
          classification: verdict.classification,
          severity: verdict.severity,
          confidence: verdict.confidence,
          reproductionAttempts: attempts,
          reproductionFailures: reproduced,
          rootCause: verdict.rootCause,
          rootCauseConfidence: verdict.rootCauseConfidence,
          affectedFiles: [],
        })

        await linkEvidenceToFinding(failure.journey.record.id, finding.id)
        findingIds.push(finding.id)
        verdicts.push({ classification: verdict.classification })

        await hooks.emit(
          'finding.created',
          `${verdict.severity.toUpperCase()}: ${verdict.title}`,
          {
            findingId: finding.id,
            classification: verdict.classification,
            judgedBy: verdict.source,
          },
        )
      }
    }

    /* ------------------------------------------------------------- report */

    await setStatus('reporting', 'Writing the report')

    if (executor.kind === 'solari') {
      const replay = await executor.replayUrl()
      if (replay) {
        await repo.updateRun(input.runId, { replayUrl: replay })
        await recordEvidence({
          runId: input.runId,
          kind: 'recording',
          label: 'Session replay',
          metadata: { url: replay, provider: 'solari' },
        })
      }
    }

    const passed = journeys.length - failures.length
    const summary =
      failures.length === 0
        ? `${passed} of ${journeys.length} journeys passed. No failures detected.`
        : `${passed} of ${journeys.length} journeys passed. ${findingIds.length} finding${findingIds.length === 1 ? '' : 's'} recorded.`

    if (input.verifiesFindingId) {
      const verified = failures.length === 0
      await repo.updateFixAttempt(
        input.runId,
        verified ? 'verified' : 'still_failing',
        summary,
      )
      if (verified) {
        await repo.updateFindingStatus(input.verifiesFindingId, 'resolved')
      }
      await hooks.emit(
        verified ? 'fix.verified' : 'fix.still_failing',
        verified
          ? 'Fix verified: the original failure no longer reproduces.'
          : 'The original failure still reproduces.',
        { findingId: input.verifiesFindingId },
      )
    }

    if (!canceled()) await finish(input.runId, summary, hooks)
    const finalStatus = canceled() ? 'canceled' : 'completed'
    await setStatus(finalStatus, 'Run complete')

    recordRunMetrics({
      run: {
        id: input.runId,
        projectId: input.projectId,
        executor: executor.kind,
        status: finalStatus,
      },
      journeys: journeys.length,
      failures: failures.length,
      findings: verdicts,
      usage: budget.snapshot(),
      discoverySource: exploration.source,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await repo.updateRun(input.runId, {
      status: 'failed',
      error: message,
      completedAt: new Date().toISOString(),
    })
    await hooks.emit('run.failed', `Run failed: ${message}`)
  } finally {
    // Unconditional: a leaked provider session keeps billing.
    await executor?.close().catch(() => undefined)
  }
}

async function finish(
  runId: string,
  summary: string,
  hooks: EngineHooks,
): Promise<void> {
  await repo.updateRun(runId, {
    summary,
    completedAt: new Date().toISOString(),
  })
  await hooks.emit('run.completed', summary)
}

async function captureScreenshot(
  executor: BrowserExecutor,
  runId: string,
  journeyId: string | null,
  label: string,
): Promise<void> {
  const shot = await executor.screenshot()
  if (!shot) return
  await recordEvidence({
    runId,
    journeyId,
    kind: 'screenshot',
    label,
    body: { bytes: shot.bytes, contentType: shot.contentType },
  })
}

async function recordUnreachable(
  input: EngineInput,
  status: number,
  detail: string,
  hooks: EngineHooks,
): Promise<void> {
  const failureClass = classifyFailure({
    status: status || undefined,
    transportError: status === 0,
    consoleErrors: [],
  })

  const finding = await repo.insertFinding({
    runId: input.runId,
    journeyId: null,
    title: 'Target did not load',
    description: detail,
    failureClass,
    classification: failureClass === 'APPLICATION_BUG' ? 'confirmed_bug' : 'environment',
    severity: failureClass === 'APPLICATION_BUG' ? 'critical' : 'medium',
    confidence: 0.9,
    reproductionAttempts: 1,
    reproductionFailures: 1,
    rootCause: null,
    rootCauseConfidence: null,
    affectedFiles: [],
  })

  await hooks.emit('finding.created', `Target did not load: ${detail}`, {
    findingId: finding.id,
  })
}
