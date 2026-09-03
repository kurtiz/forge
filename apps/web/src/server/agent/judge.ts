/**
 * Judge agent.
 *
 * The deterministic rules in `domain/analysis` already produce a defensible
 * classification, severity, and confidence from the observed evidence. The
 * Judge may refine the narrative and propose a root cause, but it can never
 * upgrade a flaky failure into a confirmed bug or invent a reproduction that
 * did not happen: those fields are re-imposed after the model answers.
 */
import {
  judgeOutputSchema,
  type FailureClass,
  type JudgeOutput,
} from '@/server/contracts'
import {
  classificationFor,
  confidenceFor,
  severityFor,
  type FailureSignal,
} from '@/server/domain/analysis'
import { JUDGE_SYSTEM } from './prompts'
import { extractJson } from './json'
import type { ModelProvider } from './provider'
import type { SourceInsight } from '@/server/investigation/types'

export type JudgeInput = {
  journeyName: string
  journeyGoal: string
  journeyPriority: number
  failureClass: FailureClass
  signal: FailureSignal
  attempts: number
  failures: number
  /** The agent trace for the failing journey, newest last. */
  trace: string[]
  executorKind: 'solari' | 'fetch'
  /** Source read from the repository, when a sandbox investigation ran. */
  sourceInsight?: SourceInsight | null
}

export type JudgeResult = JudgeOutput & { source: 'model' | 'rules' }

export async function judgeFinding(
  provider: ModelProvider,
  input: JudgeInput,
): Promise<JudgeResult> {
  const baseline = ruleBaseline(input)

  if (!provider.available) return { ...baseline, source: 'rules' }

  try {
    const output = await provider.generate({
      task: 'judging',
      system: JUDGE_SYSTEM,
      user: describe(input),
      maxTokens: 700,
    })

    const parsed = judgeOutputSchema.safeParse(extractJson(output.text))
    if (!parsed.success) return { ...baseline, source: 'rules' }

    return {
      // The model writes the narrative and may propose a root cause.
      title: parsed.data.title,
      summary: parsed.data.summary,
      rootCause: parsed.data.rootCause,
      rootCauseConfidence: parsed.data.rootCause
        ? (parsed.data.rootCauseConfidence ?? 0.4)
        : null,
      // Reproduction is a measured fact, so the measured verdict wins.
      classification: baseline.classification,
      severity: baseline.severity,
      confidence: Math.min(baseline.confidence, parsed.data.confidence),
      source: 'model',
    }
  } catch {
    return { ...baseline, source: 'rules' }
  }
}

function ruleBaseline(input: JudgeInput): JudgeOutput {
  const rate = input.attempts > 0 ? input.failures / input.attempts : 0
  const classification = classificationFor(
    input.failureClass,
    input.attempts,
    input.failures,
  )
  const severity = severityFor(input.failureClass, input.journeyPriority, rate)
  const confidence = confidenceFor(
    input.failureClass,
    input.attempts,
    input.failures,
    input.signal,
  )

  return {
    classification,
    severity,
    confidence,
    title: `${input.journeyName} failed`,
    summary: summarise(input),
    rootCause: null,
    rootCauseConfidence: null,
  }
}

function summarise(input: JudgeInput): string {
  const parts = [`Goal: ${input.journeyGoal}`]
  const last = input.trace[input.trace.length - 1]
  if (last) parts.push(`Last step: ${last}`)
  if (input.signal.status) parts.push(`HTTP ${input.signal.status}`)
  if (input.signal.consoleErrors.length) {
    parts.push(`Console: ${input.signal.consoleErrors[0]}`)
  }
  parts.push(
    `Reproduced ${input.failures} of ${input.attempts} attempts.`,
  )
  return parts.join(' ')
}

function describe(input: JudgeInput): string {
  const lines = [
    `Journey: ${input.journeyName}`,
    `Goal: ${input.journeyGoal}`,
    `Executor: ${input.executorKind}${input.executorKind === 'fetch' ? ' (no JavaScript execution)' : ''}`,
    `Deterministic failure class: ${input.failureClass}`,
    `Reproduction: ${input.failures} failures across ${input.attempts} attempts`,
  ]
  if (input.signal.status) lines.push(`Last HTTP status: ${input.signal.status}`)
  if (input.signal.consoleErrors.length) {
    lines.push(`Console errors:\n${input.signal.consoleErrors.join('\n')}`)
  }
  if (input.signal.networkErrors?.length) {
    lines.push(`Network errors:\n${input.signal.networkErrors.join('\n')}`)
  }
  lines.push(`Agent trace:\n${input.trace.join('\n')}`)

  const insight = input.sourceInsight
  if (insight) {
    lines.push(describeSource(insight))
  } else {
    lines.push(
      'Repository source: not available. Do not name files or cite code.',
    )
  }

  return lines.join('\n')
}

/**
 * Renders the source evidence. Paths and excerpts are repository content, so
 * they are labelled as evidence to read, never as instructions to follow - the
 * system prompt's untrusted-content policy covers what arrives here.
 */
function describeSource(insight: SourceInsight): string {
  const lines = ['Repository source evidence:']
  if (insight.framework) lines.push(`Framework: ${insight.framework}`)
  if (insight.packageManager) lines.push(`Package manager: ${insight.packageManager}`)
  if (insight.commit) lines.push(`Commit: ${insight.commit}`)

  if (insight.matches.length === 0) {
    lines.push('No source matched the runtime evidence.')
    return lines.join('\n')
  }

  for (const match of insight.matches.slice(0, 12)) {
    lines.push(`${match.path}:${match.line} (matched "${match.query}")`)
    lines.push(match.excerpt)
  }

  return lines.join('\n')
}
