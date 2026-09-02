/**
 * `GET /api/v1/whoami` — confirms a token before `forge login` stores it.
 */
import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, whoamiHandler } from '#/server/rest'

export const Route = createFileRoute('/api/v1/whoami')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await whoamiHandler(request)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
