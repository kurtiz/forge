/**
 * `DELETE /api/v1/projects/:projectId` — delete a project and its evidence.
 */
import { createFileRoute } from '@tanstack/react-router'
import { deleteProjectHandler, errorResponse } from '@/server/rest'

export const Route = createFileRoute('/api/v1/projects/$projectId')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          return await deleteProjectHandler(request, params.projectId)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
