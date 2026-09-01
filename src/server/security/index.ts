/**
 * Security helpers bound to the runtime environment.
 *
 * `target-url` is kept free of Cloudflare imports so it can be unit tested;
 * this module supplies the environment-dependent policy on top of it.
 */
import { env } from 'cloudflare:workers'
import {
  assertSafeTargetUrl as assertSafeTargetUrlPure,
  normaliseRepoUrl,
  UnsafeTargetError,
} from './target-url'

export { normaliseRepoUrl, UnsafeTargetError }

/**
 * Loopback targets are allowed in local development only, so the bundled demo
 * application can be verified end to end without deploying it first.
 */
export function assertSafeTargetUrl(input: string): URL {
  return assertSafeTargetUrlPure(input, {
    allowLoopback: env.FORGE_ENV === 'development',
  })
}
