/**
 * `POST /api/v1/runs` — start a verification from the CLI or CI.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createRunHandler, errorResponse } from '#/server/rest'

export const Route = createFileRoute('/api/v1/runs')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await createRunHandler(request)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
