/**
 * New project.
 *
 * Target URL is the only required field. The repository and the workflow
 * description are optional because a URL alone is enough to run, and asking for
 * more up front is the fastest way to lose someone evaluating the product.
 *
 * Creating does not start a run. The rest of what steers a run - planned
 * journeys, sample data, more test accounts, request headers - is set on the
 * project page, and a form that ran immediately gave people no moment to set
 * any of it. The project page opens with "Run verification" as its primary
 * action, so the run is one click away rather than automatic.
 */
import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { z } from 'zod'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { Switch } from '@cloudflare/kumo/components/switch'
import { Page, PageHeader, TopBar } from '@/components/app/shell'
import { ExecutorNotice } from '@/components/app/executor-notice'
import { createProject } from '@/server/api'

export const Route = createFileRoute('/projects/new')({
  validateSearch: z.object({ demo: z.boolean().optional() }),
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: '/sign-in' })
  },
  component: NewProject,
})

function NewProject() {
  const router = useRouter()
  const { session } = Route.useRouteContext()
  const { demo } = Route.useSearch()

  const demoUrl =
    typeof window === 'undefined' ? '/demo' : `${window.location.origin}/demo`

  const [name, setName] = useState(demo ? 'Northbeam (demo)' : '')
  const [targetUrl, setTargetUrl] = useState(demo ? demoUrl : '')
  const [repoUrl, setRepoUrl] = useState('')
  const [goal, setGoal] = useState('')
  const [authLabel, setAuthLabel] = useState('')
  const [authLoginPath, setAuthLoginPath] = useState('')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const project = await createProject({
        data: {
          name,
          targetUrl,
          repoUrl,
          goal,
          // Sent only while the switch is on, so turning it off after typing
          // does not quietly store a login the form no longer shows.
          authLabel: needsLogin ? authLabel : undefined,
          authLoginPath: needsLogin ? authLoginPath : undefined,
          authUsername: needsLogin ? authUsername : undefined,
          authPassword: needsLogin ? authPassword : undefined,
        },
      })
      await router.invalidate()
      await router.navigate({
        to: '/projects/$projectId',
        params: { projectId: project.id },
      })
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not create the project.',
      )
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar user={session.user} />
      <Page>
        <PageHeader
          title="New project"
          description="Forge opens this URL and works out what the application does. Once the project exists you can add journeys, sample data, and request headers, then run the first verification."
        />

        <ExecutorNotice executor={session.executor} />

        <form onSubmit={submit} className="grid gap-5">
          <Input
            label="Project name"
            required
            placeholder="Northbeam"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />

          <Input
            label="Target URL"
            required
            inputMode="url"
            placeholder="https://preview.yourapp.com"
            description="A deployed, publicly reachable URL. Use a preview or staging environment, never production with real data."
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.currentTarget.value)}
          />

          <Input
            label="GitHub repository"
            placeholder="https://github.com/owner/repo"
            description="Optional. A public repository lets Forge connect a runtime failure to the source that caused it."
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.currentTarget.value)}
          />

          <Input
            label="What matters most"
            placeholder="Customers must be able to check out with a coupon"
            description="Optional. Describing the important workflow steers which journeys get the budget."
            value={goal}
            onChange={(e) => setGoal(e.currentTarget.value)}
          />

          <div className="rounded-lg border border-kumo-hairline p-4">
            <Switch
              label="This app needs a login"
              checked={needsLogin}
              onCheckedChange={setNeedsLogin}
            />

            {needsLogin ? (
              <div className="mt-5 grid gap-5">
                <p className="m-0 text-sm text-kumo-secondary">
                  Forge signs in once at the start of a run and reuses the
                  session for every journey. Use a{' '}
                  <strong>dedicated test account</strong>, never production
                  credentials. The password is encrypted before it is stored and
                  is never shown again, never sent to the model, and never
                  written to a log, an artifact, or the run timeline. You can add
                  more accounts, one per role, once the project exists.
                </p>

                <Input
                  label="What this account is"
                  placeholder="Administrator"
                  description="Optional. Useful once the project has more than one."
                  value={authLabel}
                  onChange={(e) => setAuthLabel(e.currentTarget.value)}
                />

                <Input
                  label="Login path"
                  placeholder="/login"
                  description="Path on the target site carrying the login form. Defaults to /login."
                  value={authLoginPath}
                  onChange={(e) => setAuthLoginPath(e.currentTarget.value)}
                />

                <Input
                  label="Username or email"
                  autoComplete="off"
                  placeholder="test-account@example.com"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.currentTarget.value)}
                />

                <Input
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  description="Single sign-on, magic links, and second factors are not supported yet."
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.currentTarget.value)}
                />
              </div>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="m-0 rounded-lg border border-kumo-hairline bg-kumo-base px-3 py-2 text-sm text-[var(--forge-fail)]"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={busy}
              icon={<ArrowRightIcon size={16} />}
            >
              Create project
            </Button>
            {!demo ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setName('Northbeam (demo)')
                  setTargetUrl(demoUrl)
                  setGoal('Customers must be able to check out and invite teammates')
                }}
              >
                Use the demo app
              </Button>
            ) : null}
          </div>
        </form>
      </Page>
    </>
  )
}
