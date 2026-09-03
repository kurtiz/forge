/**
 * Values that are true of the target application.
 *
 * The agent invents what it types, and invented data is right up until the
 * application checks it against itself: a referral form looks a patient up by
 * phone number, and no number Forge can invent will find one. A sample value
 * is somebody who knows the application saying "this one exists" - matched to
 * a field by its label and typed in place of the synthetic value.
 *
 * Not a place for credentials. These are shown back here and written into run
 * evidence like any other typed value; a login belongs in Test accounts, which
 * is encrypted and never read back.
 */
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { PencilSimpleIcon, PlusIcon, TableIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import type { ProjectSampleValue } from '@/server/contracts'
import { addSampleValue, editSampleValue, removeSampleValue } from '@/server/api'

type Draft = { label: string; value: string }

const emptyDraft: Draft = { label: '', value: '' }

export function SampleDataPanel({
  projectId,
  values,
}: {
  projectId: string
  values: ProjectSampleValue[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startAdd() {
    setDraft(emptyDraft)
    setEditing('new')
    setError(null)
  }

  function startEdit(sample: ProjectSampleValue) {
    setDraft({ label: sample.label, value: sample.value })
    setEditing(sample.id)
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      if (editing === 'new') {
        await addSampleValue({
          data: { projectId, label: draft.label, value: draft.value },
        })
      } else if (editing) {
        await editSampleValue({
          data: { sampleValueId: editing, label: draft.label, value: draft.value },
        })
      }

      setEditing(null)
      setDraft(emptyDraft)
      await router.invalidate()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not save the value.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(sample: ProjectSampleValue) {
    if (!confirm(`Remove the sample value for "${sample.label}"?`)) return
    await removeSampleValue({ data: { sampleValueId: sample.id } })
    await router.invalidate()
  }

  return (
    <div className="grid gap-5">
      <p className="m-0 max-w-[62ch] text-sm text-kumo-subtle">
        Forge invents what it types into a form. That works until the
        application checks the value against itself — a lookup that has to find
        a real patient, an order number that has to exist. Name the field as the
        form labels it and give a value that works. Never a password.
      </p>

      {values.length === 0 && editing !== 'new' ? (
        <Empty
          size="sm"
          title="No sample data"
          description="Forge fills every field with invented values."
          contents={
            <Button variant="secondary" onClick={startAdd} icon={<PlusIcon size={14} />}>
              Add a value
            </Button>
          }
        />
      ) : null}

      {values.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
          {values.map((sample) => (
            <li key={sample.id}>
              {editing === sample.id ? (
                <SampleForm
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={save}
                  onCancel={() => setEditing(null)}
                  busy={busy}
                  submitLabel="Save changes"
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <TableIcon size={16} className="shrink-0 text-kumo-subtle" />
                  <span className="font-medium text-kumo-strong">{sample.label}</span>
                  <code className="min-w-0 truncate font-mono text-xs text-kumo-subtle">
                    {sample.value}
                  </code>

                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="ghost"
                      shape="square"
                      size="sm"
                      aria-label={`Edit ${sample.label}`}
                      onClick={() => startEdit(sample)}
                    >
                      <PencilSimpleIcon size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      shape="square"
                      size="sm"
                      aria-label={`Remove ${sample.label}`}
                      onClick={() => remove(sample)}
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
        <SampleForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={save}
          onCancel={() => setEditing(null)}
          busy={busy}
          submitLabel="Add value"
        />
      ) : values.length > 0 ? (
        <div>
          <Button variant="ghost" onClick={startAdd} icon={<PlusIcon size={14} />}>
            Add another value
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

function SampleForm({
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
          label="Field"
          required
          placeholder="Phone number"
          description="As the form labels it. Every word has to appear in the field."
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })}
        />
        <Input
          label="Value"
          required
          autoComplete="off"
          placeholder="0244123456"
          description="Something that exists in the application."
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.currentTarget.value })}
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
