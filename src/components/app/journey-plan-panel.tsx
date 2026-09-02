/**
 * The journeys a project asks for by name.
 *
 * Discovery is a guess, and it is a different guess each run: the journey a
 * team actually cares about can drop off the list because a model ranked a
 * settings page higher this time. What is planned here runs every time, in
 * priority order, before anything discovered - and takes the place of a
 * discovered journey rather than being added on top, because the budget is the
 * same either way.
 *
 * Priority is a number between 0 and 1, entered as one: it is the same scale
 * the run page shows, and inventing a second vocabulary for it here would only
 * mean translating between them.
 */
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  PencilSimpleIcon,
  PlusIcon,
  SignpostIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import type { ProjectJourney } from '#/server/contracts'
import {
  addProjectJourney,
  editProjectJourney,
  removeProjectJourney,
} from '#/server/api'

type Draft = {
  name: string
  goal: string
  entryPath: string
  priority: string
}

const emptyDraft: Draft = {
  name: '',
  goal: '',
  entryPath: '/',
  priority: '0.8',
}

/** A priority the server will accept, from whatever was typed. */
function toPriority(input: string): number {
  const parsed = Number.parseFloat(input)
  if (!Number.isFinite(parsed)) return 0.5
  return Math.max(0, Math.min(1, Number(parsed.toFixed(2))))
}

export function JourneyPlanPanel({
  projectId,
  journeys,
}: {
  projectId: string
  journeys: ProjectJourney[]
}) {
  const router = useRouter()
  /** Which journey is being edited, `new` for the add form, null for neither. */
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startAdd() {
    setDraft(emptyDraft)
    setEditing('new')
    setError(null)
  }

  function startEdit(journey: ProjectJourney) {
    setDraft({
      name: journey.name,
      goal: journey.goal,
      entryPath: journey.entryPath,
      priority: String(journey.priority),
    })
    setEditing(journey.id)
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const fields = {
      name: draft.name,
      goal: draft.goal,
      entryPath: draft.entryPath,
      priority: toPriority(draft.priority),
    }

    try {
      if (editing === 'new') {
        await addProjectJourney({ data: { projectId, ...fields } })
      } else if (editing) {
        await editProjectJourney({ data: { journeyId: editing, ...fields } })
      }

      setEditing(null)
      setDraft(emptyDraft)
      await router.invalidate()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not save the journey.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(journey: ProjectJourney) {
    if (!confirm(`Stop verifying "${journey.name}"?`)) return
    await removeProjectJourney({ data: { journeyId: journey.id } })
    await router.invalidate()
  }

  /** Off rather than deleted, so a journey can be rested for a run or two. */
  async function toggle(journey: ProjectJourney) {
    await editProjectJourney({
      data: {
        journeyId: journey.id,
        name: journey.name,
        goal: journey.goal,
        entryPath: journey.entryPath,
        priority: journey.priority,
        enabled: !journey.enabled,
      },
    })
    await router.invalidate()
  }

  return (
    <div className="grid gap-5">
      <p className="m-0 max-w-[62ch] text-sm text-kumo-subtle">
        Journeys named here run every time, in priority order, before anything
        Forge discovers on its own. Leave it empty and every journey comes from
        discovery, which is a good guess but a different guess each run.
      </p>

      {journeys.length === 0 && editing !== 'new' ? (
        <Empty
          size="sm"
          title="No journeys planned"
          description="Forge will decide what to verify each run."
          contents={
            <Button variant="secondary" onClick={startAdd} icon={<PlusIcon size={14} />}>
              Plan a journey
            </Button>
          }
        />
      ) : null}

      {journeys.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
          {journeys.map((journey) => (
            <li key={journey.id}>
              {editing === journey.id ? (
                <JourneyForm
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={save}
                  onCancel={() => setEditing(null)}
                  busy={busy}
                  submitLabel="Save changes"
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <SignpostIcon
                    size={16}
                    className={
                      journey.enabled
                        ? 'shrink-0 text-kumo-subtle'
                        : 'shrink-0 text-kumo-hairline'
                    }
                  />
                  <span
                    className={
                      journey.enabled
                        ? 'font-medium text-kumo-strong'
                        : 'font-medium text-kumo-subtle line-through'
                    }
                  >
                    {journey.name}
                  </span>
                  <code className="font-mono text-xs text-kumo-subtle">
                    {journey.entryPath}
                  </code>
                  <span className="min-w-0 flex-1 truncate text-sm text-kumo-subtle">
                    {journey.goal}
                  </span>

                  <div className="ml-auto flex items-center gap-2">
                    <span className="rounded border border-kumo-hairline px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-kumo-subtle">
                      {journey.priority.toFixed(2)}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => toggle(journey)}>
                      {journey.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      variant="ghost"
                      shape="square"
                      size="sm"
                      aria-label={`Edit ${journey.name}`}
                      onClick={() => startEdit(journey)}
                    >
                      <PencilSimpleIcon size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      shape="square"
                      size="sm"
                      aria-label={`Remove ${journey.name}`}
                      onClick={() => remove(journey)}
                    >
                      <TrashIcon size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {editing === 'new' ? (
        <JourneyForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={save}
          onCancel={() => setEditing(null)}
          busy={busy}
          submitLabel="Plan journey"
        />
      ) : journeys.length > 0 ? (
        <div>
          <Button variant="ghost" onClick={startAdd} icon={<PlusIcon size={14} />}>
            Plan another journey
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 text-sm text-[var(--forge-fail)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function JourneyForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  busy,
  submitLabel,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  onSubmit: (event: React.FormEvent) => void
  onCancel: () => void
  busy: boolean
  submitLabel: string
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Journey"
          required
          placeholder="Add a referral"
          description="The words the application uses for it."
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
        />
        <Input
          label="Starts at"
          placeholder="/referrals"
          description="A path on the target site."
          value={draft.entryPath}
          onChange={(e) => setDraft({ ...draft, entryPath: e.currentTarget.value })}
        />
        <Input
          label="What it should do"
          placeholder="Send a referral for an existing patient"
          value={draft.goal}
          onChange={(e) => setDraft({ ...draft, goal: e.currentTarget.value })}
        />
        <Input
          label="Priority"
          type="number"
          min={0}
          max={1}
          step={0.05}
          description="0 to 1. How damaging it would be if this broke."
          value={draft.priority}
          onChange={(e) => setDraft({ ...draft, priority: e.currentTarget.value })}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" loading={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
