/**
 * Better Auth configuration.
 *
 * Email + password for real accounts, GitHub for people who would rather not
 * invent another password, and - in development only - the anonymous plugin so
 * a guest can try a verification run without credentials at all. All three
 * produce the same user row, so every authorization check downstream works
 * identically.
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { db, schema, tables } from './db'
import { resolveToken } from './tokens/repository'
import { bearerToken, isTokenShaped } from './tokens/token'

/**
 * Whether GitHub sign-in can work on this deployment.
 *
 * Both halves of the OAuth credential are required, and the console asks
 * before it offers the button: an OAuth flow that dead-ends on a provider
 * error page is worse than not offering it.
 */
export function githubLoginAvailable(): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
}

/**
 * Whether guest sign-in exists on this deployment.
 *
 * Development only. A guest account can start real, billable verification runs,
 * so leaving the anonymous endpoint open on a public deployment is an
 * unauthenticated way to spend money on browser sessions and model calls. It is
 * the right thing for local evaluation and the wrong thing on the internet.
 *
 * This gates the plugin itself, not just the button. Hiding a control while its
 * endpoint stays live is not a restriction, it is a hidden one.
 */
export function guestAccessAvailable(): boolean {
  return env.FORGE_ENV === 'development'
}

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

    socialProviders: githubLoginAvailable()
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID as string,
            clientSecret: env.GITHUB_CLIENT_SECRET as string,
          },
        }
      : undefined,

    /**
     * A GitHub account and an email account with the same address are the same
     * person, so the second one links to the first instead of creating a
     * parallel user with a duplicate email. Limited to GitHub, which verifies
     * addresses: trusting an unverified provider here would let someone claim
     * an existing account by signing up elsewhere with its address.
     */
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['github'],
      },
    },

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

    /*
     * The anonymous plugin is registered only where guests are allowed. A
     * deployment that already carries guest users would lose the upgrade path
     * along with the plugin, so switch this on for such an environment before
     * relying on it.
     */
    plugins: guestAccessAvailable()
      ? [
          anonymous({
            emailDomainName: 'anonymous.forge.dev',
            /**
             * When a trial user signs up properly, carry their work across
             * instead of stranding it on a row that is about to be deleted.
             */
            onLinkAccount: async ({ anonymousUser, newUser }) => {
              await db()
                .update(tables.projects)
                .set({ userId: newUser.user.id })
                .where(eq(tables.projects.userId, anonymousUser.user.id))
            },
          }),
        ]
      : [],
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

/**
 * Resolves the caller, or null when signed out.
 *
 * Two credentials are accepted: the Better Auth session cookie the console
 * uses, and a bearer API token the CLI and CI use. Both land on the same
 * `SessionUser`, so every ownership check downstream is identical whichever
 * door was used. A malformed bearer token is a definite "no" rather than a
 * fall-through to cookies, so a bad token cannot be quietly ignored.
 */
export async function currentUser(request: Request): Promise<SessionUser | null> {
  const token = bearerToken(request.headers)
  if (token !== null) {
    if (!isTokenShaped(token)) return null
    return resolveToken(token)
  }

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
