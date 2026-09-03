import { createFileRoute } from '@tanstack/react-router'
import { handleDemoRequest } from '@/server/demo/app'

export const Route = createFileRoute('/demo/')({
  server: {
    handlers: {
      GET: ({ request }) => handleDemoRequest(request),
    },
  },
})
