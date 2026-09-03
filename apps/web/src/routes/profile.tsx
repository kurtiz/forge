/**
 * Profile.
 *
 * Who you are signed in as, and what that account can do. Short on purpose:
 * everything actionable about an account lives in Settings, and a profile page
 * that duplicates it just gives people two places to look.
 */
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Avatar } from '@/components/app/account-menu'
import { Page, PageHeader, Section, TopBar } from '@/components/app/shell'
import { RelativeTime } from '@/components/app/relative-time'
import { getProfile } from '@/server/api'

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: '/sign-in' })
  },
  loader: () => getProfile(),
  component: ProfilePage,
})

function ProfilePage() {
  const { user, stats } = Route.useLoaderData()
  const { session } = Route.useRouteContext()

  return (
    <>
      <TopBar user={session.user} />
      <Page>
        <PageHeader title="Profile" />

        <div className="flex items-center gap-4">
          <Avatar user={user} size={56} />
          <div className="min-w-0">
            <div className="text-lg font-semibold text-kumo-strong">
              {user.isAnonymous ? 'Guest session' : user.name}
            </div>
            <div className="truncate text-sm text-kumo-subtle">{user.email}</div>
          </div>
        </div>

        {user.isAnonymous ? (
          <div className="mt-6 rounded-lg border border-kumo-hairline bg-kumo-recessed p-4">
            <p className="m-0 text-sm text-kumo-secondary">
              This is a guest account. It owns its projects and runs like any
              other, but it has no password, so once this browser forgets the
              session there is no way back into it.
            </p>
            <Link
              to="/sign-in"
              search={{ upgrade: true }}
              className="mt-3 inline-block no-underline"
            >
              <Button variant="primary" size="sm" icon={<ArrowRightIcon size={14} />}>
                Save this session
              </Button>
            </Link>
          </div>
        ) : null}

        <Section title="Account">
          <dl className="m-0 grid gap-3 text-sm">
            <Field label="Name" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field
              label="Sign-in"
              value={
                user.isAnonymous
                  ? 'Guest'
                  : user.providers.length > 0
                    ? user.providers.join(', ')
                    : 'Email and password'
              }
            />
            <Field
              label="Joined"
              value={<RelativeTime iso={user.createdAt} />}
            />
          </dl>
        </Section>

        <Section title="Usage">
          <dl className="m-0 grid gap-3 text-sm">
            <Field label="Projects" value={String(stats.projects)} />
            <Field label="Runs" value={String(stats.runs)} />
            <Field label="Open findings" value={String(stats.openFindings)} />
          </dl>
        </Section>

        {!user.isAnonymous ? (
          <p className="mt-8 text-sm text-kumo-subtle">
            API tokens and the GitHub connection live in{' '}
            <Link to="/settings">Settings</Link>.
          </p>
        ) : null}
      </Page>
    </>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="w-32 shrink-0 text-kumo-subtle">{label}</dt>
      <dd className="m-0 min-w-0 text-kumo-strong">{value}</dd>
    </div>
  )
}
