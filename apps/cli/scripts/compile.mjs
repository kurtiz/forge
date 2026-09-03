#!/usr/bin/env node
/**
 * Cross-compiles the CLI into standalone executables, one per platform.
 *
 * Bun embeds its own runtime in the output, so the result runs on a machine
 * with no Node and no npm — which is the point. A CI runner that has to
 * `npm install -g` before it can verify a deployment has already spent longer
 * on the install than the check itself takes.
 *
 * The binaries are large (~60 MB) because a runtime is inside each one. They
 * are release artifacts, not package contents: `bin/` is ignored by git and
 * excluded from the npm tarball, where `dist/` and a Node shebang stay the
 * right answer.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'

/** Bun's target triples, and the binary name each one produces. */
const TARGETS = [
  ['bun-darwin-arm64', 'forge-darwin-arm64'],
  ['bun-darwin-x64', 'forge-darwin-x64'],
  ['bun-linux-x64', 'forge-linux-x64'],
  ['bun-linux-arm64', 'forge-linux-arm64'],
  ['bun-windows-x64', 'forge-windows-x64.exe'],
]

mkdirSync('bin', { recursive: true })

const failed = []
for (const [target, name] of TARGETS) {
  const result = spawnSync(
    'bun',
    [
      'build',
      'src/index.ts',
      '--compile',
      '--minify',
      '--sourcemap',
      `--target=${target}`,
      '--outfile',
      `bin/${name}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )

  if (result.error?.code === 'ENOENT') {
    console.error('bun is not installed: https://bun.sh')
    process.exit(1)
  }

  if (result.status !== 0) {
    failed.push(name)
    continue
  }

  const megabytes = (statSync(`bin/${name}`).size / 1024 / 1024).toFixed(1)
  console.log(`  bin/${name}  ${megabytes} MB`)
}

if (failed.length > 0) {
  console.error(`\nFailed: ${failed.join(', ')}`)
  process.exit(1)
}
