/**
 * Executor disclosure.
 *
 * The two executors have very different fidelity, and a reader has to know
 * which one produced a finding before trusting it. This is shown wherever a run
 * is started or read, not hidden in documentation.
 */
import { InfoIcon } from '@phosphor-icons/react'

export function ExecutorNotice({
  executor,
  className,
}: {
  executor: 'solari' | 'fetch'
  className?: string
}) {
  if (executor === 'solari') return null

  return (
    <div
      className={`mb-6 flex items-start gap-2.5 rounded-lg border border-kumo-hairline bg-kumo-recessed px-3.5 py-3 ${className ?? ''}`}
    >
      <InfoIcon size={16} className="mt-0.5 shrink-0 text-kumo-subtle" />
      <p className="m-0 text-xs leading-relaxed text-kumo-subtle">
        <span className="font-medium text-kumo-strong">
          Running without a browser.
        </span>{' '}
        No <code className="font-mono">SOLARI_API_KEY</code> is configured, so runs
        use the HTTP executor: real requests, real status codes, real form
        submissions, but no JavaScript. Client-rendered pages and client-side
        failures will not be seen. Set the key to run in a real Solari browser
        with screenshots and session replay.
      </p>
    </div>
  )
}
