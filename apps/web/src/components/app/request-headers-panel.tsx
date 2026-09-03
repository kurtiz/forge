/**
 * Headers Forge sends to this project's target.
 *
 * The panel exists for one situation: an edge that challenges automated
 * traffic. The way past it without weakening it for anyone else is a secret
 * only the verifier can present, and a header is the channel for one - a WAF
 * rule that skips the challenge for requests carrying it, a Cloudflare Access
 * service token, a preview-protection bypass.
 *
 * A value is write-only, like the stored password: it is encrypted before it
 * reaches the database and never comes back, so this list shows names only.
 * Replacing one is how it is rotated - adding a name that already exists
 * overwrites its value.
 */
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { KeyIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { useConfirm } from '@/components/app/confirm'
import { RelativeTime } from '@/components/app/relative-time'
import type { ProjectHeader } from '@/server/contracts'
import { addProjectHeader, removeProjectHeader } from '@/server/api'

type Draft = { name: string; value: string }

const emptyDraft: Draft = { name: '', value: '' }

export function RequestHeadersPanel({
  projectId,
  headers,
  targetUrl,
}: {
  projectId: string
  headers: ProjectHeader[]
  targetUrl: string
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await addProjectHeader({
        data: { projectId, name: draft.name, value: draft.value },
      })
      setAdding(false)
      setDraft(emptyDraft)
      await router.invalidate()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not save the header.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(header: ProjectHeader) {
    const ok = await confirm({
      title: `Stop sending ${header.name}?`,
      description:
        'Runs will make plain requests again. If an edge rule matches this header, they will meet whatever it was letting them past.',
      action: 'Remove',
    })
    if (!ok) return
    await removeProjectHeader({ data: { headerId: header.id } })
    await router.invalidate()
  }

  return (
    <div className="grid gap-5">
      <p className="m-0 max-w-[62ch] text-sm text-kumo-subtle">
        Sent on every request Forge makes to{' '}
        <code className="font-mono text-[0.9em]">{originOf(targetUrl)}</code> — and
        to nothing else, so a link off the site cannot carry the value away. Use
        one to let verification past a bot challenge or an access gate: store a
        secret here, then write an edge rule that admits requests carrying it.
        Values are encrypted and never shown again.
      </p>

      {headers.length === 0 && !adding ? (
        <Empty
          size="sm"
          title="No headers"
          description="Forge makes plain requests to the target."
          contents={
            <Button
              variant="secondary"
              onClick={() => setAdding(true)}
              icon={<PlusIcon size={14} />}
            >
              Add a header
            </Button>
          }
        />
      ) : null}

      {headers.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
          {headers.map((header) => (
            <li
              key={header.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
            >
              <KeyIcon size={16} className="shrink-0 text-kumo-subtle" />
              <span className="font-mono text-sm font-medium text-kumo-strong">
                {header.name}
              </span>
              <span className="text-xs text-kumo-subtle">
                value stored · set <RelativeTime iso={header.updatedAt} />
              </span>

              <div className="ml-auto">
                <Button
                  variant="ghost"
                  shape="square"
                  size="sm"
                  aria-label={`Remove ${header.name}`}
                  onClick={() => remove(header)}
                >
                  <TrashIcon size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <form onSubmit={save} className="grid gap-4 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Header"
              required
              autoComplete="off"
              placeholder="X-Forge-Verify"
              description="Any name your edge rule can match. Not User-Agent."
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
            <Input
              label="Value"
              required
              type="password"
              autoComplete="off"
              placeholder="A long random secret"
              description="Encrypted at rest. Shown here once and never again."
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.currentTarget.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary" loading={busy}>
              Add header
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setAdding(false)
                setDraft(emptyDraft)
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : headers.length > 0 ? (
        <div>
          <Button
            variant="ghost"
            onClick={() => setAdding(true)}
            icon={<PlusIcon size={14} />}
          >
            Add another header
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

/** The one place a header is sent, shown as the reader needs to read it. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
