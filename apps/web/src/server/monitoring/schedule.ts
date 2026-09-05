/**
 * Schedule arithmetic and notification wording.
 *
 * Pure, so the cadence maths and the alert policy are unit tested without a
 * database or a clock. The interesting decision here is `shouldNotify`: a
 * monitor that alerts on every tick of a week-long outage gets muted, and a
 * muted monitor is worth nothing.
 */
import type { ScheduleOutcome } from '@/server/contracts'

export const MIN_CADENCE_MINUTES = 30

/**
 * The next due time after a tick.
 *
 * Anchored to `now` rather than to the previous due time on purpose. Catching
 * up on ticks missed while a schedule was disabled, or while the Worker was
 * not deployed, would fire a burst of billable runs to no benefit.
 */
export function nextRunAt(now: Date, cadenceMinutes: number): string {
  const cadence = Math.max(cadenceMinutes, MIN_CADENCE_MINUTES)
  return new Date(now.getTime() + cadence * 60_000).toISOString()
}

export type NotificationDecision = {
  notify: boolean
  reason: 'first_failure' | 'recovered' | 'still_failing' | 'steady'
}

/**
 * Whether a tick is worth telling someone about.
 *
 * Notify on a transition in either direction, and then only every fourth
 * consecutive failure after the first. Steady green says nothing at all.
 */
export function shouldNotify(input: {
  previousOutcome: ScheduleOutcome | null
  outcome: ScheduleOutcome
  consecutiveFailures: number
}): NotificationDecision {
  const failing = input.outcome !== 'passed'
  const wasFailing = input.previousOutcome !== null && input.previousOutcome !== 'passed'

  if (failing && !wasFailing) return { notify: true, reason: 'first_failure' }
  if (!failing && wasFailing) return { notify: true, reason: 'recovered' }
  if (failing && input.consecutiveFailures % 4 === 0) {
    return { notify: true, reason: 'still_failing' }
  }
  return { notify: false, reason: failing ? 'still_failing' : 'steady' }
}

/**
 * The message body a webhook receives. Slack renders `text` as-is.
 *
 * `fix` is the one line of it that tells the reader what to do rather than what
 * happened. A monitor firing at 03:00 about a target that answers a bot
 * challenge is otherwise a dead end: the summary says nothing was verified, and
 * whoever is holding the pager has to open the console to find out why and
 * whose problem it is. The full brief stays behind the link - a chat message is
 * not the place for two kilobytes of prompt.
 */
export function notificationText(input: {
  reason: NotificationDecision['reason']
  projectName: string
  targetUrl: string
  summary: string
  runUrl: string
  consecutiveFailures: number
  fix?: { headline: string; url: string } | null
}): string {
  const head =
    input.reason === 'recovered'
      ? `✅ ${input.projectName} is passing again`
      : input.reason === 'still_failing'
        ? `❌ ${input.projectName} is still failing (${input.consecutiveFailures} runs in a row)`
        : `❌ ${input.projectName} failed verification`

  const lines = [head, input.targetUrl, input.summary]
  if (input.fix) {
    lines.push(`How to fix: ${input.fix.headline}`, input.fix.url)
  }
  lines.push(input.runUrl)

  return lines.join('\n')
}
