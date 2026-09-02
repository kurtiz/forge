/**
 * Verification run engine.
 *
 * Walks a run through the state machine: start an executor, discover journeys,
 * execute them, reproduce failures, judge the evidence, write findings. It runs
 * inside the run's Durable Object so live progress has somewhere to fan out
 * from and cancellation has somewhere to land.
 *
 * Cleanup is unconditional. The executor and the sandbox are released in a
 * `finally` whatever happens, because a leaked Solari session or microVM costs
 * money for as long as it lives.
 */
import {
  DEFAULT_BUDGET,
  type Classification,
  type JsonValue,
  type RunStatus,
} from '../contracts'
import { Budget, BudgetExceededError } from '../domain/budget'
import {
  classifyFailure,
  shouldReproduce,
  summariseRun,
  type FailureSignal,
} from '../domain/analysis'
import { assertTransition } from '../domain/run-state'
import { createExecutor, type BrowserExecutor } from '../execution'
import type { ActionResult, PageObservation } from '../execution/types'
import {
  createInvestigator,
  type SourceInsight,
  type SourceInvestigator,
} from '../investigation'
import { discoverJourneys, HEURISTIC_REASON_TEXT } from '../agent/explorer'
import { pathOf, signIn } from '../agent/authenticator'
import { judgeFinding } from '../agent/judge'
import { runJourney, type JourneyRun } from '../agent/operator'
import { modelProvider } from '../agent/provider'
import { recordEvidence, linkEvidenceToFinding } from '../evidence/store'
import { decryptCredential, redactDeep, redactSecrets } from '../security'
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
  /** Created lazily on the first failure worth investigating, then reused. */
  let investigator: SourceInvestigator | null = null
  let investigatorUnavailable = false

  /**
   * Values that must never appear in an event, an artifact, or a step.
   *
   * The authenticator already declines to write the password anywhere, so this
   * only catches text the application itself hands back - a validation message
   * quoting the submitted value, a console error including it.
   */
  const secrets: string[] = []

  const canceled = () => hooks.isCanceled()

  /** Every event leaves through here, so redaction is applied once. */
  const emit = async (
    type: string,
    message: string,
    data?: Record<string, JsonValue>,
  ) => {
    await hooks.emit(
      type,
      redactSecrets(message, secrets),
      data ? redactDeep(data, secrets) : data,
    )
  }

  /** Every artifact is written through here, for the same reason. */
  const saveEvidence: typeof recordEvidence = (evidence) =>
    recordEvidence(secrets.length === 0 ? evidence : redactDeep(evidence, secrets))

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
    await emit(
      'phase.changed',
      target === 'canceled' ? 'Run canceled' : message,
      { status: target },
    )
  }

  /**
   * Charges sandbox wall time without throwing. The gate in `investigateFailure`
   * already refuses the next investigation once the budget is spent; overshoot
   * on the one in flight is recorded, not raised.
   */
  const chargeSandbox = (seconds: number) => {
    try {
      budget.spend('sandboxSeconds', Math.max(seconds, 1))
    } catch {
      // Already over. Recorded by the gate, not by an exception here.
    }
  }

  /** Provisions the sandbox on first use, then reuses it for the whole run. */
  const ensureInvestigator = async (): Promise<SourceInvestigator | null> => {
    if (investigator || investigatorUnavailable) return investigator
    const created = await createInvestigator()
    if (!created) {
      investigatorUnavailable = true
      return null
    }
    investigator = created
    return investigator
  }

  /**
   * Releases the sandbox. Declared here rather than inlined in the `finally` so
   * the read of `investigator` happens in the scope that assigns it.
   */
  const releaseInvestigator = async () => {
    await investigator?.close().catch(() => undefined)
    investigator = null
  }

  /**
   * Reads the repository for one failure.
   *
   * Never throws. Source is a bonus layer of evidence on top of a finding that
   * already stands on its runtime evidence, so a sandbox that fails to start,
   * a repository that will not clone, or a budget that is spent degrades the
   * finding to runtime-only rather than failing the run.
   */
  const investigateFailure = async (
    journey: { id: string; name: string; entryPath: string },
    signal: FailureSignal,
  ): Promise<SourceInsight | null> => {
    if (!input.repoUrl) return null

    if (!budget.canSpend('sandboxSeconds', 1)) {
      await emit(
        'investigation.skipped',
        'Sandbox budget is spent; the repository was not investigated.',
        { journeyId: journey.id },
      )
      return null
    }

    let active: SourceInvestigator | null = null
    try {
      active = await ensureInvestigator()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await emit(
        'investigation.failed',
        `Could not start a sandbox: ${message}`,
        { journeyId: journey.id },
      )
      return null
    }

    if (!active) {
      await emit(
        'investigation.skipped',
        'No Solari credentials are configured, so the repository was not investigated.',
        { journeyId: journey.id },
      )
      return null
    }

    const startedAt = active.elapsedSeconds
    await emit(
      'investigation.started',
      `Investigating the repository for "${journey.name}"`,
      { journeyId: journey.id },
    )

    try {
      const insight = await active.investigate({
        repoUrl: input.repoUrl,
        journeyName: journey.name,
        entryPath: journey.entryPath,
        consoleErrors: signal.consoleErrors,
        networkErrors: signal.networkErrors ?? [],
        status: signal.status,
      })
      chargeSandbox(active.elapsedSeconds - startedAt)

      await saveEvidence({
        runId: input.runId,
        journeyId: journey.id,
        kind: 'source',
        label: `Source investigation: ${journey.name}`,
        metadata: {
          framework: insight.framework,
          packageManager: insight.packageManager,
          commit: insight.commit,
          affectedFiles: insight.affectedFiles,
          matches: insight.matches.length,
        },
        body: {
          bytes: renderSourceEvidence(insight),
          contentType: 'text/plain',
        },
      })

      for (const path of insight.affectedFiles) {
        await emit('investigation.source', `Source: ${path}`, {
          journeyId: journey.id,
          path,
        })
      }

      await emit(
        'investigation.completed',
        insight.affectedFiles.length > 0
          ? `Linked ${insight.affectedFiles.length} file${insight.affectedFiles.length === 1 ? '' : 's'} to "${journey.name}"`
          : `No source matched "${journey.name}"`,
        { journeyId: journey.id, files: insight.affectedFiles.length },
      )

      return insight
    } catch (error) {
      chargeSandbox(active.elapsedSeconds - startedAt)
      const message = error instanceof Error ? error.message : String(error)
      await emit(
        'investigation.failed',
        `Repository investigation failed: ${message}`,
        { journeyId: journey.id },
      )
      return null
    }
  }

  try {
    await setStatus('starting', 'Starting the verification run')
    await repo.updateRun(input.runId, { startedAt: new Date().toISOString() })

    executor = await createExecutor()
    await repo.updateRun(input.runId, { sessionId: executor.sessionId })
    await emit(
      'run.started',
      executor.kind === 'solari'
        ? 'Solari browser session started'
        : 'HTTP executor started (no Solari credentials configured)',
      { executor: executor.kind, sessionId: executor.sessionId },
    )

    /* --------------------------------------------------------------- sign in */

    /*
     * Done once, before discovery, because the executor is shared by every
     * journey and every reproduction attempt - so one sign-in carries the whole
     * run, in the Solari browser and in the fetch executor's cookie jar alike.
     */
    let authenticated = false
    /**
     * Where the application put the browser after signing in.
     *
     * Kept because most applications answer a sign-in by redirecting into the
     * part of themselves that only exists once you are in. Navigating back to
     * the base URL after that throws the authenticated surface away and
     * explores the signed-out marketing page instead, which is how a run
     * against a real application ends up discovering one journey on an empty
     * page.
     */
    let landing: PageObservation | null = null
    /** Set when a configured sign-in did not work, for the report. */
    let authFailure: string | null = null
    const stored = await repo.readProjectCredentials(input.projectId)

    if (stored && !canceled()) {
      await emit('auth.started', `Signing in as ${stored.username}`)
      try {
        const password = await decryptCredential(stored.passwordEncrypted)
        // Registered before the first keystroke, so every later event and
        // artifact is scrubbed even if the application echoes the value back.
        secrets.push(password)

        const result = await signIn(
          executor,
          input.targetUrl,
          {
            loginPath: stored.loginPath,
            username: stored.username,
            password,
          },
          budget,
        )
        authenticated = result.ok
        landing = result.landing
        if (!result.ok) authFailure = result.detail
        await emit(
          result.ok ? 'auth.succeeded' : 'auth.failed',
          result.detail,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        authFailure = `Sign-in could not run: ${message}`
        await emit('auth.failed', authFailure)
      }
    }

    /* ------------------------------------------------------------ discover */

    await setStatus('discovering', 'Exploring the application')

    /*
     * Explore from wherever the sign-in landed, not from the base URL. A second
     * navigation here would undo the redirect the application just performed
     * and cost a browser action to do it.
     */
    let entry: ActionResult
    if (landing) {
      entry = { ok: true, detail: `Signed in at ${landing.url}`, observation: landing }
      await emit('browser.action', `Exploring from ${landing.url} after sign-in`, {
        url: landing.url,
        status: landing.status,
      })
    } else {
      budget.spend('browserActions')
      entry = await executor.navigate(input.targetUrl)
      await emit('browser.action', entry.detail, {
        url: entry.observation.url,
        status: entry.observation.status,
      })
    }

    await saveEvidence({
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
      { authenticated },
    )

    await emit(
      'journeys.discovered',
      exploration.reason
        ? `Discovered ${exploration.journeys.length} journeys without a model: ${HEURISTIC_REASON_TEXT[exploration.reason]}. Journeys came from page heuristics, which are much weaker.`
        : `Discovered ${exploration.journeys.length} journeys (${exploration.source})`,
      {
        source: exploration.source,
        model: exploration.model,
        reason: exploration.reason ?? null,
      },
    )

    /*
     * The paths the application itself offered on the entry page.
     *
     * Discovery may propose a path nothing linked to, and the difference
     * matters when that path 404s: a broken link the application published is
     * a defect, a URL Forge invented is not.
     */
    const offeredPaths = new Set<string>([pathOf(entry.observation.url)])
    for (const element of entry.observation.elements) {
      if (!element.href) continue
      try {
        offeredPaths.add(pathOf(new URL(element.href, entry.observation.url).pathname))
      } catch {
        // A malformed href offers nothing.
      }
    }

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
      await emit('journey.discovered', `Journey: ${journey.name}`, {
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
    /** Journeys nothing could be done with. Not failures, and not passes. */
    let skipped = 0

    for (const journey of journeys) {
      if (canceled()) break
      if (budget.expired || !budget.canSpend('browserActions', 4)) {
        await emit(
          'budget.exhausted',
          'Run budget reached; remaining journeys were skipped.',
        )
        break
      }

      await repo.updateJourneyStatus(journey.record.id, 'running')
      await emit('journey.started', `Running: ${journey.record.name}`, {
        journeyId: journey.record.id,
      })

      let result: JourneyRun
      try {
        result = await runJourney(
          executor,
          input.targetUrl,
          journey.discovered,
          budget,
          { authenticated },
        )
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          await emit('budget.exhausted', error.message)
          break
        }
        throw error
      }

      // Steps are the third recorded path, alongside events and artifacts: an
      // application that echoes a submitted value lands it in `actual`.
      await repo.insertJourneySteps(
        journey.record.id,
        redactDeep(result.steps, secrets),
      )

      for (const step of result.steps) {
        await emit(
          'browser.action',
          `${step.action}${step.target ? ` "${step.target}"` : ''}: ${step.actual}`,
          { journeyId: journey.record.id, status: step.status },
        )
      }

      await saveEvidence({
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
        await saveEvidence({
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
        await saveEvidence({
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
        result.outcome === 'failed'
          ? `${journey.record.name}: failure`
          : `${journey.record.name}: final state`,
      )

      await repo.updateJourneyStatus(journey.record.id, result.outcome)

      if (result.outcome === 'passed') {
        await emit('journey.passed', `Passed: ${journey.record.name}`, {
          journeyId: journey.record.id,
        })
      } else if (result.outcome === 'skipped') {
        // Nothing on the page matched the journey, so nothing was verified.
        // Recorded as its own outcome rather than folded into either column.
        skipped++
        await emit(
          'journey.skipped',
          `Could not attempt: ${journey.record.name}`,
          { journeyId: journey.record.id },
        )
      } else {
        failures.push({ journey, result })
        await emit('journey.failed', `Failed: ${journey.record.name}`, {
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

        // Marked here rather than in the Operator, which has no view of what
        // the entry page offered.
        if (!offeredPaths.has(pathOf(failure.journey.discovered.entryPath))) {
          failure.result.signal.inventedPath = true
        }

        const failureClass = classifyFailure(failure.result.signal)
        let attempts = 0
        let reproduced = 0

        if (shouldReproduce(failureClass)) {
          const maxAttempts = DEFAULT_BUDGET.maxReproductionAttempts
          await emit(
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
              { authenticated },
            )
            // Only a repeat failure counts. A journey that could not be
            // attempted this time proves nothing either way.
            const failedAgain = attempt.outcome === 'failed'
            if (failedAgain) reproduced++
            await emit(
              'reproduction.attempt',
              `Attempt ${attempts}: ${attempt.outcome}`,
              { journeyId: failure.journey.record.id, failed: failedAgain },
            )
          }
        } else {
          await emit(
            'reproduction.skipped',
            `Classified as ${failureClass}; not an application defect, so no reproduction budget was spent.`,
            { journeyId: failure.journey.record.id },
          )
        }

        /*
         * Source investigation, gated hard. A repository must be attached, the
         * failure must look like an application defect rather than the
         * environment, and it must actually have reproduced. A microVM is not
         * worth spending on a rate limit or a one-off flake.
         */
        const sourceInsight =
          shouldReproduce(failureClass) && reproduced > 0 && !canceled()
            ? await investigateFailure(failure.journey.record, failure.result.signal)
            : null

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
          sourceInsight,
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
          affectedFiles: sourceInsight?.affectedFiles ?? [],
        })

        await linkEvidenceToFinding(failure.journey.record.id, finding.id)
        findingIds.push(finding.id)
        verdicts.push({ classification: verdict.classification })

        await emit(
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

    /*
     * A configured sign-in that did not work is itself a result, and the most
     * important one on the page: every journey after it ran as a stranger. It
     * is recorded as a finding so the run cannot end on "no failures detected"
     * for an application Forge never got inside. Classified as `environment`
     * rather than a defect, because a wrong test account is a configuration
     * problem and must not fail a pull request check.
     */
    if (authFailure && !canceled()) {
      const finding = await repo.insertFinding({
        runId: input.runId,
        journeyId: null,
        title: 'Forge could not sign in',
        description: `${authFailure} Every journey in this run was executed signed out, so nothing behind the login was verified.`,
        failureClass: 'AUTH_FAILURE',
        classification: 'environment',
        severity: 'high',
        confidence: 0.9,
        reproductionAttempts: 1,
        reproductionFailures: 1,
        rootCause: null,
        rootCauseConfidence: null,
        affectedFiles: [],
      })
      findingIds.push(finding.id)
      await emit('finding.created', `Could not sign in: ${authFailure}`, {
        findingId: finding.id,
        classification: 'environment',
      })
    }

    /* ------------------------------------------------------------- report */

    await setStatus('reporting', 'Writing the report')

    if (executor.kind === 'solari') {
      const replay = await executor.replayUrl()
      if (replay) {
        await repo.updateRun(input.runId, { replayUrl: replay })
        await saveEvidence({
          runId: input.runId,
          kind: 'recording',
          label: 'Session replay',
          metadata: { url: replay, provider: 'solari' },
        })
      }
    }

    const passed = journeys.length - failures.length - skipped
    const summary = summariseRun({
      total: journeys.length,
      passed,
      failed: failures.length,
      skipped,
      findings: findingIds.length,
      authFailed: Boolean(authFailure),
    })

    if (input.verifiesFindingId) {
      /*
       * A fix is verified only when the journeys actually ran and passed.
       * Without the last two conditions, a run that could not sign in, or one
       * where every journey was skipped, would silently resolve the finding it
       * was supposed to re-test.
       */
      const verified = failures.length === 0 && !authFailure && passed > 0
      await repo.updateFixAttempt(
        input.runId,
        verified ? 'verified' : 'still_failing',
        summary,
      )
      if (verified) {
        await repo.updateFindingStatus(input.verifiesFindingId, 'resolved')
      }
      await emit(
        verified ? 'fix.verified' : 'fix.still_failing',
        verified
          ? 'Fix verified: the original failure no longer reproduces.'
          : failures.length > 0
            ? 'The original failure still reproduces.'
            : 'The fix could not be confirmed: this run did not manage to exercise the journey.',
        { findingId: input.verifiesFindingId },
      )
    }

    const finalStatus = canceled() ? 'canceled' : 'completed'
    await setStatus(finalStatus, 'Run complete')
    if (!canceled()) await finish(input.runId, summary, hooks)

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
    await emit('run.failed', `Run failed: ${message}`)
  } finally {
    // Unconditional: a leaked provider session or sandbox keeps billing.
    await executor?.close().catch(() => undefined)
    await releaseInvestigator()
  }
}

/**
 * Renders an investigation as the stored `source` artifact.
 *
 * This is the auditable record behind a finding's affected files: which terms
 * were searched, which lines matched, and which commit they were read at, so a
 * reader can judge the link rather than take the model's word for it.
 */
function renderSourceEvidence(insight: SourceInsight): string {
  const lines: string[] = []

  if (insight.commit) lines.push(`Commit: ${insight.commit}`)
  if (insight.framework) lines.push(`Framework: ${insight.framework}`)
  if (insight.packageManager) lines.push(`Package manager: ${insight.packageManager}`)
  if (lines.length > 0) lines.push('')

  for (const note of insight.notes) lines.push(note)

  if (insight.matches.length > 0) {
    lines.push('', 'Matches:')
    for (const match of insight.matches) {
      lines.push('', `${match.path}:${match.line}  (matched "${match.query}")`)
      lines.push(match.excerpt)
    }
  }

  return lines.join('\n')
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
