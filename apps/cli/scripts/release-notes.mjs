#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section for one version, for use as release notes.
 *
 * Tegami prepends a `## @forge/cli@<version>` section to CHANGELOG.md when it
 * applies a version, so the notes for a release already exist by the time the
 * release is cut. This reads that one section back out rather than shipping a
 * release whose body is a commit range nobody wants to read.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const version = process.argv[2]
if (!version) {
  console.error('Usage: release-notes.mjs <version>')
  process.exit(2)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8').catch(
  () => '',
)

const lines = changelog.split('\n')
const start = lines.findIndex(
  (line) => line.startsWith('## ') && line.includes(version),
)

/*
 * A missing section is not a failure. A release can be cut from a changelog
 * that was never written -- the binaries are still worth publishing, and an
 * empty body is better than a failed workflow.
 */
if (start === -1) {
  console.log(`Release ${version}.`)
  process.exit(0)
}

let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].startsWith('## ')) {
    end = i
    break
  }
}

console.log(lines.slice(start + 1, end).join('\n').trim())
