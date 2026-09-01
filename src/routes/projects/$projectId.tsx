/**
 * Project.
 *
 * Configuration on the left of the header, verification history below. The
 * primary action is always "run it again".
 */
import { useState } from 'react'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { PlayIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Page, PageHeader, Section, TopBar } from '#/components/app/shell'
import { RunStatusPill } from '#/components/app/status'
import { RelativeTime } from '#/components/app/relative-time'
import { ExecutorNotice } from '#/components/app/executor-notice'
import { deleteProject, getProject, startVerification } from '#/server/api'

export const Route = createFileRoute('/projects/$projectId')({
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: '/sign-in' })
  },
  loader: ({ params }) => getProject({ data: { projectId: params.projectId } }),
  component: ProjectPage,
})

function ProjectPage() {
  const { project, runs } = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const created = await startVerification({ data: { projectId: project.id } })
      await router.navigate({ to: '/runs/$runId', params: { runId: created.id } })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete "${project.name}" and all of its runs?`)) return
    await deleteProject({ data: { projectId: project.id } })
    await router.invalidate()
    await router.navigate({ to: '/dashboard' })
  }

  return (
    <>
      <TopBar user={session.user} />
      <Page wide>
        <PageHeader
          above={
            <Link
              to="/dashboard"
              className="text-xs text-kumo-subtle no-underline hover:text-kumo-strong"
            >
              Verification
            </Link>
          }
          title={project.name}
          description={
            <dl className="m-0 grid gap-1">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-kumo-subtle">Target</dt>
                <dd className="m-0 min-w-0 truncate font-mono text-xs">
                  <a href={project.targetUrl} target="_blank" rel="noreferrer">
                    {project.targetUrl}
                  </a>
                </dd>
              </div>
              {project.repoUrl ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-kumo-subtle">Repository</dt>
                  <dd className="m-0 min-w-0 truncate font-mono text-xs">
                    <a href={project.repoUrl} target="_blank" rel="noreferrer">
                      {project.repoUrl.replace('https://github.com/', '')}
                    </a>
                  </dd>
                </div>
              ) : null}
              {project.goal ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-kumo-subtle">Priority</dt>
                  <dd className="m-0">{project.goal}</dd>
                </div>
              ) : null}
            </dl>
          }
          actions={
            <>
              <Button
                variant="ghost"
                shape="square"
                aria-label="Delete project"
                onClick={remove}
              >
                <TrashIcon size={16} />
              </Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={run}
                icon={<PlayIcon size={14} weight="fill" />}
              >
                Run verification
              </Button>
            </>
          }
        />

        <ExecutorNotice executor={session.executor} />

        <Section title="Verification history" meta={`${runs.length} runs`}>
          {runs.length === 0 ? (
            <Empty
              size="sm"
              title="No runs yet"
              description="Start one to see what Forge finds."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
              {runs.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to="/runs/$runId"
                    params={{ runId: entry.id }}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 no-underline transition-colors hover:bg-kumo-tint"
                  >
                    <RunStatusPill status={entry.status} />
                    {entry.trigger === 'verify_fix' ? (
                      <span className="rounded border border-kumo-hairline px-1.5 py-0.5 text-[11px] text-kumo-subtle">
                        Fix check
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm text-kumo-subtle">
                      {entry.summary ?? 'In progress'}
                    </span>
                    <RelativeTime iso={entry.createdAt} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Page>
    </>
  )
}
