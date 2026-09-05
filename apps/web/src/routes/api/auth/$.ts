/**
 * Better Auth HTTP surface.
 *
 * Everything under /api/auth is handled by Better Auth itself: sign-up,
 * sign-in, anonymous sign-in, sign-out, and session reads. The one thing this
 * route adds is a rate limit in front of the paths that offer a credential,
 * because Better Auth will happily check a password as fast as it is asked to.
 */
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/server/auth'
import { limitCredentialAttempt, RateLimitError } from '@/server/security'

const handle = async ({ request }: { request: Request }) => {
  try {
    await limitCredentialAttempt(request)
  } catch (error) {
    if (!(error instanceof RateLimitError)) throw error
    /*
     * Shaped like a Better Auth error so the sign-in form shows the message it
     * carries, rather than its own guess at what went wrong.
     */
    return new Response(
      JSON.stringify({ message: error.message, code: 'TOO_MANY_REQUESTS' }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(error.retryAfterSeconds),
        },
      },
    )
  }

  return auth().handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
})
