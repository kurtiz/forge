/**
 * Terminal output.
 *
 * Colour is applied only when the stream is a TTY and `NO_COLOR` is unset, so
 * piping the output into a file or a CI log produces clean text. Progress is
 * written to stderr and results to stdout, which is what makes
 * `forge verify --json | jq` work while the run is still going.
 */
/** Written as an escape sequence so the source file stays printable. */
const ESC = '\u001b['

const useColor =
  process.stdout.isTTY === true &&
  !process.env.NO_COLOR &&
  process.env.TERM !== 'dumb'

const wrap = (code: string) => (text: string) =>
  useColor ? `${ESC}${code}m${text}${ESC}0m` : text

export const bold = wrap('1')
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')
export const blue = wrap('36')

export const PASS = green('✓')
export const FAIL = red('✗')

export function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

export function note(line = ''): void {
  process.stderr.write(`${line}\n`)
}

export function fatal(message: string, code = 2): never {
  process.stderr.write(`${red('Error')} ${message}\n`)
  process.exit(code)
}

/**
 * A one-line status that rewrites itself on a TTY and prints one line per
 * change everywhere else, so a CI log gets a readable phase history instead of
 * thousands of escape sequences.
 */
export function progress(): (message: string) => void {
  let last = ''
  return (message: string) => {
    if (message === last) return
    last = message
    if (process.stderr.isTTY) {
      process.stderr.write(`\r${ESC}2K${dim(message)}`)
    } else {
      process.stderr.write(`${message}\n`)
    }
  }
}

export function clearProgress(): void {
  if (process.stderr.isTTY) process.stderr.write(`\r${ESC}2K`)
}
