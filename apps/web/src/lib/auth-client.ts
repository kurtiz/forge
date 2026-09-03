/**
 * Better Auth browser client.
 *
 * The anonymous plugin adds `signIn.anonymous()`, which is what the guest
 * button calls. Everything else is standard email and password.
 */
import { createAuthClient } from 'better-auth/react'
import { anonymousClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [anonymousClient()],
})
