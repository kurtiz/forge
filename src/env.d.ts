/**
 * Optional bindings.
 *
 * `wrangler types` only knows about what is declared in wrangler.jsonc and
 * .dev.vars. These are secrets and flags that are legitimately absent in some
 * environments, so they are declared optional here and the code branches on
 * their presence rather than assuming them.
 */
interface ForgeOptionalEnv {
  /** Enables the Solari browser executor. Without it, runs use HTTP fetch. */
  SOLARI_API_KEY?: string
  /** Overrides the Solari API host, for staging or a self-hosted gateway. */
  SOLARI_BASE_URL?: string

  /**
   * Encrypts target-application test credentials at rest. Without it a project
   * cannot store a login, which is a better failure than a predictable key.
   */
  FORGE_CREDENTIAL_KEY?: string

  /** OpenAI-compatible endpoint, typically a Cloudflare AI Gateway URL. */
  AI_GATEWAY_URL?: string
  AI_GATEWAY_KEY?: string
  AI_GATEWAY_MODEL?: string

  /** Set to "1" to repair the seeded defects in the bundled demo app. */
  FORGE_DEMO_FIXED?: string

  /**
   * GitHub App credentials. All three are required together: without them the
   * webhook endpoint refuses every delivery and the console says the
   * integration is unavailable, rather than half-working.
   */
  GITHUB_APP_ID?: string
  /** PKCS#8 PEM. GitHub issues PKCS#1; `openssl pkcs8 -topk8` converts it. */
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_WEBHOOK_SECRET?: string
  /** The app's URL slug, used to build the install link. */
  GITHUB_APP_SLUG?: string

  /**
   * GitHub OAuth credentials for signing in to Forge. Separate from the App
   * credentials above: that app verifies pull requests, these identify a
   * person. Both are required together or GitHub sign-in is not offered.
   */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
}

interface Env extends ForgeOptionalEnv {}

declare namespace Cloudflare {
  interface Env extends ForgeOptionalEnv {}
}
