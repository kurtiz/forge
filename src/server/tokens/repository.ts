/**
 * API token storage.
 *
 * Tokens belong to real accounts only. A guest's token would die with the
 * guest row, and a token is exactly the thing someone sets up once and forgets
 * about, so handing one to an account that is about to be garbage-collected
 * would be a trap.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ApiToken } from '../contracts'
import { db, newId, nowIso, tables } from '../db'
import { displayPrefix, generateToken, hashToken } from './token'

type TokenRow = typeof tables.apiTokens.$inferSelect

const toApiToken = (r: TokenRow): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  lastUsedAt: r.lastUsedAt,
  createdAt: r.createdAt,
})

export class TokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenError'
  }
}

const MAX_TOKENS_PER_USER = 20

/** Creates a token and returns the plaintext exactly once. */
export async function createToken(input: {
  userId: string
  name: string
}): Promise<{ token: string; record: ApiToken }> {
  const existing = await listTokens(input.userId)
  if (existing.length >= MAX_TOKENS_PER_USER) {
    throw new TokenError(
      `You already have ${MAX_TOKENS_PER_USER} tokens. Revoke one before creating another.`,
    )
  }

  const token = generateToken()
  const [row] = await db()
    .insert(tables.apiTokens)
    .values({
      id: newId('tok'),
      userId: input.userId,
      name: input.name,
      tokenHash: await hashToken(token),
      prefix: displayPrefix(token),
      createdAt: nowIso(),
    })
    .returning()

  return { token, record: toApiToken(row) }
}

export async function listTokens(userId: string): Promise<ApiToken[]> {
  const rows = await db()
    .select()
    .from(tables.apiTokens)
    .where(
      and(eq(tables.apiTokens.userId, userId), isNull(tables.apiTokens.revokedAt)),
    )
    .orderBy(desc(tables.apiTokens.createdAt))

  return rows.map(toApiToken)
}

/** Revocation is scoped by owner in the same statement, so there is no TOCTOU. */
export async function revokeToken(tokenId: string, userId: string): Promise<void> {
  await db()
    .update(tables.apiTokens)
    .set({ revokedAt: nowIso() })
    .where(
      and(eq(tables.apiTokens.id, tokenId), eq(tables.apiTokens.userId, userId)),
    )
}

export type TokenUser = {
  id: string
  name: string
  email: string
  isAnonymous: boolean
}

/**
 * Resolves a presented token to its user, or null. The last-used timestamp is
 * updated on the way through so the console can show which tokens are alive.
 */
export async function resolveToken(token: string): Promise<TokenUser | null> {
  const tokenHash = await hashToken(token)
  const [row] = await db()
    .select({ token: tables.apiTokens, user: tables.user })
    .from(tables.apiTokens)
    .innerJoin(tables.user, eq(tables.user.id, tables.apiTokens.userId))
    .where(
      and(
        eq(tables.apiTokens.tokenHash, tokenHash),
        isNull(tables.apiTokens.revokedAt),
      ),
    )
    .limit(1)

  if (!row) return null

  await db()
    .update(tables.apiTokens)
    .set({ lastUsedAt: nowIso() })
    .where(eq(tables.apiTokens.id, row.token.id))

  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    isAnonymous: Boolean(row.user.isAnonymous),
  }
}
