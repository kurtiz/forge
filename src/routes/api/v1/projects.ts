/**
 * `GET /api/v1/projects` — the projects a token can verify.
 */
import { createFileRoute } from '@tanstack/react-router'
import { errorResponse, listProjectsHandler } from '#/server/rest'

export const Route = createFileRoute('/api/v1/projects')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await listProjectsHandler(request)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
