/**
 * CLI configuration.
 *
 * A token is a credential, so the file is written with owner-only permissions
 * and the environment takes precedence over it: CI supplies `FORGE_TOKEN` from
 * a secret store and never writes anything to disk.
 */
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_HOST = 'https://forge.papiliocurtis.workers.dev'

export type Config = { host: string; token: string }

const configDir = () => join(homedir(), '.forge')
const configPath = () => join(configDir(), 'config.json')

export async function readConfig(): Promise<Partial<Config>> {
  const fromEnv: Partial<Config> = {}
  if (process.env.FORGE_TOKEN) fromEnv.token = process.env.FORGE_TOKEN
  if (process.env.FORGE_HOST) fromEnv.host = process.env.FORGE_HOST

  let stored: Partial<Config> = {}
  try {
    stored = JSON.parse(await readFile(configPath(), 'utf8')) as Partial<Config>
  } catch {
    // No config file yet, or it is unreadable. The environment may still carry
    // everything needed, so this is not an error on its own.
  }

  return { ...stored, ...fromEnv }
}

export async function writeConfig(config: Config): Promise<string> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  const path = configPath()
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  // Set explicitly as well: `mode` on writeFile is ignored for a file that
  // already exists, and an old config could have looser permissions.
  await chmod(path, 0o600)
  return path
}

export async function clearConfig(): Promise<void> {
  await rm(configPath(), { force: true })
}

export function normaliseHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
