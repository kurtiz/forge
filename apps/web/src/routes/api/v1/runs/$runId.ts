/**
 * `GET /api/v1/runs/:runId` — the run report the CLI polls and prints.
 */
import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, getRunHandler } from '@/server/rest'

export const Route = createFileRoute('/api/v1/runs/$runId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          return await getRunHandler(request, params.runId)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
