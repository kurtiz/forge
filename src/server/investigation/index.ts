/**
 * Investigator selection.
 *
 * A Solari sandbox when credentials are configured, nothing otherwise. Unlike
 * the browser, there is no degraded fallback: reading a repository without
 * cloning it would mean a different provider and a different fidelity story, so
 * the honest answer when no key is present is that investigation did not run.
 */
import { env } from 'cloudflare:workers'
import { SolariSandboxInvestigator } from './solari-sandbox'
import type { InvestigatorKind, SourceInvestigator } from './types'

export * from './types'
export { SolariSandboxInvestigator } from './solari-sandbox'

export function plannedInvestigatorKind(): InvestigatorKind | null {
  return env.SOLARI_API_KEY ? 'solari-sandbox' : null
}

/** Null when no sandbox is available; the caller reports that as skipped. */
export async function createInvestigator(): Promise<SourceInvestigator | null> {
  const apiKey = env.SOLARI_API_KEY
  if (!apiKey) return null

  return SolariSandboxInvestigator.create({
    apiKey,
    baseUrl: env.SOLARI_BASE_URL || undefined,
  })
}
