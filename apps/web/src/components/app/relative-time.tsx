/**
 * Relative timestamp.
 *
 * Rendered on the server as an absolute time and upgraded to a relative one
 * after hydration, so SSR and the client never disagree about "now".
 */
import { useEffect, useState } from 'react'

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

function relative(iso: string): string {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  let delta = (Date.parse(iso) - Date.now()) / 1000

  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) < size) {
      return formatter.format(Math.round(delta), unit)
    }
    delta /= size
  }
  return iso
}

export function RelativeTime({
  iso,
  className,
}: {
  iso: string
  className?: string
}) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    setLabel(relative(iso))
    const timer = setInterval(() => setLabel(relative(iso)), 30_000)
    return () => clearInterval(timer)
  }, [iso])

  return (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString()}
      className={className ?? 'tabular shrink-0 text-xs text-kumo-subtle'}
    >
      {label ?? new Date(iso).toISOString().slice(0, 16).replace('T', ' ')}
    </time>
  )
}
