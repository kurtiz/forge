/**
 * Finding.
 *
 * The page a developer reads instead of raw logs. It leads with the verdict and
 * the reproduction count, because those are what decide whether to act, then
 * shows the steps that produced it, then the evidence, then the fix loop.
 */
import { useState } from 'react'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { CheckCircleIcon, SealCheckIcon, XCircleIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Page, PageHeader, Section, Stat, TopBar } from '#/components/app/shell'
import {
  ClassificationPill,
  FAILURE_CLASS_LABEL,
  SeverityPill,
} from '#/components/app/status'
import { RelativeTime } from '#/components/app/relative-time'
import { EvidenceList } from '#/components/app/evidence-list'
import { dismissFinding, getFinding, verifyFix } from '#/server/api'

export const Route = createFileRoute('/findings/$findingId')({
  beforeLoad: ({ context }) => {
    if (!context.session.user) throw redirect({ to: '/sign-in' })
  },
  loader: ({ params }) =>
    getFinding({ data: { findingId: params.findingId } }),
  component: FindingPage,
})

function FindingPage() {
  const { finding, run, project, journey, steps, evidence, fixAttempts } =
    Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const router = useRouter()
  const [busy, setBusy] = useState<'verify' | 'dismiss' | null>(null)

  const rate =
    finding.reproductionAttempts > 0
      ? finding.reproductionFailures / finding.reproductionAttempts
      : null

  async function runFixCheck() {
    setBusy('verify')
    try {
      const created = await verifyFix({ data: { findingId: finding.id } })
      await router.navigate({ to: '/runs/$runId', params: { runId: created.id } })
    } finally {
      setBusy(null)
    }
  }

  async function dismiss() {
    setBusy('dismiss')
    try {
      await dismissFinding({ data: { findingId: finding.id } })
      await router.invalidate()
    } finally {
      setBusy(null)
    }
  }

  const verified = fixAttempts.find((a) => a.status === 'verified')

  return (
    <>
      <TopBar user={session.user} />
      <Page wide>
        <PageHeader
          above={
            <span className="flex flex-wrap items-center gap-2 text-xs text-kumo-subtle">
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="no-underline hover:text-kumo-strong"
              >
                {project.name}
              </Link>
              <span>/</span>
              <Link
                to="/runs/$runId"
                params={{ runId: run.id }}
                className="font-mono no-underline hover:text-kumo-strong"
              >
                {run.id}
              </Link>
            </span>
          }
          title={finding.title}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <SeverityPill severity={finding.severity} />
              <ClassificationPill classification={finding.classification} />
              <span className="rounded-md border border-kumo-hairline px-2 py-0.5 text-xs text-kumo-subtle">
                {FAILURE_CLASS_LABEL[finding.failureClass]}
              </span>
              {finding.status !== 'open' ? (
                <span className="rounded-md border border-kumo-hairline px-2 py-0.5 text-xs text-kumo-subtle">
                  {finding.status === 'resolved' ? 'Resolved' : 'Dismissed'}
                </span>
              ) : null}
            </span>
          }
          actions={
            finding.status === 'open' ? (
              <>
                <Button variant="ghost" loading={busy === 'dismiss'} onClick={dismiss}>
                  Dismiss
                </Button>
                <Button
                  variant="primary"
                  loading={busy === 'verify'}
                  onClick={runFixCheck}
                  icon={<SealCheckIcon size={14} />}
                >
                  Verify fix
                </Button>
              </>
            ) : null
          }
        />

        {verified ? (
          <div className="flex items-start gap-3 rounded-lg border border-kumo-hairline bg-kumo-recessed px-4 py-3.5">
            <CheckCircleIcon
              size={18}
              weight="fill"
              className="mt-0.5 shrink-0 text-[var(--forge-pass)]"
            />
            <div>
              <p className="m-0 text-sm font-semibold text-kumo-strong">
                Regression fix verified
              </p>
              <p className="m-0 mt-1 text-sm text-kumo-subtle">
                {verified.summary ??
                  'The original failure no longer reproduces.'}
              </p>
              <Link
                to="/runs/$runId"
                params={{ runId: verified.verificationRunId }}
                className="mt-1.5 inline-block font-mono text-xs"
              >
                {verified.verificationRunId}
              </Link>
            </div>
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-2 gap-8 border-y border-kumo-hairline py-6 sm:grid-cols-4">
          <Stat
            label="Reproduction"
            value={
              finding.reproductionAttempts > 0
                ? `${finding.reproductionFailures} / ${finding.reproductionAttempts}`
                : '--'
            }
            hint={
              rate === null
                ? 'Not an application defect'
                : rate === 1
                  ? 'Every attempt failed'
                  : rate === 0
                    ? 'Did not reproduce'
                    : 'Intermittent'
            }
          />
          <Stat
            label="Confidence"
            value={finding.confidence.toFixed(2)}
            hint="In the finding"
          />
          <Stat
            label="Root cause"
            value={
              finding.rootCauseConfidence === null
                ? '--'
                : finding.rootCauseConfidence.toFixed(2)
            }
            hint={finding.rootCause ? 'Proposed' : 'Not established'}
          />
          <Stat
            label="Found"
            value={<RelativeTime iso={finding.createdAt} className="tabular text-2xl font-semibold text-kumo-strong" />}
            hint={run.executor === 'solari' ? 'Solari browser' : 'HTTP executor'}
          />
        </div>

        <Section title="What happened">
          <p className="m-0 max-w-[70ch] text-sm leading-relaxed text-kumo-strong">
            {finding.description}
          </p>
          {journey ? (
            <p className="m-0 mt-3 max-w-[70ch] text-sm text-kumo-subtle">
              Journey: <span className="text-kumo-strong">{journey.name}</span>.{' '}
              {journey.goal}
            </p>
          ) : null}
        </Section>

        {finding.rootCause ? (
          <Section title="Likely root cause">
            <p className="m-0 max-w-[70ch] text-sm leading-relaxed text-kumo-strong">
              {finding.rootCause}
            </p>
            <p className="m-0 mt-2 text-xs text-kumo-subtle">
              Proposed by the Judge from the evidence above. Confidence{' '}
              {finding.rootCauseConfidence?.toFixed(2) ?? 'unknown'}. Treat it as a
              lead, not a conclusion.
            </p>
            {finding.affectedFiles.length > 0 ? (
              <ul className="mt-3 list-none p-0 font-mono text-xs text-kumo-subtle">
                {finding.affectedFiles.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            ) : null}
          </Section>
        ) : null}

        {steps.length > 0 ? (
          <Section title="Steps to reproduce">
            <ol className="console m-0 list-none rounded-lg p-0 font-mono text-[11.5px]">
              {steps.map((step) => (
                <li key={step.id} className="console-row flex gap-3 px-3 py-2">
                  <span
                    className={`shrink-0 ${
                      step.status === 'failed'
                        ? 'text-[var(--forge-fail)]'
                        : step.status === 'skipped'
                          ? 'text-kumo-subtle'
                          : 'text-[var(--forge-pass)]'
                    }`}
                  >
                    {step.status === 'failed'
                      ? 'FAIL'
                      : step.status === 'skipped'
                        ? 'SKIP'
                        : ' OK '}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-kumo-strong">
                      {step.action}
                      {step.target ? ` "${step.target}"` : ''}
                    </span>
                    {step.expected ? (
                      <span className="block text-kumo-subtle">
                        expected: {step.expected}
                      </span>
                    ) : null}
                    {step.actual ? (
                      <span className="block text-kumo-subtle">
                        actual: {step.actual}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {evidence.length > 0 ? (
          <Section title="Evidence" meta={`${evidence.length} artifacts`}>
            <EvidenceList evidence={evidence} />
          </Section>
        ) : null}

        {fixAttempts.length > 0 ? (
          <Section title="Fix checks">
            <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
              {fixAttempts.map((attempt) => (
                <li
                  key={attempt.id}
                  className="flex flex-wrap items-center gap-3 py-3 text-sm"
                >
                  {attempt.status === 'verified' ? (
                    <CheckCircleIcon
                      size={16}
                      weight="fill"
                      className="text-[var(--forge-pass)]"
                    />
                  ) : attempt.status === 'still_failing' ? (
                    <XCircleIcon
                      size={16}
                      weight="fill"
                      className="text-[var(--forge-fail)]"
                    />
                  ) : (
                    <span className="pulse-live inline-block size-2 rounded-full bg-[var(--forge-live)]" />
                  )}
                  <Link
                    to="/runs/$runId"
                    params={{ runId: attempt.verificationRunId }}
                    className="font-mono text-xs"
                  >
                    {attempt.verificationRunId}
                  </Link>
                  <span className="min-w-0 flex-1 text-kumo-subtle">
                    {attempt.summary ?? 'Running'}
                  </span>
                  <RelativeTime iso={attempt.createdAt} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </Page>
    </>
  )
}
