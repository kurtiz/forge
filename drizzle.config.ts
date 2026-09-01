import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are generated from `src/server/db/schema.ts` into the same
 * directory `wrangler d1 migrations apply` reads, so schema changes and
 * migrations cannot drift apart.
 *
 *   pnpm db:generate        # write a migration for the current schema
 *   pnpm db:migrate         # apply it to the local D1
 *   pnpm db:migrate:remote  # apply it to the deployed D1
 *
 * There is no `drizzle-kit push` script on purpose: D1 is migration-driven and
 * pushing would leave the deployed database in a state no migration describes.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './infrastructure/migrations',
  casing: 'snake_case',
})
