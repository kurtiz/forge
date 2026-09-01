/**
 * Database access.
 *
 * One Drizzle client over the D1 binding, shared by Better Auth and by Forge's
 * own queries. `schema` is passed in so relational queries and column types are
 * inferred from the same definitions the migrations were generated from.
 */
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { schema } from './schema'

export * as tables from './schema'
export { schema }

export type Database = ReturnType<typeof createClient>

function createClient() {
  return drizzle(env.DB, { schema, casing: 'snake_case' })
}

/**
 * D1 bindings are per-request in Workers, so the client is created on demand
 * rather than cached at module scope.
 */
export function db(): Database {
  return createClient()
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Prefixed ids that stay readable in URLs, logs, and support conversations. */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  let out = ''
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length]
  return `${prefix}_${out}`
}
