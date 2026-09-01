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

  /** OpenAI-compatible endpoint, typically a Cloudflare AI Gateway URL. */
  AI_GATEWAY_URL?: string
  AI_GATEWAY_KEY?: string
  AI_GATEWAY_MODEL?: string

  /** Set to "1" to repair the seeded defects in the bundled demo app. */
  FORGE_DEMO_FIXED?: string
}

interface Env extends ForgeOptionalEnv {}

declare namespace Cloudflare {
  interface Env extends ForgeOptionalEnv {}
}
