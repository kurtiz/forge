/**
 * Evidence artifact download.
 *
 * R2 objects are never public. Every read goes through this route so ownership
 * is checked against the run the artifact belongs to.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '@/server/auth'
import { getEvidence, readArtifact } from '@/server/evidence/store'
import { assertRunAccess } from '@/server/runs/repository'

export const Route = createFileRoute('/api/evidence/$evidenceId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const notFound = new Response('Not found', { status: 404 })

        let userId: string
        try {
          userId = (await requireUser(request)).id
        } catch {
          return notFound
        }

        const evidence = await getEvidence(params.evidenceId)
        if (!evidence?.storageKey) return notFound

        try {
          await assertRunAccess(evidence.runId, userId)
        } catch {
          return notFound
        }

        const object = await readArtifact(evidence.storageKey)
        if (!object) return notFound

        return new Response(object.body, {
          headers: {
            'content-type': evidence.contentType ?? 'application/octet-stream',
            'cache-control': 'private, max-age=3600',
            'content-disposition': `inline; filename="${evidence.id}"`,
          },
        })
      },
    },
  },
})
