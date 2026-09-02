/**
 * Dashboard.
 *
 * Projects and recent runs, with the three numbers that answer "is anything
 * broken right now". New users land on the create-project form instead, since
 * an empty dashboard is not worth showing.
 */
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { PlusIcon } from "@phosphor-icons/react";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Page, PageHeader, Section, Stat, TopBar } from "#/components/app/shell";
import { RunStatusPill, TriggerTag } from "#/components/app/status";
import { ExecutorNotice } from "#/components/app/executor-notice";
import { RelativeTime } from "#/components/app/relative-time";
import { getDashboard } from "#/server/api";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: "/sign-in" });
  },
  loader: () => getDashboard(),
  component: Dashboard,
});

function Dashboard() {
  const { projects, recentRuns, stats } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();

  return (
    <>
      <TopBar user={session.user}/>
      <Page wide>
        <PageHeader
          title="Verification"
          description={
            projects.length > 0
              ? "Every project you have pointed Forge at, and what it found."
              : undefined
          }
          actions={
            projects.length > 0 ? (
              <Link to="/projects/new" className="no-underline">
                <Button variant="primary" icon={<PlusIcon size={14}/>}>
                  New project
                </Button>
              </Link>
            ) : null
          }
        />

        <ExecutorNotice executor={session.executor}/>

        {projects.length === 0 ? (
          <div className="grid-field rounded-xl border border-kumo-hairline py-10">
            <Empty
              title="Nothing verified yet"
              description="Add a deployed URL and Forge will explore it, run the journeys that matter, and report what it can prove."
              contents={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Link to="/projects/new" className="no-underline">
                    <Button variant="primary" icon={<PlusIcon size={14}/>}>
                      Add a project
                    </Button>
                  </Link>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      router.navigate({
                        to: "/projects/new",
                        search: { demo: true },
                      })
                    }
                  >
                    Use the demo app
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <>
            <div
              className="grid grid-cols-2 gap-8 border-b border-kumo-hairline pb-8 sm:grid-cols-3">
              <Stat label="Runs" value={stats.totalRuns} hint="Most recent 12"/>
              <Stat
                label="Clean runs"
                value={stats.passRate === null ? "--" : `${stats.passRate}%`}
                hint="Completed runs with no failures"
              />
              <Stat
                label="Open bugs"
                value={stats.openFindings}
                hint="Confirmed and unresolved"
              />
            </div>

            <Section title="Projects" meta={`${projects.length}`}>
              <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className="flex items-center gap-4 py-3 no-underline transition-colors hover:bg-kumo-tint"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-kumo-strong">
                          {project.name}
                        </div>
                        <div className="truncate font-mono text-xs text-kumo-subtle">
                          {project.targetUrl}
                        </div>
                      </div>
                      <RelativeTime iso={project.createdAt}/>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Recent runs">
              {recentRuns.length === 0 ? (
                <p className="py-6 text-sm text-kumo-subtle">
                  No runs yet. Open a project and start one.
                </p>
              ) : (
                <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
                  {recentRuns.map((run) => (
                    <li key={run.id}>
                      <Link
                        to="/runs/$runId"
                        params={{ runId: run.id }}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 no-underline transition-colors hover:bg-kumo-tint"
                      >
                        <RunStatusPill status={run.status}/>
                        <span className="text-sm font-medium text-kumo-strong">
                          {run.projectName}
                        </span>
                        <TriggerTag
                          trigger={run.trigger}
                          pullRequestNumber={run.pullRequestNumber}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-kumo-subtle">
                          {run.summary ?? "In progress"}
                        </span>
                        <RelativeTime iso={run.createdAt}/>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </Page>
    </>
  );
}
