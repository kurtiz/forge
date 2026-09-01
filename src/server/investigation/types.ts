/**
 * Source investigation abstraction.
 *
 * Forge owns this interface; Solari's sandbox implements it. It is the sibling
 * of `execution/types.ts`: the browser tells us what the application did, this
 * tells us which source could explain it.
 *
 * There is deliberately no write, exec, or command method here. Investigation
 * is read-only in v1 - no dependency install, no build, no test run, no patch -
 * so the type system refuses mutation rather than relying on a prompt to.
 */

/** One source location that matched evidence from the failing journey. */
export type SourceMatch = {
  /** Repository-relative path, e.g. `src/routes/invite.tsx`. */
  path: string
  line: number
  /** The matching line plus a little context. Truncated. */
  excerpt: string
  /** The search term that found it, so a reader can judge the link. */
  query: string
}

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

/** What an investigation learned. Everything here is evidence, never a verdict. */
export type SourceInsight = {
  framework: string | null
  packageManager: PackageManager | null
  /** Ranked, deduplicated repository paths. Written to `findings.affected_files`. */
  affectedFiles: string[]
  matches: SourceMatch[]
  /** Human-readable trace of what the investigator did and did not find. */
  notes: string[]
  /** Commit the evidence was read at, when the clone reported one. */
  commit: string | null
}

/**
 * The runtime evidence an investigation starts from. Deliberately narrow: the
 * investigator gets what was observed, not the whole run.
 */
export type InvestigationRequest = {
  /** Canonical public GitHub URL. Re-validated before use. */
  repoUrl: string
  journeyName: string
  entryPath: string
  consoleErrors: string[]
  networkErrors: string[]
  status?: number
}

export type InvestigatorKind = 'solari-sandbox'

export interface SourceInvestigator {
  readonly kind: InvestigatorKind
  /** Provider sandbox id, once one exists. */
  readonly sandboxId: string | null
  /** Seconds of sandbox wall time consumed so far, for budget accounting. */
  readonly elapsedSeconds: number
  investigate(request: InvestigationRequest): Promise<SourceInsight>
  /** Releases the sandbox. Always called, including on cancellation. */
  close(): Promise<void>
}

export class InvestigatorError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'InvestigatorError'
  }
}
