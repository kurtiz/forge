#!/usr/bin/env bun
/**
 * Bundles the CLI into dist/ for the npm package.
 *
 * This used to be a bare `tsc -p .`, which emitted a faithful file-per-module
 * dist/ and left every dependency to be resolved at install time. The output
 * was 120 KB and the install was 23 MB across 38 packages, because Ink brings
 * React, a reconciler, Yoga, and es-toolkit -- 18 MB on its own -- along with
 * it. Bundling folds the parts that are actually reached into dist/ and drops
 * the dependency tree entirely: the published package has no runtime deps.
 *
 * Splitting is the reason this is not one file. `verify` and `projects` render
 * through Ink, and index.ts imports them dynamically so the paths that only
 * print text -- --version, --help, and the CI renderer, which is most of the
 * runs -- never pay to parse a UI framework. Bundling to a single file inlines
 * that import and undoes it: measured, the entry grows to 560 KB and startup
 * goes from 33 ms to 55 ms. With splitting the entry stays ~9 KB, Ink sits in a
 * chunk that is only loaded when something actually renders, and startup is
 * unchanged.
 *
 * Sourcemaps are deliberately not emitted. They cost 2.0 MB against a bundle of
 * half that -- 1.8 MB of it mapping Ink and React rather than anything in src --
 * and nothing consumes them: the CLI reports failures through fatal(), which
 * prints error.message, so a stack trace never reaches a user to be mapped.
 *
 * Types are not checked here. `tsc --noEmit` still owns that, as `typecheck`.
 */
import { rm, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stripDevtools, assertStripped } from './strip-devtools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'dist')

/* tsc's output is a file per module; a bundle is a handful of hashed chunks.
   Stale files from either shape would otherwise accumulate in the package. */
await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(root, 'src/index.ts')],
  outdir,
  target: 'node',
  format: 'esm',
  splitting: true,
  minify: true,
  plugins: [stripDevtools],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await assertStripped(result.outputs.map((out) => out.path))

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
const total = result.outputs.reduce((sum, out) => sum + out.size, 0)

/* The entry is the number that matters for startup: it is what Node parses
   before it can answer --version. The rest is loaded only when it is needed. */
const entry = result.outputs.find((out) => out.kind === 'entry-point')

for (const out of result.outputs) {
  const name = out.path.slice(outdir.length + 1)
  console.log(`  dist/${name}  ${kilobytes(out.size)}`)
}

console.log(
  `\n  entry ${kilobytes(entry.size)}, ${kilobytes(total)} total, no runtime dependencies`,
)
