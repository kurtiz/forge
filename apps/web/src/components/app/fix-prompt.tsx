/**
 * How to fix a finding.
 *
 * A finding page that stops at the evidence leaves the reader to work out who
 * owns the problem, and the two most common findings - a bot challenge and a
 * missing test account - are owned by nobody who reads application code. So the
 * ownership is stated first, then the steps, and then the brief.
 *
 * The brief is a block of text and a copy button, because that is how it gets
 * used: it is pasted into a coding agent. It is shown rather than hidden behind
 * the button so nobody hands their agent a prompt they have not read.
 */
import { useRef, useState } from 'react'
import { CheckIcon, CopyIcon, WrenchIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Section } from '@/components/app/shell'
import { REMEDIATION_OWNER_LABEL } from '@/components/app/status'
import type { Remediation } from '@/server/domain/remediation'

export function FixPanel({ remediation }: { remediation: Remediation }) {
  return (
    <Section
      title="How to fix this"
      meta={REMEDIATION_OWNER_LABEL[remediation.owner]}
    >
      <div className="flex items-start gap-2.5">
        <span className="h-lh flex items-center">
          <WrenchIcon size={16} className="shrink-0 text-kumo-subtle" />
        </span>
        <p className="m-0 max-w-[70ch] text-sm leading-relaxed font-medium text-kumo-strong">
          {remediation.headline}
        </p>
      </div>

      <ol className="mt-4 mb-0 max-w-[70ch] list-decimal space-y-2 pl-5 text-sm leading-relaxed text-kumo-subtle">
        {remediation.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {remediation.prompt ? <AgentPrompt prompt={remediation.prompt} /> : null}
    </Section>
  )
}

function AgentPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      // A browser that refuses the clipboard leaves the text on screen to
      // select by hand, which is why it is never hidden.
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-6 rounded-lg bg-kumo-recessed p-1.5 ring ring-kumo-hairline">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
        <p className="m-0 text-xs text-kumo-subtle">
          Paste this into your coding agent. It carries the evidence above and
          nothing else.
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={copy}
          icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        >
          {copied ? 'Copied' : 'Copy prompt'}
        </Button>
      </div>
      <pre className="m-0 max-h-96 overflow-auto rounded-md bg-kumo-base px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-kumo-secondary">
        {prompt}
      </pre>
    </div>
  )
}
