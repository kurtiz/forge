/**
 * Settings.
 *
 * Two things live here, and both are about using Forge from outside the
 * console: API tokens for the CLI and CI, and the GitHub App connection that
 * turns a pull request into a check.
 */
import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ArrowSquareOutIcon,
  GithubLogoIcon,
  PlusIcon,
  TerminalWindowIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text'
import { Page, PageHeader, Section, TopBar } from '@/components/app/shell'
import { useConfirm } from '@/components/app/confirm'
import { RelativeTime } from '@/components/app/relative-time'
import {
  createApiToken,
  disconnectInstallation,
  getSettings,
  revokeApiToken,
} from '@/server/api'

/** Query values GitHub's setup redirect can leave behind. */
const githubResultSchema = z
  .enum(['linked', 'already_linked', 'unknown', 'missing'])
  .optional()

export const Route = createFileRoute('/settings')({
  validateSearch: z.object({ github: githubResultSchema }),
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: '/sign-in' })
  },
  loader: () => getSettings(),
  component: SettingsPage,
})

const GITHUB_MESSAGE: Record<string, string> = {
  linked:
    'GitHub is connected. Pull requests on repositories you have added as projects will now be verified.',
  already_linked:
    'That installation is already connected to a different Forge account.',
  unknown: 'That installation could not be found. Try installing the app again.',
  missing:
    'GitHub did not send an installation id. Try installing the app again.',
}

function SettingsPage() {
  const { tokens, installations, github, isAnonymous } = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const { github: result } = Route.useSearch()

  return (
    <>
      <TopBar user={session.user} />
      <Page>
        <PageHeader
          title="Settings"
          description="Everything for driving Forge from outside this console."
        />

        {result ? (
          <p
            role="status"
            className="m-0 mb-6 rounded-lg border border-kumo-hairline bg-kumo-recessed px-3.5 py-3 text-sm text-kumo-secondary"
          >
            {GITHUB_MESSAGE[result]}
          </p>
        ) : null}

        <TokenSection tokens={tokens} isAnonymous={isAnonymous} />
        <GitHubSection
          installations={installations}
          github={github}
          development={session.development}
        />
      </Page>
    </>
  )
}

/* ---------------------------------------------------------------- tokens */

function TokenSection({
  tokens,
  isAnonymous,
}: {
  tokens: Awaited<ReturnType<typeof getSettings>>['tokens']
  isAnonymous: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Shown once, then gone: only the hash is stored. */
  const [issued, setIssued] = useState<string | null>(null)

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { token } = await createApiToken({ data: { name } })
      setIssued(token)
      setName('')
      await router.invalidate()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not create the token.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function revoke(tokenId: string, tokenName: string) {
    const ok = await confirm({
      title: `Revoke "${tokenName}"?`,
      description: 'Anything using it stops working, including CI.',
      action: 'Revoke',
    })
    if (!ok) return
    await revokeApiToken({ data: { tokenId } })
    await router.invalidate()
  }

  return (
    <Section title="API tokens" meta={`${tokens.length} active`}>
      <p className="mt-0 mb-5 max-w-[62ch] text-sm text-kumo-subtle">
        Tokens authenticate the CLI and CI against the same account you are
        signed in as. A token can start runs and read every result the account
        owns, so treat it like a password.
      </p>

      {isAnonymous ? (
        <Empty
          size="sm"
          title="Create an account first"
          description="A guest session is deleted along with its tokens, which would break anything relying on one."
        />
      ) : (
        <>
          {issued ? (
            <div className="mb-5 rounded-lg border border-[var(--forge-accent)] bg-kumo-recessed p-4">
              <p className="m-0 mb-2 text-sm font-medium text-kumo-strong">
                Copy this token now.
              </p>
              <p className="m-0 mb-3 text-xs text-kumo-subtle">
                It is not stored and cannot be shown again. Forge keeps only its
                hash.
              </p>
              <ClipboardText text={issued} size="sm" />
              <div className="mt-4 rounded-md bg-kumo-base p-3 font-mono text-xs text-kumo-secondary">
                <div className="mb-1 flex items-center gap-1.5 font-sans text-[11px] text-kumo-subtle">
                  <TerminalWindowIcon size={12} />
                  Use it
                </div>
                npm install -g @forge/cli
                <br />
                forge login
                <br />
                forge verify --url https://preview.yourapp.com
              </div>
            </div>
          ) : null}

          <form onSubmit={create} className="mb-6 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Input
                label="Token name"
                required
                placeholder="CI on main"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              loading={busy}
              icon={<PlusIcon size={14} />}
            >
              Create token
            </Button>
          </form>

          {error ? (
            <p role="alert" className="m-0 mb-4 text-sm text-[var(--forge-fail)]">
              {error}
            </p>
          ) : null}

          {tokens.length === 0 ? (
            <Empty
              size="sm"
              title="No tokens yet"
              description="Create one to verify a deployment from your terminal."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
              {tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                >
                  <span className="font-medium text-kumo-strong">
                    {token.name}
                  </span>
                  <code className="font-mono text-xs text-kumo-subtle">
                    {token.prefix}…
                  </code>
                  <span className="ml-auto text-xs text-kumo-subtle">
                    {token.lastUsedAt ? (
                      <>
                        Last used <RelativeTime iso={token.lastUsedAt} />
                      </>
                    ) : (
                      'Never used'
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    shape="square"
                    size="sm"
                    aria-label={`Revoke ${token.name}`}
                    onClick={() => revoke(token.id, token.name)}
                  >
                    <TrashIcon size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  )
}

/* ---------------------------------------------------------------- GitHub */

/**
 * The GitHub connection.
 *
 * Hidden entirely on a deployment where the App is not usable: with no install
 * link to follow and no installation to manage there is nothing here anyone can
 * act on, and telling a visitor which secrets the operator has not set is
 * neither their business nor their problem. Development keeps the section, and
 * says what is missing, on the same reasoning as the GitHub button on /sign-in:
 * a feature that silently does not exist is the hardest kind to configure.
 */
function GitHubSection({
  installations,
  github,
  development,
}: {
  installations: Awaited<ReturnType<typeof getSettings>>['installations']
  github: Awaited<ReturnType<typeof getSettings>>['github']
  development: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()

  const usable =
    github.configured &&
    (github.installUrl !== null || installations.length > 0)
  if (!usable && !development) return null

  async function disconnect(installationId: string, login: string) {
    const ok = await confirm({
      title: `Disconnect ${login}?`,
      description: 'Pull requests in that account stop being verified.',
      action: 'Disconnect',
    })
    if (!ok) return
    await disconnectInstallation({ data: { installationId } })
    await router.invalidate()
  }

  return (
    <Section
      title="GitHub"
      meta={installations.length > 0 ? 'Connected' : undefined}
    >
      <p className="mt-0 mb-5 max-w-[62ch] text-sm text-kumo-subtle">
        With the app installed, Forge verifies each pull request's preview
        deployment and posts the result as a check on the commit. A confirmed
        defect fails the check; a flaky or environmental failure is reported but
        does not block the pull request.
      </p>

      {!github.configured ? (
        <Empty
          size="sm"
          title="Not available on this deployment"
          description="Pull request verification needs a GitHub App. Set all three secrets — any one missing turns the integration off — then redeploy."
          contents={
            <div className="grid gap-3 text-left">
              <div className="rounded-md bg-kumo-base p-3 font-mono text-xs text-kumo-secondary">
                <div className="mb-1 flex items-center gap-1.5 font-sans text-[11px] text-kumo-subtle">
                  <TerminalWindowIcon size={12} />
                  Set them
                </div>
                wrangler secret put GITHUB_APP_ID
                <br />
                wrangler secret put GITHUB_APP_PRIVATE_KEY
                <br />
                wrangler secret put GITHUB_WEBHOOK_SECRET
              </div>
              <p className="m-0 max-w-[52ch] text-xs text-kumo-subtle">
                The private key must be PKCS#8. GitHub issues PKCS#1, so convert
                it once with{' '}
                <code className="font-mono text-[0.9em]">openssl pkcs8</code>{' '}
                before pasting it.
              </p>
            </div>
          }
        />
      ) : installations.length === 0 ? (
        github.installUrl ? (
          <Empty
            size="sm"
            title="No account connected yet"
            description="Install the app on the account that holds your repositories, and pick the ones Forge should verify. You can change that selection on GitHub at any time."
            contents={
              <a href={github.installUrl} className="no-underline">
                <Button variant="secondary" icon={<GithubLogoIcon size={16} />}>
                  Install the GitHub App
                </Button>
              </a>
            }
          />
        ) : (
          <Empty
            size="sm"
            title="Install link unavailable"
            description="Set GITHUB_APP_SLUG so the console can link to the app's install page."
          />
        )
      ) : (
        <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
          {installations.map((installation) => (
            <li
              key={installation.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
            >
              <GithubLogoIcon size={16} className="text-kumo-subtle" />
              <span className="font-medium text-kumo-strong">
                {installation.accountLogin}
              </span>
              <span className="text-xs text-kumo-subtle">
                {installation.accountType}
              </span>
              <a
                href={`https://github.com/settings/installations/${installation.id}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-kumo-subtle no-underline hover:text-kumo-strong"
              >
                Manage on GitHub
                <ArrowSquareOutIcon size={12} />
              </a>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  disconnect(installation.id, installation.accountLogin)
                }
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
