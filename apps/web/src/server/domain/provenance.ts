/**
 * Where a request came from.
 *
 * Kept free of I/O, like the rest of `domain`, so it can be unit tested
 * without a Worker runtime.
 *
 * A run's trigger is the answer to "who asked for this", and a history that
 * gets it wrong is worse than one that says nothing: the whole point of the
 * tag is letting someone scanning a project tell a run they started by hand
 * from one CI or a schedule started for them. The endpoint a request arrived
 * on cannot answer that, because `/api/v1/runs` accepts the console's session
 * cookie as well as a bearer token - see `currentUser`. The credential can:
 * tokens are only ever issued to something outside the browser.
 */
import type { Run } from '@/server/contracts'
import { bearerToken } from '@/server/tokens/token'

/** True when the caller presented a bearer token rather than a session cookie. */
export function usedApiToken(headers: Headers): boolean {
  return bearerToken(headers) !== null
}

/**
 * The trigger to record for a run started through the public API.
 *
 * A cookie means the console, and a run started from the console is a manual
 * run however it reached the server.
 */
export function apiRunTrigger(headers: Headers): Run['trigger'] {
  return usedApiToken(headers) ? 'cli' : 'manual'
}
