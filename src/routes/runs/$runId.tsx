/**
 * Verification run.
 *
 * The primary object in the product. Phase rail at the top, findings first
 * (they are the reason anyone opened this page), then journeys with their
 * steps, then the raw agent trace, then the artifacts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { ArrowSquareOutIcon, FilmSlateIcon, StopCircleIcon } from "@phosphor-icons/react";
import { Button } from "@cloudflare/kumo/components/button";
import { Page, PageHeader, Section, TopBar } from "#/components/app/shell";
import {
  isRunLive,
  JourneyStatusPill,
  RunStatusPill,
  SeverityPill,
  TriggerTag,
} from "#/components/app/status";
import { RelativeTime } from "#/components/app/relative-time";
import { ExecutorNotice } from "#/components/app/executor-notice";
import { useRunStream } from "#/components/app/run-stream";
import { EvidenceList } from "#/components/app/evidence-list";
import { phaseIndex, RUN_PHASES } from "#/server/domain/run-state";
import { getRun, stopRun } from "#/server/api";

export const Route = createFileRoute("/runs/$runId")({
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: "/sign-in" });
  },
  loader: ({ params }) => getRun({ data: { runId: params.runId } }),
  component: RunPage,
});

function RunPage() {
  const { run, project, journeys, steps, findings, evidence, events } =
    Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);

  /*
   * `sync: true` waits for the loader to finish rather than firing and
   * forgetting. Without it the page announced the run was over while still
   * rendering the journeys, findings and evidence it had loaded when the run
   * began, and only a full reload caught up.
   */
  const refresh = useCallback(async () => {
    await router.invalidate({ sync: true });
  }, [router]);

  const { events: liveEvents, live, currentStatus } = useRunStream({
    runId: run.id,
    status: run.status,
    initialEvents: events,
    onFinished: refresh,
  });

  /*
   * Reconciles the stream with what is on screen.
   *
   * The stream can report a run finished before the loader has been asked
   * again - the events arrive on their own connection, and one refresh can
   * land a moment early, while the engine is still writing its last rows. So
   * rather than trusting a single refresh, the page notices that it is showing
   * a live run under a finished stream and asks once more. `attempted` bounds
   * it: this reconciles, it does not poll.
   */
  const reconciled = useRef(false);
  useEffect(() => {
    if (isRunLive(run.status) && !isRunLive(currentStatus) && !reconciled.current) {
      reconciled.current = true;
      void refresh();
    }
    if (!isRunLive(run.status)) reconciled.current = false;
  }, [run.status, currentStatus, refresh]);

  async function stop() {
    setStopping(true);
    try {
      await stopRun({ data: { runId: run.id } });
      await router.invalidate();
    } finally {
      setStopping(false);
    }
  }

  const stepsByJourney = new Map<string, typeof steps>();
  for (const step of steps) {
    const bucket = stepsByJourney.get(step.journeyId) ?? [];
    bucket.push(step);
    stepsByJourney.set(step.journeyId, bucket);
  }

  const recording = evidence.find((e) => e.kind === "recording");
  const replayUrl =
    run.replayUrl ??
    (typeof recording?.metadata.url === "string" ? recording.metadata.url : null);

  return (
    <>
      <TopBar user={session.user}/>
      <Page wide>
        <PageHeader
          above={
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="text-xs text-kumo-subtle no-underline hover:text-kumo-strong"
            >
              {project.name}
            </Link>
          }
          title={
            <span className="flex flex-wrap items-center gap-3">
              Run
              <span className="font-mono text-base font-normal text-kumo-subtle">
                {run.id}
              </span>
              <RunStatusPill status={currentStatus}/>
              <TriggerTag
                trigger={run.trigger}
                pullRequestNumber={run.pullRequestNumber}
              />
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs">{run.targetUrl}</span>
              <span className="text-kumo-subtle">·</span>
              <span className="text-xs">
                {run.executor === "solari"
                  ? "Solari browser"
                  : "HTTP executor, no JavaScript"}
              </span>
              {run.commitSha ? (
                <>
                  <span className="text-kumo-subtle">·</span>
                  <span className="font-mono text-xs">
                    {run.commitSha.slice(0, 7)}
                  </span>
                </>
              ) : null}
              <span className="text-kumo-subtle">·</span>
              <RelativeTime iso={run.createdAt}/>
            </span>
          }
          actions={
            <>
              {replayUrl ? (
                <a href={replayUrl} target="_blank" rel="noreferrer" className="no-underline">
                  <Button variant="secondary" icon={<FilmSlateIcon size={14}/>}>
                    Watch replay
                  </Button>
                </a>
              ) : null}
              {isRunLive(currentStatus) ? (
                <Button
                  variant="secondary-destructive"
                  loading={stopping}
                  onClick={stop}
                  icon={<StopCircleIcon size={14}/>}
                >
                  Stop run
                </Button>
              ) : null}
            </>
          }
        />

        <ExecutorNotice executor={run.executor}/>

        <PhaseRail status={currentStatus}/>

        {run.summary ? (
          <p
            className="mt-6 rounded-lg border border-kumo-hairline bg-kumo-recessed px-4 py-3 text-sm text-kumo-strong">
            {run.summary}
          </p>
        ) : null}

        {findings.length > 0 ? (
          <Section title="Findings" meta={`${findings.length}`}>
            <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
              {findings.map((finding) => (
                <li key={finding.id}>
                  <Link
                    to="/findings/$findingId"
                    params={{ findingId: finding.id }}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 no-underline transition-colors hover:bg-kumo-tint"
                  >
                    <SeverityPill severity={finding.severity}/>
                    <span className="min-w-0 flex-1 text-sm font-medium text-kumo-strong">
                      {finding.title}
                    </span>
                    <span className="tabular shrink-0 text-xs text-kumo-subtle">
                      {finding.reproductionAttempts > 0
                        ? `${finding.reproductionFailures}/${finding.reproductionAttempts} reproduced`
                        : "Not reproduced"}
                    </span>
                    <ArrowSquareOutIcon size={14} className="text-kumo-subtle"/>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          title="Journeys"
          meta={
            journeys.length > 0
              ? `${journeys.filter((j) => j.status === "passed").length} of ${journeys.length} passed`
              : undefined
          }
        >
          {journeys.length === 0 ? (
            <p className="py-6 text-sm text-kumo-subtle">
              {live ? "Exploring the application…" : "No journeys were discovered."}
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
              {journeys.map((journey) => (
                <li key={journey.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <JourneyStatusPill status={journey.status}/>
                    <span className="text-sm font-medium text-kumo-strong">
                      {journey.name}
                    </span>
                    <span className="tabular ml-auto text-xs text-kumo-subtle">
                      priority {journey.priority.toFixed(2)}
                    </span>
                  </div>
                  <p className="mb-0 mt-1.5 text-sm text-kumo-subtle">
                    {journey.goal}
                  </p>

                  {(stepsByJourney.get(journey.id) ?? []).length > 0 ? (
                    <ol className="console mt-3 list-none rounded-lg p-0 font-mono text-[11.5px]">
                      {(stepsByJourney.get(journey.id) ?? []).map((step) => (
                        <li
                          key={step.id}
                          className="console-row flex gap-3 px-3 py-2"
                        >
                          <span
                            className={`shrink-0 ${
                              step.status === "failed"
                                ? "text-[var(--forge-fail)]"
                                : step.status === "skipped"
                                  ? "text-kumo-subtle"
                                  : "text-[var(--forge-pass)]"
                            }`}
                          >
                            {step.status === "failed"
                              ? "FAIL"
                              : step.status === "skipped"
                                ? "SKIP"
                                : " OK "}
                          </span>
                          <span className="min-w-0 flex-1 text-kumo-subtle">
                            <span className="text-kumo-strong">
                              {step.action}
                              {step.target ? ` "${step.target}"` : ""}
                            </span>
                            {step.actual ? `: ${step.actual}` : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Agent trace"
          meta={
            live ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--forge-live)]">
                <span
                  className="pulse-live inline-block size-1.5 rounded-full bg-[var(--forge-live)]"/>
                Live
              </span>
            ) : (
              `${liveEvents.length} events`
            )
          }
        >
          <Timeline events={liveEvents} live={live}/>
        </Section>

        {evidence.length > 0 ? (
          <Section title="Evidence" meta={`${evidence.length} artifacts`}>
            <EvidenceList evidence={evidence}/>
          </Section>
        ) : null}
      </Page>
    </>
  );
}

/** Horizontal phase indicator. Every phase is labelled; colour is secondary. */
function PhaseRail({ status }: { status: Parameters<typeof phaseIndex>[0] }) {
  const current = phaseIndex(status);
  const failed = status === "failed" || status === "canceled";

  return (
    <ol className="m-0 grid list-none grid-cols-3 gap-x-4 gap-y-3 p-0 sm:grid-cols-6">
      {RUN_PHASES.map((phase, i) => {
        const done = current > i;
        const active = current === i && !failed;
        return (
          <li key={phase} className="min-w-0">
            <div
              className="h-0.5 w-full rounded-full transition-colors"
              style={{
                background: failed
                  ? "var(--forge-idle)"
                  : done
                    ? "var(--forge-pass)"
                    : active
                      ? "var(--forge-live)"
                      : "var(--forge-console-line)",
              }}
            />
            <div
              className={`mt-2 truncate text-xs transition-colors ${
                active
                  ? "font-medium text-kumo-strong"
                  : done
                    ? "text-kumo-subtle"
                    : "text-kumo-inactive"
              }`}
            >
              {phase[0].toUpperCase() + phase.slice(1)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const EVENT_TONE: Record<string, string> = {
  "journey.failed": "var(--forge-fail)",
  "run.failed": "var(--forge-fail)",
  "finding.created": "var(--forge-fail)",
  "journey.passed": "var(--forge-pass)",
  "run.completed": "var(--forge-pass)",
  "fix.verified": "var(--forge-pass)",
  "fix.still_failing": "var(--forge-fail)",
  "budget.exhausted": "var(--forge-warn)",
  "run.canceled": "var(--forge-warn)",
};

function Timeline({
                    events,
                    live,
                  }: {
  events: Array<{
    id: string
    sequence: number
    type: string
    message: string
    createdAt: string
  }>
  live: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Follow the tail, but only while the reader is already at it.
  // `scrollIntoView` walks up and scrolls whichever ancestor it has to,
  // including the document, so a streaming run was pulling the findings above
  // out of view on every event. Scrolling the container directly keeps the
  // rest of the page still. The threshold absorbs the row that just landed.
  useEffect(() => {
    if (!live) return;
    const box = boxRef.current;
    if (!box) return;
    const fromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (fromBottom > 96) return;
    box.scrollTop = box.scrollHeight;
  }, [events.length, live]);

  if (events.length === 0) {
    return (
      <p className="py-6 text-sm text-kumo-subtle">
        {live ? "Waiting for the first event…" : "No events were recorded."}
      </p>
    );
  }

  return (
    <div ref={boxRef} className="max-h-[26rem] overflow-y-auto pr-1">
      <ol className="m-0 list-none p-0">
        {events.map((event) => (
          <li key={event.id} className="rail relative flex gap-3 py-1.5 pl-5">
            <span
              aria-hidden
              className="absolute left-1 top-[0.5rem] size-1.5 rounded-full"
              style={{ background: EVENT_TONE[event.type] ?? "var(--forge-idle)" }}
            />
            <time
              dateTime={event.createdAt}
              className="tabular shrink-0 font-mono text-[11px] text-kumo-subtle"
            >
              {new Date(event.createdAt).toLocaleTimeString(undefined, {
                hour12: false,
              })}
            </time>
            <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-kumo-strong">
              {event.message}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
