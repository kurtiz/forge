/**
 * Test accounts for a project.
 *
 * An application worth verifying usually has more than one kind of user, and
 * what an administrator can reach is not what a member can reach. A project
 * holds one account per role; a run signs in with the one marked default, which
 * is why exactly one is always marked.
 *
 * Passwords go in and never come back out. Editing an account leaves the
 * password field blank, and blank means "keep the stored one" - the only way to
 * correct a label or a login path without knowing the password again.
 */
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { KeyIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import type { ProjectCredential } from '#/server/contracts'
import {
  addCredential,
  editCredential,
  makeCredentialDefault,
  removeCredential,
} from '#/server/api'

type Draft = {
  label: string
  loginPath: string
  username: string
  password: string
}

const emptyDraft: Draft = {
  label: '',
  loginPath: '',
  username: '',
  password: '',
}

export function CredentialsPanel({
  projectId,
  credentials,
}: {
  projectId: string
  credentials: ProjectCredential[]
}) {
  const router = useRouter()
  /** Which account is being edited, `new` for the add form, null for neither. */
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startAdd() {
    setDraft(emptyDraft)
    setEditing('new')
    setError(null)
  }

  function startEdit(credential: ProjectCredential) {
    setDraft({
      label: credential.label,
      loginPath: credential.loginPath,
      username: credential.username,
      password: '',
    })
    setEditing(credential.id)
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      if (editing === 'new') {
        await addCredential({
          data: {
            projectId,
            label: draft.label,
            loginPath: draft.loginPath,
            username: draft.username,
            password: draft.password,
          },
        })
      } else if (editing) {
        await editCredential({
          data: {
            credentialId: editing,
            label: draft.label,
            loginPath: draft.loginPath,
            username: draft.username,
            password: draft.password,
          },
        })
      }

      setEditing(null)
      setDraft(emptyDraft)
      await router.invalidate()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not save the account.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(credential: ProjectCredential) {
    if (!confirm(`Remove "${credential.label}" (${credential.username})?`)) return
    await removeCredential({ data: { credentialId: credential.id } })
    await router.invalidate()
  }

  async function makeDefault(credential: ProjectCredential) {
    await makeCredentialDefault({ data: { credentialId: credential.id } })
    await router.invalidate()
  }

  return (
    <div className="grid gap-5">
      <p className="m-0 max-w-[62ch] text-sm text-kumo-subtle">
        For an application behind a login. Runs sign in with the default account
        before exploring, so what Forge can verify is whatever that account can
        reach. Add one per role to cover more of the application. Use dedicated
        test accounts — never production credentials.
      </p>

      {credentials.length === 0 && editing !== 'new' ? (
        <Empty
          size="sm"
          title="No test account"
          description="Without one, Forge verifies only what a signed-out visitor can see."
          contents={
            <Button variant="secondary" onClick={startAdd} icon={<PlusIcon size={14} />}>
              Add a test account
            </Button>
          }
        />
      ) : null}

      {credentials.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
          {credentials.map((credential) => (
            <li key={credential.id}>
              {editing === credential.id ? (
                <CredentialForm
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={save}
                  onCancel={() => setEditing(null)}
                  busy={busy}
                  submitLabel="Save changes"
                  passwordHint="Leave blank to keep the stored password."
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <KeyIcon size={16} className="shrink-0 text-kumo-subtle" />
                  <span className="font-medium text-kumo-strong">
                    {credential.label}
                  </span>
                  <span className="min-w-0 truncate text-sm text-kumo-subtle">
                    {credential.username}
                  </span>
                  <code className="font-mono text-xs text-kumo-subtle">
                    {credential.loginPath}
                  </code>

                  <div className="ml-auto flex items-center gap-2">
                    {credential.isDefault ? (
                      <span className="rounded border border-kumo-hairline px-1.5 py-0.5 text-[11px] whitespace-nowrap text-kumo-subtle">
                        Used by runs
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => makeDefault(credential)}
                      >
                        Use for runs
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      shape="square"
                      size="sm"
                      aria-label={`Edit ${credential.label}`}
                      onClick={() => startEdit(credential)}
                    >
                      <PencilSimpleIcon size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      shape="square"
                      size="sm"
                      aria-label={`Remove ${credential.label}`}
                      onClick={() => remove(credential)}
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
        <CredentialForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={save}
          onCancel={() => setEditing(null)}
          busy={busy}
          submitLabel="Add account"
          passwordHint="Single sign-on, magic links, and second factors are not supported yet."
        />
      ) : credentials.length > 0 ? (
        <div>
          <Button variant="ghost" onClick={startAdd} icon={<PlusIcon size={14} />}>
            Add another account
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

function CredentialForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  busy,
  submitLabel,
  passwordHint,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  onSubmit: (event: React.FormEvent) => void
  onCancel: () => void
  busy: boolean
  submitLabel: string
  passwordHint: string
}) {
  return (
    <form onSubmit={onSubmit} className="grid gap-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="What this account is"
          placeholder="Administrator"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })}
        />
        <Input
          label="Login path"
          placeholder="/login"
          value={draft.loginPath}
          onChange={(e) => setDraft({ ...draft, loginPath: e.currentTarget.value })}
        />
        <Input
          label="Username or email"
          required
          autoComplete="off"
          placeholder="test-account@example.com"
          value={draft.username}
          onChange={(e) => setDraft({ ...draft, username: e.currentTarget.value })}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          description={passwordHint}
          value={draft.password}
          onChange={(e) => setDraft({ ...draft, password: e.currentTarget.value })}
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
