#!/usr/bin/env bun
/**
 * Cross-compiles the CLI into standalone executables, one per platform.
 *
 * Bun embeds its own runtime in the output, so the result runs on a machine
 * with no Node and no npm -- which is the point. A CI runner that has to
 * `npm install -g` before it can verify a deployment has already spent longer
 * on the install than the check itself takes.
 *
 * The binaries are large -- 62 MB for darwin-arm64, up to 95 MB for Windows --
 * because a runtime is inside each one, and almost nothing but the runtime: a
 * hello-world compiles to 60.5 MB on this platform, so the bundled code is
 * under 2 MB of the total and there is no bundler setting that meaningfully
 * moves the number. Bun is already the smallest of the options; Deno's runtime
 * floor is 82 MB and Node's SEA is 116 MB. What does move it is compressing the
 * release artifacts, which is the installer's job, not this script's.
 *
 * The binaries are release artifacts, not package contents: `bin/` is ignored
 * by git and excluded from the npm tarball, where `dist/` and a Node shebang
 * stay the right answer.
 *
 * This drives Bun.build rather than spawning `bun build`, because stripping the
 * devtools out of Ink needs a resolver plugin and the CLI has no flag for one.
 * See scripts/strip-devtools.mjs for why the --define that used to sit here did
 * not do what it claimed.
 */
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stripDevtools, assertStripped } from './strip-devtools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Bun's target triples, and the binary name each one produces. */
const TARGETS = [
  ['bun-darwin-arm64', 'forge-darwin-arm64'],
  ['bun-darwin-x64', 'forge-darwin-x64'],
  ['bun-linux-x64', 'forge-linux-x64'],
  ['bun-linux-arm64', 'forge-linux-arm64'],
  ['bun-windows-x64', 'forge-windows-x64.exe'],
]

/*
 * A pull request only needs proof that the binary builds and runs, so CI builds
 * the one it is standing on and names it `forge`; a release builds all five.
 */
const native = process.argv.includes('--native')
const builds = native ? [[undefined, 'forge']] : TARGETS

mkdirSync(join(root, 'bin'), { recursive: true })

const failed = []
for (const [target, name] of builds) {
  const result = await Bun.build({
    entrypoints: [join(root, 'src/index.ts')],
    minify: true,
    sourcemap: 'linked',
    plugins: [stripDevtools],
    compile: {
      ...(target ? { target } : {}),
      outfile: join(root, 'bin', name),
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    failed.push(name)
    continue
  }

  await assertStripped([join(root, 'bin', name)])

  const { size } = await Bun.file(join(root, 'bin', name)).stat()
  console.log(`  bin/${name}  ${(size / 1024 / 1024).toFixed(1)} MB`)
}

if (failed.length > 0) {
  console.error(`\nFailed: ${failed.join(', ')}`)
  process.exit(1)
}
