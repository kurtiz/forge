/**
 * Argument parsing.
 *
 * Small on purpose. It handles `--flag value`, `--flag=value`, and boolean
 * flags, and it rejects an unknown flag rather than ignoring it: a typo in
 * `--timeout` on a CI gate should fail loudly, not silently use the default.
 */
export type Args = {
  command: string
  flags: Record<string, string | boolean>
  positional: string[]
}

export function parseArgs(argv: string[], known: Set<string>): Args {
  /*
   * `forge --help` and `forge --version` have no command word, so a leading
   * flag is left in the option stream rather than being mistaken for one.
   */
  const leadsWithFlag = argv[0]?.startsWith('--') ?? false
  const command = leadsWithFlag ? 'help' : (argv[0] ?? 'help')
  const rest = leadsWithFlag ? argv : argv.slice(1)

  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]

    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const [name, inline] = splitFlag(token.slice(2))
    if (!known.has(name)) {
      throw new Error(`Unknown option "--${name}".`)
    }

    if (inline !== undefined) {
      flags[name] = inline
      continue
    }

    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true
    } else {
      flags[name] = next
      i++
    }
  }

  return { command, flags, positional }
}

function splitFlag(token: string): [string, string | undefined] {
  const index = token.indexOf('=')
  if (index === -1) return [token, undefined]
  return [token.slice(0, index), token.slice(index + 1)]
}

export function stringFlag(
  args: Args,
  name: string,
  fallback?: string,
): string | undefined {
  const value = args.flags[name]
  if (typeof value === 'string') return value
  if (value === true) throw new Error(`--${name} needs a value.`)
  return fallback
}

export function boolFlag(args: Args, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === 'true'
}

export function numberFlag(args: Args, name: string, fallback: number): number {
  const value = stringFlag(args, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number.`)
  }
  return parsed
}
