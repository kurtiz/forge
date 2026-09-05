/**
 * Executor selection.
 *
 * Solari when credentials are configured, HTTP fetch otherwise. Which one ran
 * is recorded on the run and shown in the UI, because the two have very
 * different fidelity and a reader needs to know which produced the evidence.
 */
import { env } from 'cloudflare:workers'
import { FetchBrowserExecutor } from './fetch-executor'
import { SolariBrowserExecutor } from './solari-executor'
import type { BrowserExecutor, ExecutorKind, ExecutorOptions } from './types'

export * from './types'
export { FetchBrowserExecutor } from './fetch-executor'
export { SolariBrowserExecutor } from './solari-executor'

export function plannedExecutorKind(): ExecutorKind {
  return env.SOLARI_API_KEY ? 'solari' : 'fetch'
}

export async function createExecutor(
  options: ExecutorOptions = {},
): Promise<BrowserExecutor> {
  const apiKey = env.SOLARI_API_KEY
  if (!apiKey) return new FetchBrowserExecutor(options)

  return SolariBrowserExecutor.create({
    apiKey,
    baseUrl: env.SOLARI_BASE_URL || undefined,
    recording: true,
    ...options,
  })
}
