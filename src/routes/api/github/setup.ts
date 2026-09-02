/**
 * GitHub App setup callback.
 *
 * Where GitHub returns the browser after an installation. The installation is
 * claimed for the signed-in user here, which is the only moment Forge can know
 * which account an installation belongs to: the webhook that announced it
 * carries a GitHub account, not a Forge one.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { requireUser } from '#/server/auth'
import { linkInstallation, recordInstallation } from '#/server/github/installations'

export const Route = createFileRoute('/api/github/setup')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const installationId = url.searchParams.get('installation_id')

        let userId: string
        try {
          userId = (await requireUser(request)).id
        } catch {
          // Sign in first, then come straight back to finish the link.
          const next = encodeURIComponent(url.pathname + url.search)
          throw redirect({ href: `/sign-in?next=${next}` })
        }

        if (!installationId) {
          throw redirect({ href: '/settings?github=missing' })
        }

        let result = await linkInstallation(installationId, userId)

        /*
         * The setup redirect can beat the `installation` webhook. When it does,
         * the row does not exist yet; recording it here and retrying means the
         * user is not asked to reload a page to fix a race they cannot see.
         */
        if (result === 'unknown') {
          await recordInstallation({
            id: installationId,
            accountLogin: 'pending',
            accountType: 'User',
          })
          result = await linkInstallation(installationId, userId)
        }

        throw redirect({ href: `/settings?github=${result}` })
      },
    },
  },
})
