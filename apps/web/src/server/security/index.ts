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
import {
  CredentialError,
  decryptSecret,
  encryptSecret,
  normaliseLoginPath,
} from './credentials'

export { normaliseRepoUrl, UnsafeTargetError }
export { CredentialError, normaliseLoginPath }
export { redactSecrets, redactDeep, REDACTED } from './redact'

/**
 * The key protecting stored target-application passwords. Absent by default:
 * without it a project simply cannot carry credentials, which is a better
 * failure than encrypting them under a predictable key.
 */
function credentialKey(): string {
  const key = env.FORGE_CREDENTIAL_KEY
  if (!key) {
    throw new CredentialError(
      'Credentials are not configured on this deployment. Set FORGE_CREDENTIAL_KEY (wrangler secret put FORGE_CREDENTIAL_KEY) to store target-application logins.',
    )
  }
  return key
}

export function credentialsAvailable(): boolean {
  return Boolean(env.FORGE_CREDENTIAL_KEY)
}

export function encryptCredential(plaintext: string): Promise<string> {
  return encryptSecret(plaintext, credentialKey())
}

export function decryptCredential(encoded: string): Promise<string> {
  return decryptSecret(encoded, credentialKey())
}

/**
 * Loopback targets are allowed in local development only, so the bundled demo
 * application can be verified end to end without deploying it first.
 */
export function assertSafeTargetUrl(input: string): URL {
  return assertSafeTargetUrlPure(input, {
    allowLoopback: env.FORGE_ENV === 'development',
  })
}
