/**
 * Live run event stream.
 *
 * Server-sent events proxied from the run's Durable Object. Access is checked
 * here, before the stream is opened, so the DO never has to know about users.
 * The client receives the persisted timeline on page load and only new events
 * arrive here, which keeps the stream small and makes a reconnect cheap.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '@/server/auth'
import { assertRunAccess } from '@/server/runs/repository'
import { streamRun } from '@/server/runs/service'

export const Route = createFileRoute('/api/runs/$runId/stream')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const user = await requireUser(request)
          await assertRunAccess(params.runId, user.id)
        } catch {
          return new Response('Not found', { status: 404 })
        }

        const upstream = await streamRun(params.runId)
        return new Response(upstream.body, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            'x-accel-buffering': 'no',
          },
        })
      },
    },
  },
})
