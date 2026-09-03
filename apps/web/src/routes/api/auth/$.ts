/**
 * Better Auth HTTP surface.
 *
 * Everything under /api/auth is handled by Better Auth itself: sign-up,
 * sign-in, anonymous sign-in, sign-out, and session reads.
 */
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/server/auth'

const handle = ({ request }: { request: Request }) => auth().handler(request)

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
})
