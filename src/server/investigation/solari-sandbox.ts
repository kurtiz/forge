/**
 * Solari sandbox investigator.
 *
 * Clones the repository into a disposable microVM and reads the source that the
 * runtime evidence points at. Every step is a one-shot `POST /sandboxes/:id/exec`
 * against the REST gateway, so - unlike the browser executor, which needs a live
 * CDP socket - this needs no WebSocket and no SDK, and runs on Workers as-is.
 *
 * Commands are sent as a command plus an argument array, never a shell string.
 * Search terms come from page content and console output, which is attacker
 * controlled; passing them through a shell would make that a command injection.
 *
 * Cleanup is unconditional. The sandbox is released in the engine's `finally`
 * whatever happens, because a leaked microVM costs money for as long as it lives.
 */
import {
  affectedFilesFrom,
  buildSearchQueries,
  detectFramework,
  detectPackageManager,
  isIgnorablePath,
  parseGrepOutput,
  rankMatches,
} from './analysis'
import {
  InvestigatorError,
  type InvestigationRequest,
  type SourceInsight,
  type SourceInvestigator,
  type SourceMatch,
} from './types'
import { normaliseRepoUrl, UnsafeTargetError } from '../security/target-url'

/**
 * The gateway contract, kept in one block so a correction is a one-place edit.
 * Verified against the Solari Go SDK (`solari-sdk/solari-sandbox-go`).
 */
const DEFAULT_BASE_URL = 'https://api.getsolari.com'
const ENDPOINTS = {
  create: '/sandboxes',
  exec: (id: string) => `/sandboxes/${encodeURIComponent(id)}/exec`,
  kill: (id: string) => `/sandboxes/${encodeURIComponent(id)}`,
}

const SANDBOX_TEMPLATE = 'base'
const CLONE_PATH = '/workspace/repo'

/** The sandbox exists for one investigation; it should never outlive the run. */
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000
const CLONE_TIMEOUT_MS = 90_000
const COMMAND_TIMEOUT_MS = 20_000

/** Output caps. A repository can produce arbitrarily much of everything. */
const MAX_STDOUT_CHARS = 64 * 1024
const MAX_TREE_ENTRIES = 4000
const MAX_MATCHES_PER_FILE = 3
const MAX_PACKAGE_JSON_CHARS = 32 * 1024

type CommandResult = { exitCode: number; stdout: string; stderr: string }

type CreateSandboxResponse = {
  sandboxId: string
  kind?: string
  controlUrl?: string
  expiresAt?: string
}

export type SolariSandboxConfig = {
  apiKey: string
  baseUrl?: string
}

export class SolariSandboxInvestigator implements SourceInvestigator {
  readonly kind = 'solari-sandbox' as const

  private sandbox: CreateSandboxResponse | null = null
  private startedAt = Date.now()
  private closed = false
  /** One clone per sandbox: later findings reuse the working tree. */
  private clonedRepoUrl: string | null = null

  private constructor(private readonly config: SolariSandboxConfig) {}

  get sandboxId(): string | null {
    return this.sandbox?.sandboxId ?? null
  }

  get elapsedSeconds(): number {
    return Math.round((Date.now() - this.startedAt) / 1000)
  }

  static async create(
    config: SolariSandboxConfig,
  ): Promise<SolariSandboxInvestigator> {
    const investigator = new SolariSandboxInvestigator(config)
    await investigator.start()
    return investigator
  }

  private get baseUrl() {
    return this.config.baseUrl ?? DEFAULT_BASE_URL
  }

  private async api(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new InvestigatorError(`Solari ${method} ${path} failed: ${detail}`, true)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      // Concurrency and plan limits are worth retrying later; a bad key is not.
      const retryable = response.status === 429 || response.status >= 500
      throw new InvestigatorError(
        `Solari ${method} ${path} failed (${response.status}): ${detail.slice(0, 200)}`,
        retryable,
      )
    }
    return response
  }

  private async start() {
    const response = await this.api('POST', ENDPOINTS.create, {
      template: SANDBOX_TEMPLATE,
      kind: 'sandbox',
      timeoutMs: SANDBOX_TIMEOUT_MS,
      metadata: { purpose: 'forge-source-investigation' },
    })
    this.sandbox = (await response.json()) as CreateSandboxResponse
    this.startedAt = Date.now()
  }

  /** One-shot command. Never a shell string: `cmd` plus an argument array. */
  private async exec(
    cmd: string,
    args: string[],
    options: { cwd?: string; timeoutMs?: number } = {},
  ): Promise<CommandResult> {
    const id = this.sandbox?.sandboxId
    if (!id) throw new InvestigatorError('Sandbox is not running.', false)

    const response = await this.api('POST', ENDPOINTS.exec(id), {
      cmd,
      args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    })
    const result = (await response.json()) as CommandResult

    return {
      exitCode: result.exitCode ?? 0,
      stdout: (result.stdout ?? '').slice(0, MAX_STDOUT_CHARS),
      stderr: (result.stderr ?? '').slice(0, 2000),
    }
  }

  async investigate(request: InvestigationRequest): Promise<SourceInsight> {
    // Re-validated here even though the project form already checked it, for
    // the same reason `startRun` re-validates the target URL: this is the last
    // point before the value reaches an external system.
    let repoUrl: string
    try {
      repoUrl = normaliseRepoUrl(request.repoUrl) ?? ''
    } catch (error) {
      const detail =
        error instanceof UnsafeTargetError ? error.message : 'Invalid repository URL.'
      throw new InvestigatorError(detail, false)
    }
    if (!repoUrl) throw new InvestigatorError('No repository URL to investigate.', false)

    const notes: string[] = []
    await this.ensureClone(repoUrl, notes)

    const paths = await this.listTrackedFiles()
    const packageJson = await this.readPackageJson(paths)

    const framework = detectFramework(paths, packageJson)
    const packageManager = detectPackageManager(paths)
    if (framework) notes.push(`Framework detected: ${framework}.`)
    if (packageManager) notes.push(`Package manager detected: ${packageManager}.`)

    const queries = buildSearchQueries(request)
    if (queries.length === 0) {
      notes.push('Runtime evidence carried no searchable terms, so no source was linked.')
      return {
        framework,
        packageManager,
        affectedFiles: [],
        matches: [],
        notes,
        commit: await this.readCommit(),
      }
    }

    notes.push(`Searched the repository for: ${queries.join(', ')}.`)

    const found: SourceMatch[] = []
    for (const query of queries) {
      found.push(...(await this.search(query)))
    }

    const matches = rankMatches(found)
    if (matches.length === 0) {
      notes.push('No source matched the runtime evidence.')
    }

    return {
      framework,
      packageManager,
      affectedFiles: affectedFilesFrom(matches),
      matches,
      notes,
      commit: await this.readCommit(),
    }
  }

  private async ensureClone(repoUrl: string, notes: string[]) {
    if (this.clonedRepoUrl === repoUrl) return

    // `--` stops a repository URL from ever being read as an option, and
    // `--depth 1` keeps a large history from spending the whole sandbox budget.
    const result = await this.exec(
      'git',
      ['clone', '--depth', '1', '--single-branch', '--', repoUrl, CLONE_PATH],
      { timeoutMs: CLONE_TIMEOUT_MS },
    )

    if (result.exitCode !== 0) {
      throw new InvestigatorError(
        `git clone failed (${result.exitCode}): ${result.stderr.slice(0, 200)}`,
        false,
      )
    }

    this.clonedRepoUrl = repoUrl
    notes.push(`Cloned ${repoUrl} at depth 1.`)
  }

  /**
   * `git ls-files` rather than a directory walk: it returns tracked source only,
   * so `node_modules` and build output never enter the picture.
   */
  private async listTrackedFiles(): Promise<string[]> {
    const result = await this.exec('git', ['ls-files'], { cwd: CLONE_PATH })
    if (result.exitCode !== 0) return []

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_TREE_ENTRIES)
  }

  private async readPackageJson(paths: string[]): Promise<string | null> {
    if (!paths.includes('package.json')) return null
    const result = await this.exec('cat', ['package.json'], { cwd: CLONE_PATH })
    if (result.exitCode !== 0) return null
    return result.stdout.slice(0, MAX_PACKAGE_JSON_CHARS)
  }

  private async readCommit(): Promise<string | null> {
    const result = await this.exec('git', ['rev-parse', 'HEAD'], { cwd: CLONE_PATH })
    if (result.exitCode !== 0) return null
    const commit = result.stdout.trim()
    return /^[0-9a-f]{7,40}$/i.test(commit) ? commit : null
  }

  /**
   * A fixed-string, binary-skipping, recursive grep. `-e` keeps a query that
   * begins with `-` from being read as an option, and `-F` keeps one containing
   * regex metacharacters from being read as a pattern.
   */
  private async search(query: string): Promise<SourceMatch[]> {
    const result = await this.exec(
      'grep',
      [
        '-rnIF',
        '-m', String(MAX_MATCHES_PER_FILE),
        '--exclude-dir=.git',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        '--exclude-dir=build',
        '--exclude-dir=.next',
        '-e', query,
        '--', '.',
      ],
      { cwd: CLONE_PATH },
    )

    // grep exits 1 when nothing matched, which is an answer, not a failure.
    if (result.exitCode !== 0 && result.exitCode !== 1) return []

    return parseGrepOutput(result.stdout, query).filter(
      (match) => !isIgnorablePath(match.path),
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    const id = this.sandbox?.sandboxId
    this.sandbox = null
    if (!id) return

    // Release is best-effort: the sandbox also expires on its own timeout, and
    // a failed cleanup must never be the thing that fails a run.
    try {
      await this.api('DELETE', ENDPOINTS.kill(id))
    } catch {
      // Swallowed deliberately. See above.
    }
  }
}
