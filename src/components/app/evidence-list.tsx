/**
 * Evidence list.
 *
 * Artifacts are grouped by kind and always link through the API rather than to
 * R2, so ownership is checked on every fetch. Screenshots get a filmstrip and a
 * viewer of their own, because they are the one artifact people actually look
 * at and a run produces them in a sequence.
 */
import {
  BracketsCurlyIcon,
  FileTextIcon,
  FilmSlateIcon,
  ImageIcon,
  NetworkIcon,
  TerminalWindowIcon,
} from '@phosphor-icons/react'
import type { Evidence, EvidenceKind } from '#/server/contracts'
import { ScreenshotCarousel } from './screenshot-carousel'
import { RelativeTime } from './relative-time'

const ICON: Record<EvidenceKind, React.ComponentType<{ size?: number }>> = {
  screenshot: ImageIcon,
  recording: FilmSlateIcon,
  console: TerminalWindowIcon,
  network: NetworkIcon,
  page: BracketsCurlyIcon,
  action: FileTextIcon,
  source: FileTextIcon,
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  const screenshots = evidence.filter(
    (e) => e.kind === 'screenshot' && e.storageKey,
  )
  const rest = evidence.filter((e) => e.kind !== 'screenshot')

  return (
    <div className="grid gap-6">
      <ScreenshotCarousel shots={screenshots} />

      {rest.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
          {rest.map((item) => {
            const Icon = ICON[item.kind]
            const size = formatBytes(item.sizeBytes)
            const externalUrl =
              typeof item.metadata.url === 'string' ? item.metadata.url : null

            const label = (
              <>
                <Icon size={15} />
                <span className="min-w-0 flex-1 truncate text-kumo-strong">
                  {item.label}
                </span>
                {size ? (
                  <span className="tabular shrink-0 text-xs text-kumo-subtle">
                    {size}
                  </span>
                ) : null}
                <RelativeTime iso={item.createdAt} />
              </>
            )

            const className =
              'flex items-center gap-3 py-2.5 text-sm no-underline transition-colors hover:bg-kumo-tint'

            return (
              <li key={item.id}>
                {externalUrl ? (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={className}
                  >
                    {label}
                  </a>
                ) : item.storageKey ? (
                  <a
                    href={`/api/evidence/${item.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={className}
                  >
                    {label}
                  </a>
                ) : (
                  <div className={className}>{label}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
