/**
 * Worker entry.
 *
 * Wraps the TanStack Start request handler so the run engine Durable Object
 * can be exported from the same Worker. `main` in wrangler.jsonc points here
 * instead of at `@tanstack/react-start/server-entry`.
 */
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

export { RunSessionDO } from './server/runs/run-session-do'

const fetch = createStartHandler(defaultStreamHandler)

export default { fetch }
