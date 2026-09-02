/**
 * GitHub webhook endpoint.
 *
 * Public and unauthenticated, so the HMAC is the entire security boundary. It
 * is verified against the raw body before anything is parsed, and a delivery
 * that fails gets 401 with no detail about why.
 *
 * Handling happens inline rather than under `waitUntil`: GitHub allows ten
 * seconds, starting a run is a couple of writes plus a Durable Object call, and
 * a synchronous answer means a failed delivery is visible in GitHub's own
 * redelivery UI instead of disappearing.
 */
import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { githubConfigured } from '#/server/github/app'
import { verifySignature } from '#/server/github/signature'
import { handleWebhook } from '#/server/github/webhook'

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!githubConfigured()) {
          return new Response('GitHub integration is not configured.', {
            status: 503,
          })
        }

        const payload = await request.text()
        const valid = await verifySignature(
          payload,
          request.headers.get('x-hub-signature-256'),
          env.GITHUB_WEBHOOK_SECRET ?? '',
        )
        if (!valid) return new Response('Invalid signature.', { status: 401 })

        const event = request.headers.get('x-github-event') ?? ''

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>
        } catch {
          return new Response('Malformed payload.', { status: 400 })
        }

        try {
          const outcome = await handleWebhook(event, parsed)
          return Response.json(outcome)
        } catch (error) {
          // 500 so GitHub marks the delivery failed and offers a redelivery,
          // rather than recording a success that did nothing.
          const message = error instanceof Error ? error.message : 'Handler failed.'
          return Response.json({ handled: false, detail: message }, { status: 500 })
        }
      },
    },
  },
})
