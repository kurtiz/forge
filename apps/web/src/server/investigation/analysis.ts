/**
 * Pure investigation logic: turning runtime evidence into repository queries,
 * and repository output back into ranked source.
 *
 * Split out from the Solari client for the same reason `security/target-url.ts`
 * is split from `security/index.ts`: nothing here imports the Workers runtime,
 * so all of it is unit-testable without a workerd pool.
 */
import type {
  InvestigationRequest,
  PackageManager,
  SourceMatch,
} from './types'

export const MAX_QUERIES = 6
export const MAX_MATCHES = 40
export const MAX_AFFECTED_FILES = 8
export const MAX_EXCERPT_CHARS = 400

/**
 * Words that appear in almost every stack trace and identify nothing. Searching
 * a repository for "undefined" returns the whole repository.
 */
const STOPWORDS = new Set([
  'error', 'errors', 'failed', 'failure', 'cannot', 'undefined', 'null',
  'function', 'object', 'string', 'number', 'boolean', 'array', 'request',
  'response', 'status', 'http', 'https', 'true', 'false', 'this', 'that',
  'with', 'from', 'type', 'types', 'value', 'property', 'properties',
  'reading', 'uncaught', 'typeerror', 'referenceerror', 'syntaxerror',
  'internal', 'server', 'client', 'network', 'timeout', 'unknown', 'index',
  'default', 'module', 'exports', 'require', 'import', 'const', 'return',
  'async', 'await', 'promise', 'unable', 'invalid', 'missing', 'expected',
])

/** Truncates without collapsing newlines: a code excerpt needs its lines. */
export function truncateExcerpt(input: string, limit = MAX_EXCERPT_CHARS): string {
  const trimmed = input.replace(/[ \t]+$/gm, '').trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`
}

/** Quoted spans and identifier-shaped tokens, in that order of specificity. */
function extractIdentifiers(text: string): string[] {
  const found: string[] = []

  for (const match of text.matchAll(/['"`]([^'"`\n]{2,60})['"`]/g)) {
    const candidate = match[1].trim()
    if (candidate.length >= 3) found.push(candidate)
  }

  for (const match of text.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{3,40}\b/g)) {
    const token = match[0]
    if (!STOPWORDS.has(token.toLowerCase())) found.push(token)
  }

  return found
}

/** URL and route paths, with the scheme and host stripped off first. */
function extractPaths(text: string): string[] {
  const withoutOrigin = text.replace(/https?:\/\/[^\s/]+/g, '')
  const found: string[] = []

  for (const match of withoutOrigin.matchAll(/\/[A-Za-z0-9._\-/[\]$]{2,80}/g)) {
    const path = match[0].replace(/[.,;:)\]]+$/, '')
    // A bare "/" or a path of only separators identifies nothing.
    if (/[A-Za-z0-9]/.test(path) && path.length >= 3) found.push(path)
  }

  return found
}

/**
 * Builds the repository search terms for one failure, most specific first.
 *
 * Ordering matters more than volume: the first queries are the ones most likely
 * to land on the code that produced the failure, and the list is capped, so a
 * flood of generic tokens can never push a specific route path off the end.
 */
export function buildSearchQueries(request: InvestigationRequest): string[] {
  const evidence = [...request.networkErrors, ...request.consoleErrors]

  const candidates: string[] = [
    // Route paths from network errors: the most direct source link there is.
    ...evidence.flatMap(extractPaths),
    // The journey's own entry path.
    ...(request.entryPath && request.entryPath !== '/' ? [request.entryPath] : []),
    // Quoted spans and identifiers out of console errors.
    ...evidence.flatMap(extractIdentifiers),
    // Last resort: distinctive words from what the journey was called.
    ...request.journeyName
      .split(/[^A-Za-z0-9]+/)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word.toLowerCase())),
  ]

  const seen = new Set<string>()
  const queries: string[] = []

  for (const candidate of candidates) {
    const query = candidate.trim()
    const key = query.toLowerCase()
    if (query.length < 3 || seen.has(key)) continue
    seen.add(key)
    queries.push(query)
    if (queries.length >= MAX_QUERIES) break
  }

  return queries
}

const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

/** The blueprint is explicit that npm must not be assumed. */
export function detectPackageManager(paths: string[]): PackageManager | null {
  const root = new Set(paths.map((path) => path.replace(/^\.\//, '')))
  for (const [file, manager] of LOCKFILES) {
    if (root.has(file)) return manager
  }
  return null
}

const DEPENDENCY_FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['astro', 'Astro'],
  ['@remix-run/react', 'Remix'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['@tanstack/react-start', 'TanStack Start'],
  ['@angular/core', 'Angular'],
  ['gatsby', 'Gatsby'],
  ['solid-start', 'SolidStart'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['hono', 'Hono'],
  ['vue', 'Vue'],
  ['react', 'React'],
  ['svelte', 'Svelte'],
  ['vite', 'Vite'],
]

const MARKER_FRAMEWORKS: ReadonlyArray<[RegExp, string]> = [
  [/^next\.config\./, 'Next.js'],
  [/^nuxt\.config\./, 'Nuxt'],
  [/^astro\.config\./, 'Astro'],
  [/^svelte\.config\./, 'SvelteKit'],
  [/^remix\.config\./, 'Remix'],
  [/^angular\.json$/, 'Angular'],
  [/^gatsby-config\./, 'Gatsby'],
  [/^vite\.config\./, 'Vite'],
  [/^go\.mod$/, 'Go'],
  [/^Cargo\.toml$/, 'Rust'],
  [/^pyproject\.toml$|^requirements\.txt$/, 'Python'],
  [/^Gemfile$/, 'Ruby'],
  [/^composer\.json$/, 'PHP'],
  [/^pom\.xml$|^build\.gradle$/, 'JVM'],
]

/**
 * Framework detection. Declared dependencies beat file markers, because a
 * `vite.config.ts` sits happily inside a Next.js or SvelteKit repository.
 */
export function detectFramework(
  paths: string[],
  packageJsonRaw: string | null,
): string | null {
  if (packageJsonRaw) {
    try {
      const parsed = JSON.parse(packageJsonRaw) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const deps = {
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
      }
      for (const [dependency, framework] of DEPENDENCY_FRAMEWORKS) {
        if (dependency in deps) return framework
      }
    } catch {
      // A repository is allowed to ship a malformed package.json. Fall through
      // to markers rather than failing the whole investigation over it.
    }
  }

  const root = new Set(paths.map((path) => path.replace(/^\.\//, '')))
  for (const [marker, framework] of MARKER_FRAMEWORKS) {
    for (const path of root) {
      if (marker.test(path)) return framework
    }
  }

  return null
}

const IGNORED_SEGMENTS = [
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', '.output/',
  '.svelte-kit/', '.nuxt/', 'coverage/', 'vendor/', '__pycache__/',
]

const IGNORED_SUFFIXES = [
  '.min.js', '.min.css', '.map', '.lock', '.snap', '.gen.ts', '.d.ts',
]

/** Generated, vendored, and build output can match a query but never explain it. */
export function isIgnorablePath(path: string): boolean {
  const normalised = path.replace(/^\.\//, '')
  if (IGNORED_SEGMENTS.some((segment) => normalised.includes(segment))) return true
  if (IGNORED_SUFFIXES.some((suffix) => normalised.endsWith(suffix))) return true
  return LOCKFILES.some(([file]) => normalised.endsWith(file))
}

/** Lower sorts first. Application source outranks tests, config, and docs. */
function pathScore(path: string): number {
  const normalised = path.replace(/^\.\//, '')
  let score = 50

  if (/^(src|app|routes|pages|lib|server|components|api)\//.test(normalised)) score -= 20
  if (/\/(routes|pages|api|handlers|controllers)\//.test(normalised)) score -= 8
  if (/\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|astro|py|go|rb|php|java|rs)$/.test(normalised)) score -= 5
  if (/(^|\/)(test|tests|__tests__|spec|e2e|fixtures?|mocks?)\//.test(normalised)) score += 25
  if (/\.(test|spec)\.[a-z]+$/.test(normalised)) score += 25
  if (/(^|\/)(docs?|examples?|scripts?)\//.test(normalised)) score += 15
  if (/\.(md|mdx|txt|json|ya?ml|toml)$/.test(normalised)) score += 12
  // Deeply nested files are usually more specific than top-level ones.
  score += Math.min(normalised.split('/').length, 8)

  return score
}

/**
 * Ranks matches and drops the ones that cannot explain anything. Order within
 * an equal score is preserved, so query specificity survives the sort.
 */
export function rankMatches(matches: SourceMatch[]): SourceMatch[] {
  const seen = new Set<string>()
  const usable = matches.filter((match) => {
    if (isIgnorablePath(match.path)) return false
    const key = `${match.path}:${match.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return usable
    .map((match, index) => ({ match, index, score: pathScore(match.path) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ match }) => match)
    .slice(0, MAX_MATCHES)
}

/** The ranked, deduplicated paths written to `findings.affected_files`. */
export function affectedFilesFrom(
  matches: SourceMatch[],
  limit = MAX_AFFECTED_FILES,
): string[] {
  const files: string[] = []
  for (const match of matches) {
    if (!files.includes(match.path)) files.push(match.path)
    if (files.length >= limit) break
  }
  return files
}

/** Parses `path:line:text` output from grep into matches. */
export function parseGrepOutput(stdout: string, query: string): SourceMatch[] {
  const matches: SourceMatch[] = []

  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    // Context lines from `grep -C` use `path-line-text`; only take real hits.
    const parsed = line.match(/^(.+?):(\d+):(.*)$/)
    if (!parsed) continue
    const [, path, lineNumber, text] = parsed
    matches.push({
      path: path.replace(/^\.\//, ''),
      line: Number(lineNumber),
      excerpt: truncateExcerpt(text),
      query,
    })
  }

  return matches
}
