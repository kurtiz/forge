/**
 * Better Auth configuration.
 *
 * Email + password for real accounts, plus the anonymous plugin so anyone can
 * try a verification run without creating credentials first. Anonymous users
 * are real rows with real ownership, so every authorization check downstream
 * works identically for them.
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db, schema, tables } from './db'

function createAuth() {
  const secret = env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not set. Run `wrangler secret put BETTER_AUTH_SECRET`, or add it to .dev.vars for local development.',
    )
  }

  return betterAuth({
    appName: 'Forge',
    secret,
    // Falls back to inference from the request when APP_URL is unset, so a
    // preview deployment or a dev server on a different port still works.
    baseURL: env.APP_URL || undefined,
    basePath: '/api/auth',
    // Shares the Drizzle client and schema with the rest of the application,
    // so the auth tables are described in exactly one place.
    database: drizzleAdapter(db(), { provider: 'sqlite', schema }),
    telemetry: { enabled: false },

    emailAndPassword: {
      enabled: true,
      // No mail transport is wired up yet, so verification would lock people
      // out of accounts they just created.
      requireEmailVerification: false,
      minPasswordLength: 8,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    advanced: {
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: env.FORGE_ENV !== 'development',
      },
    },

    plugins: [
      anonymous({
        emailDomainName: 'anonymous.forge.dev',
        /**
         * When a trial user signs up properly, carry their work across instead
         * of stranding it on a row that is about to be deleted.
         */
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await db()
            .update(tables.projects)
            .set({ userId: newUser.user.id })
            .where(eq(tables.projects.userId, anonymousUser.user.id))
        },
      }),
    ],
  })
}

let cached: ReturnType<typeof createAuth> | null = null

export function auth() {
  cached ??= createAuth()
  return cached
}

export type SessionUser = {
  id: string
  name: string
  email: string
  isAnonymous: boolean
}

/** Resolves the caller from request cookies, or null when signed out. */
export async function currentUser(request: Request): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: request.headers })
  if (!session?.user) return null

  const user = session.user as typeof session.user & { isAnonymous?: boolean }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAnonymous: Boolean(user.isAnonymous),
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Sign in to continue.')
    this.name = 'UnauthorizedError'
  }
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await currentUser(request)
  if (!user) throw new UnauthorizedError()
  return user
}
