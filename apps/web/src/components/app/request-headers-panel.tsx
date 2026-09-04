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
 *
 * Because the value never comes back, the panel can generate one. The secret
 * only has to be unguessable and has to be pasted into an edge rule, which is
 * a worse job by hand than by button, and the generated value is held on
 * screen once - after the save, next to a copy button - because that is the
 * only moment it exists anywhere the reader can reach.
 */
import { useRef, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  ArrowClockwiseIcon,
  CheckIcon,
  CopyIcon,
  InfoIcon,
  KeyIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { Popover } from '@cloudflare/kumo/components/popover'
import { SensitiveInput } from '@cloudflare/kumo/components/sensitive-input'
import { useConfirm } from '@/components/app/confirm'
import { RelativeTime } from '@/components/app/relative-time'
import type { ProjectHeader } from '@/server/contracts'
import { addProjectHeader, removeProjectHeader } from '@/server/api'

type Draft = { name: string; value: string }

/** The name the docs use in every example rule, so the two agree by default. */
const SUGGESTED_NAME = 'X-Forge-Verify'

const emptyDraft: Draft = { name: '', value: '' }

/**
 * A fresh header secret.
 *
 * 32 bytes from the platform CSPRNG, base64url so it survives a WAF expression,
 * a shell quote, and a dashboard field without escaping. Generated in the
 * browser rather than on the server: nothing is gained by the value making an
 * extra trip, and the reader can generate one before deciding to save it.
 */
function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

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
  /**
   * The value of the header just saved, held for the reader to copy into
   * their edge rule. Nothing can show it again, so it stays until dismissed
   * rather than fading on a timer.
   */
  const [saved, setSaved] = useState<{ name: string; value: string } | null>(
    null,
  )

  function open() {
    setDraft({ name: SUGGESTED_NAME, value: '' })
    setError(null)
    setAdding(true)
  }

  function close() {
    setAdding(false)
    setDraft(emptyDraft)
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await addProjectHeader({
        data: { projectId, name: draft.name, value: draft.value },
      })
      setSaved({ name: draft.name.trim(), value: draft.value.trim() })
      close()
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
    if (saved?.name.toLowerCase() === header.name.toLowerCase()) setSaved(null)
    await removeProjectHeader({ data: { headerId: header.id } })
    await router.invalidate()
  }

  return (
    <div className="grid gap-5">
      <p className="m-0 max-w-[62ch] text-sm text-kumo-subtle">
        Sent on every request Forge makes to{' '}
        <code className="font-mono text-[0.9em]">{originOf(targetUrl)}</code> and
        to nothing else, so a link off the site cannot carry the value away. Use
        one to let verification past a bot challenge or an access gate: store a
        secret here, then write an edge rule that admits requests carrying it.
        Values are encrypted and never shown again.
      </p>

      {saved ? (
        <div className="rounded-lg border border-[var(--forge-accent)] bg-kumo-recessed p-4">
          <p className="m-0 mb-2 text-sm font-medium text-kumo-strong">
            Copy this value now.
          </p>
          <p className="m-0 mb-3 max-w-[62ch] text-xs text-kumo-subtle">
            It is encrypted the moment it is stored and cannot be shown again.
            Your edge rule needs it: match{' '}
            <code className="font-mono">{saved.name}</code> against this exact
            value.
          </p>
          <ClipboardText text={saved.value} size="sm" />
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={() => setSaved(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {headers.length === 0 && !adding ? (
        <Empty
          size="sm"
          title="No headers"
          description="Forge makes plain requests to the target."
          contents={
            <Button
              variant="secondary"
              onClick={open}
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
              placeholder={SUGGESTED_NAME}
              description="Any name your edge rule can match. Not User-Agent."
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />

            {/*
              Generating and typing are the same field, not two modes. A
              Cloudflare Access service token or a Vercel bypass secret is
              issued elsewhere and pasted here; everything else is better off
              random, and the button is the shortest path to that.
            */}
            <div className="grid gap-2">
              <SensitiveInput
                label="Value"
                required
                autoComplete="off"
                placeholder="Paste a secret, or generate one"
                description="Encrypted at rest. Shown here once and never again."
                value={draft.value}
                onValueChange={(value) => setDraft({ ...draft, value })}
              />
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDraft({ ...draft, value: generateSecret() })}
                  icon={<ArrowClockwiseIcon size={13} />}
                >
                  {draft.value ? 'Generate a new secret' : 'Generate a secret'}
                </Button>
                {draft.value ? <CopyButton text={draft.value} /> : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary" loading={busy}>
              Add header
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      ) : headers.length > 0 ? (
        <div>
          <Button variant="ghost" onClick={open} icon={<PlusIcon size={14} />}>
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

/**
 * The "what is this for" control beside the section heading.
 *
 * A popover rather than a tooltip: it carries a link, and a tooltip that
 * disappears when you move towards the link in it is not a control. Sized to
 * answer the question and then get out of the way; the page behind it is where
 * the detail lives.
 */
export function RequestHeadersHelp() {
  return (
    <Popover>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            shape="square"
            size="xs"
            aria-label="What request headers are for"
          >
            <InfoIcon size={14} />
          </Button>
        }
      />
      <Popover.Content side="bottom" align="start" className="max-w-[22rem]">
        <Popover.Title>Why a header</Popover.Title>
        <Popover.Description>
          <span className="block text-sm leading-relaxed">
            Some targets sit behind a bot challenge or an access gate. It answers
            every request with an interstitial, so a run explores the
            interstitial and reports an application with nothing on it.
          </span>
          <span className="mt-2 block text-sm leading-relaxed">
            A header is the way past that without weakening it for anyone else:
            store a secret here, write one edge rule that admits requests
            carrying it, and everyone else still meets the challenge. Forge
            sends it only to this project's own origin, and never sends anything
            that disguises the client.
          </span>
        </Popover.Description>
        <div className="mt-3">
          {/*
            `nativeButton={false}`: the close is a link here, and Base UI
            otherwise assumes a real <button> and warns that the semantics it
            injected have gone nowhere.
          */}
          <Popover.Close
            nativeButton={false}
            render={
              <Link to="/docs/request-headers" className="text-sm font-medium">
                Learn more
              </Link>
            }
          />
        </div>
      </Popover.Content>
    </Popover>
  )
}

/**
 * Copy, with its own feedback.
 *
 * `SensitiveInput` carries a copy button of its own, but it appears on hover,
 * which on a phone means it does not appear. A generated secret is worthless
 * until it reaches an edge rule, so the way to take it has to be visible
 * without a pointer.
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // A browser that refuses the clipboard leaves the value in the field,
      // which is why revealing it is a separate control rather than a mode.
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={copy}
      icon={copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
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
