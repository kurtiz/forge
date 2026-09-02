/**
 * Scheduled monitoring, on the project page.
 *
 * Verification before a deploy and monitoring after it are the same run with a
 * different trigger, so this is a small control rather than a second product
 * surface: how often, where to tell someone, and what happened last time.
 */
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { BellIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { Switch } from '@cloudflare/kumo/components/switch'
import { RelativeTime } from '#/components/app/relative-time'
import { SCHEDULE_CADENCES, type Schedule } from '#/server/contracts'
import { removeSchedule, saveSchedule } from '#/server/api'

const CADENCE_LABEL: Record<number, string> = {
  30: 'Every 30 minutes',
  60: 'Hourly',
  180: 'Every 3 hours',
  360: 'Every 6 hours',
  720: 'Twice a day',
  1440: 'Daily',
}

const OUTCOME_TEXT: Record<string, string> = {
  passed: 'Passing',
  failed: 'Failing',
  error: 'Could not complete',
}

export function SchedulePanel({
  projectId,
  schedule,
}: {
  projectId: string
  schedule: Schedule | null
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false)
  const [cadence, setCadence] = useState<number>(schedule?.cadenceMinutes ?? 360)
  const [notifyUrl, setNotifyUrl] = useState(schedule?.notifyUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(next: { enabled?: boolean; cadence?: number }) {
    setBusy(true)
    setError(null)
    try {
      await saveSchedule({
        data: {
          projectId,
          cadenceMinutes: next.cadence ?? cadence,
          enabled: next.enabled ?? enabled,
          notifyUrl,
        },
      })
      await router.invalidate()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not save the schedule.',
      )
      // Put the toggle back where it was, so the control never claims a state
      // the server did not accept.
      setEnabled(schedule?.enabled ?? false)
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await removeSchedule({ data: { projectId } })
      setEnabled(false)
      setNotifyUrl('')
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  const outcome = schedule?.lastOutcome
  const outcomeTone =
    outcome === 'passed'
      ? 'text-[var(--forge-pass)]'
      : outcome === 'failed'
        ? 'text-[var(--forge-fail)]'
        : 'text-kumo-subtle'

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Switch
          label="Verify on a schedule"
          checked={enabled}
          disabled={busy}
          onCheckedChange={(checked) => {
            setEnabled(checked)
            void save({ enabled: checked })
          }}
        />
        {schedule?.lastRunAt ? (
          <div className="text-xs text-kumo-subtle">
            <span className={outcomeTone}>
              {OUTCOME_TEXT[outcome ?? ''] ?? 'Not run yet'}
            </span>
            {' · last checked '}
            <RelativeTime iso={schedule.lastRunAt} />
          </div>
        ) : null}
      </div>

      {enabled ? (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Select
              label="How often"
              value={String(cadence)}
              disabled={busy}
              onValueChange={(value) => {
                const next = Number(value)
                setCadence(next)
                void save({ cadence: next })
              }}
            >
              {SCHEDULE_CADENCES.map((minutes) => (
                <Select.Option key={minutes} value={String(minutes)}>
                  {CADENCE_LABEL[minutes]}
                </Select.Option>
              ))}
            </Select>

            <div>
              <Input
                label="Notification webhook"
                inputMode="url"
                placeholder="https://hooks.slack.com/services/…"
                description="Optional. Posts JSON when the result changes, and every fourth failure after that."
                value={notifyUrl}
                disabled={busy}
                onChange={(e) => setNotifyUrl(e.currentTarget.value)}
                onBlur={() => void save({})}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-kumo-subtle">
            <BellIcon size={14} />
            {schedule?.nextRunAt ? (
              <span>
                Next check <RelativeTime iso={schedule.nextRunAt} />
              </span>
            ) : (
              <span>The next check is being scheduled.</span>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={stop}>
              Remove schedule
            </Button>
          </div>
        </>
      ) : (
        <p className="m-0 max-w-[62ch] text-sm text-kumo-subtle">
          Forge re-runs the journeys it discovered and tells you when a
          deployment that used to work stops working. Same engine, same
          evidence, same findings, on a timer.
        </p>
      )}

      {error ? (
        <p role="alert" className="m-0 text-sm text-[var(--forge-fail)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
