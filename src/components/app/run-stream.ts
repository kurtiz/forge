/**
 * Live run subscription.
 *
 * The persisted timeline arrives with the page; this hook only appends events
 * that happen after it. When the run reaches a terminal state the stream is
 * closed and the router is invalidated once, so journeys, findings, and
 * evidence appear without polling.
 */
import { useEffect, useRef, useState } from 'react'
import type { RunEvent, RunStatus } from '#/server/contracts'

const LIVE_STATUSES: RunStatus[] = [
  'queued',
  'starting',
  'discovering',
  'testing',
  'investigating',
  'reporting',
]

export function useRunStream({
  runId,
  status,
  initialEvents,
  onFinished,
}: {
  runId: string
  status: RunStatus
  initialEvents: RunEvent[]
  onFinished: () => void
}) {
  const [events, setEvents] = useState<RunEvent[]>(initialEvents)
  const [live, setLive] = useState(LIVE_STATUSES.includes(status))
  const finished = useRef(false)

  useEffect(() => {
    setEvents(initialEvents)
  }, [initialEvents])

  useEffect(() => {
    if (!LIVE_STATUSES.includes(status)) {
      setLive(false)
      return
    }

    const source = new EventSource(`/api/runs/${runId}/stream`)
    setLive(true)

    source.addEventListener('run', (message) => {
      try {
        const event = JSON.parse((message as MessageEvent).data) as RunEvent
        setEvents((current) =>
          current.some((e) => e.sequence === event.sequence)
            ? current
            : [...current, event].sort((a, b) => a.sequence - b.sequence),
        )
        if (event.type === 'run.completed' || event.type === 'run.failed') {
          finish()
        }
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    })

    source.addEventListener('done', finish)
    source.addEventListener('error', () => {
      // EventSource reconnects on its own; only give up once the run is over.
      if (finished.current) source.close()
    })

    function finish() {
      if (finished.current) return
      finished.current = true
      setLive(false)
      source.close()
      onFinished()
    }

    return () => {
      finished.current = true
      source.close()
    }
    // `onFinished` is a stable router callback supplied by the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, status])

  return { events, live }
}
