/**
 * GitHub installation storage.
 *
 * An installation row exists as soon as GitHub says the app was installed, but
 * it is inert until a signed-in Forge user claims it. That ordering matters:
 * webhooks arrive before, and independently of, anyone visiting the console, so
 * an unclaimed installation must be a no-op rather than a run on a guessed
 * account.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { GitHubInstallation } from '../contracts'
import { db, nowIso, tables } from '../db'

type InstallationRow = typeof tables.githubInstallations.$inferSelect

const toInstallation = (r: InstallationRow): GitHubInstallation => ({
  id: r.id,
  accountLogin: r.accountLogin,
  accountType: r.accountType,
  linked: Boolean(r.userId),
  createdAt: r.createdAt,
})

/** Records an installation, or revives one that was deleted and re-added. */
export async function recordInstallation(input: {
  id: string
  accountLogin: string
  accountType: string
}): Promise<void> {
  const at = nowIso()
  await db()
    .insert(tables.githubInstallations)
    .values({ ...input, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: tables.githubInstallations.id,
      set: {
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        deletedAt: null,
        updatedAt: at,
      },
    })
}

/**
 * Marks an installation removed without deleting it. Runs already recorded
 * against it keep their commit and pull-request context, which would be lost
 * with a cascade.
 */
export async function markInstallationDeleted(id: string): Promise<void> {
  const at = nowIso()
  await db()
    .update(tables.githubInstallations)
    .set({ deletedAt: at, userId: null, updatedAt: at })
    .where(eq(tables.githubInstallations.id, id))
}

/** Claims an installation for a user. Refuses one another account already holds. */
export async function linkInstallation(
  installationId: string,
  userId: string,
): Promise<'linked' | 'already_linked' | 'unknown'> {
  const [row] = await db()
    .select()
    .from(tables.githubInstallations)
    .where(eq(tables.githubInstallations.id, installationId))
    .limit(1)

  if (!row || row.deletedAt) return 'unknown'
  if (row.userId && row.userId !== userId) return 'already_linked'

  await db()
    .update(tables.githubInstallations)
    .set({ userId, updatedAt: nowIso() })
    .where(eq(tables.githubInstallations.id, installationId))

  return 'linked'
}

export async function unlinkInstallation(
  installationId: string,
  userId: string,
): Promise<void> {
  await db()
    .update(tables.githubInstallations)
    .set({ userId: null, updatedAt: nowIso() })
    .where(
      and(
        eq(tables.githubInstallations.id, installationId),
        eq(tables.githubInstallations.userId, userId),
      ),
    )
}

/** The user a webhook should act on behalf of, or null if nobody claimed it. */
export async function installationOwner(
  installationId: string,
): Promise<string | null> {
  const [row] = await db()
    .select({ userId: tables.githubInstallations.userId })
    .from(tables.githubInstallations)
    .where(
      and(
        eq(tables.githubInstallations.id, installationId),
        isNull(tables.githubInstallations.deletedAt),
      ),
    )
    .limit(1)

  return row?.userId ?? null
}

export async function listInstallations(
  userId: string,
): Promise<GitHubInstallation[]> {
  const rows = await db()
    .select()
    .from(tables.githubInstallations)
    .where(
      and(
        eq(tables.githubInstallations.userId, userId),
        isNull(tables.githubInstallations.deletedAt),
      ),
    )
    .orderBy(desc(tables.githubInstallations.createdAt))

  return rows.map(toInstallation)
}
