/**
 * Fixture application routes.
 *
 * Everything under /demo is served by the Northbeam fixture rather than by the
 * Forge UI. It is a separate application that happens to share a Worker.
 */
import { createFileRoute } from '@tanstack/react-router'
import { handleDemoRequest } from '#/server/demo/app'

export const Route = createFileRoute('/demo/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleDemoRequest(request),
      POST: ({ request }) => handleDemoRequest(request),
    },
  },
})
