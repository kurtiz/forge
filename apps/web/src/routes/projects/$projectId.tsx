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
import { Input } from '@cloudflare/kumo/components/input'
import { BackLink, Page, PageHeader, Section, TopBar } from '@/components/app/shell'
import { RunStatusPill, TriggerTag } from '@/components/app/status'
import { useConfirm } from '@/components/app/confirm'
import { RelativeTime } from '@/components/app/relative-time'
import { ExecutorNotice } from '@/components/app/executor-notice'
import { SchedulePanel } from '@/components/app/schedule-panel'
import { CredentialsPanel } from '@/components/app/credentials-panel'
import {
  RequestHeadersHelp,
  RequestHeadersPanel,
} from '@/components/app/request-headers-panel'
import { JourneyPlanPanel } from '@/components/app/journey-plan-panel'
import { SampleDataPanel } from '@/components/app/sample-data-panel'
import {
  deleteProject,
  getProject,
  startVerification,
  updateProject,
} from '@/server/api'

export const Route = createFileRoute('/projects/$projectId')({
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: '/sign-in' })
  },
  loader: ({ params }) => getProject({ data: { projectId: params.projectId } }),
  component: ProjectPage,
})

function ProjectPage() {
  const {
    project,
    runs,
    schedule,
    credentials,
    plannedJourneys,
    sampleValues,
    headers,
  } = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  /** Why the last attempt to start a run did not start one. */
  const [runError, setRunError] = useState<string | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState(
    project.previewUrlTemplate ?? '',
  )
  /** The stated priority, editable in place. Empty clears it. */
  const [goal, setGoal] = useState(project.goal ?? '')
  const [editingGoal, setEditingGoal] = useState(false)

  async function run() {
    setBusy(true)
    setRunError(null)
    try {
      const created = await startVerification({ data: { projectId: project.id } })
      await router.navigate({ to: '/runs/$runId', params: { runId: created.id } })
    } catch (failure) {
      // A rate limit is the expected one, and it is worth reading: the button
      // otherwise looks broken to whoever pressed it once too often.
      setRunError(
        failure instanceof Error
          ? failure.message
          : 'Could not start a verification.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function savePreviewTemplate() {
    if (previewTemplate === (project.previewUrlTemplate ?? '')) return
    await updateProject({
      data: { projectId: project.id, previewUrlTemplate: previewTemplate },
    })
    await router.invalidate()
  }

  async function saveGoal() {
    setEditingGoal(false)
    if (goal.trim() === (project.goal ?? '')) return
    await updateProject({ data: { projectId: project.id, goal } })
    await router.invalidate()
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete "${project.name}"?`,
      description:
        'Every run, finding, and piece of evidence for this project is deleted too. This cannot be undone.',
      action: 'Delete project',
    })
    if (!ok) return
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
            <BackLink to="/dashboard" className="text-xs text-kumo-subtle">
              Verification
            </BackLink>
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
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-kumo-subtle">Priority</dt>
                <dd className="m-0 min-w-0 flex-1">
                  {editingGoal ? (
                    <Input
                      aria-label="What matters most about this application"
                      autoFocus
                      placeholder="Customers must be able to check out with a coupon"
                      value={goal}
                      onChange={(e) => setGoal(e.currentTarget.value)}
                      onBlur={saveGoal}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') {
                          setGoal(project.goal ?? '')
                          setEditingGoal(false)
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingGoal(true)}
                      className="cursor-text border-0 bg-transparent p-0 text-left text-inherit"
                    >
                      {project.goal ?? (
                        <span className="text-kumo-subtle italic">
                          What matters most about this application?
                        </span>
                      )}
                    </button>
                  )}
                </dd>
              </div>
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

        {runError ? (
          <p role="alert" className="m-0 text-sm text-[var(--forge-fail)]">
            {runError}
          </p>
        ) : null}

        <ExecutorNotice executor={session.executor} />

        <Section
          title="Journeys"
          meta={
            plannedJourneys.length > 0
              ? `${plannedJourneys.length} planned`
              : 'discovered each run'
          }
        >
          <JourneyPlanPanel projectId={project.id} journeys={plannedJourneys} />
        </Section>

        <Section
          title="Sample data"
          meta={sampleValues.length > 0 ? `${sampleValues.length} values` : undefined}
        >
          <SampleDataPanel projectId={project.id} values={sampleValues} />
        </Section>

        <Section
          title="Test accounts"
          meta={credentials.length > 0 ? `${credentials.length} stored` : undefined}
        >
          <CredentialsPanel projectId={project.id} credentials={credentials} />
        </Section>

        <Section
          title="Request headers"
          help={<RequestHeadersHelp />}
          meta={headers.length > 0 ? `${headers.length} sent` : undefined}
        >
          <RequestHeadersPanel
            projectId={project.id}
            headers={headers}
            targetUrl={project.targetUrl}
          />
        </Section>

        <Section title="Monitoring">
          <SchedulePanel projectId={project.id} schedule={schedule} />
        </Section>

        {/*
          Only when both halves exist: a repository to watch, and a GitHub App
          on this deployment to watch it with. Without the App there is no check
          to post, so the preview pattern would configure nothing.
        */}
        {project.repoUrl && session.githubApp ? (
          <Section title="Pull requests">
            <p className="mt-0 mb-5 max-w-[62ch] text-sm text-kumo-subtle">
              With the GitHub App installed, Forge verifies each pull request's
              preview deployment and posts a check on the commit. Most hosts
              announce their previews to GitHub and nothing else is needed. If
              yours does not, give the pattern here.
            </p>
            <Input
              label="Preview URL pattern"
              inputMode="url"
              placeholder="https://pr-{number}.yourapp.pages.dev"
              description="Optional. Placeholders: {number}, {branch}, {sha}, {sha7}."
              value={previewTemplate}
              onChange={(e) => setPreviewTemplate(e.currentTarget.value)}
              onBlur={savePreviewTemplate}
            />
          </Section>
        ) : null}

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
                    <TriggerTag
                      trigger={entry.trigger}
                      pullRequestNumber={entry.pullRequestNumber}
                    />
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
