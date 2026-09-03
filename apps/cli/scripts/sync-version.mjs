#!/usr/bin/env node
/**
 * Copies the version from package.json into src/version.ts.
 *
 * The CLI has to print its own version, and a compiled binary has no
 * package.json next to it to read at runtime -- so the number has to be in the
 * source by the time it is bundled. Keeping the literal hand-written meant it
 * drifted from the manifest the moment anything else bumped the manifest.
 *
 * Tegami runs this after it applies a version, so the bump lands in the same
 * Version Packages pull request as package.json. The builds run it too, so a
 * binary can never carry a stale number, and CI runs it with --check to fail a
 * pull request that edited one of the two by hand.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'src/version.ts')

const { version } = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
)

const contents = `/** Generated from package.json by scripts/sync-version.mjs. Do not edit. */
export const VERSION = '${version}'
`

const current = await readFile(target, 'utf8').catch(() => '')

if (process.argv.includes('--check')) {
  if (current !== contents) {
    console.error(
      `src/version.ts is out of date: package.json says ${version}.\n` +
        'Run "pnpm --filter @forge/cli sync-version" and commit the result.',
    )
    process.exit(1)
  }
  process.exit(0)
}

if (current !== contents) {
  await writeFile(target, contents)
  console.log(`src/version.ts -> ${version}`)
}
