/**
 * Release configuration.
 *
 * Versions come from conventional commits rather than a hand-run `npm version`:
 * `feat:` takes a minor, `fix:` a patch, and a `!` or a `BREAKING CHANGE:`
 * footer takes a major. Anything a commit subject cannot express well goes in a
 * `.tegami/*.md` changelog file instead, and the two are merged.
 *
 * Nothing is published to a registry. `@forge/cli` is private, so Tegami
 * versions it and writes its changelog but never reaches npm; the release
 * workflow tags the version and attaches the compiled binaries to a GitHub
 * release. Dropping `private` from the package manifest is what turns npm
 * publishing on later -- no change is needed here.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tegami, type TegamiPlugin } from 'tegami'
import { runCli } from 'tegami/cli'
import { github } from 'tegami/plugins/github'

const run = promisify(execFile)

/**
 * Writes the new version into the CLI's source after a version is applied.
 *
 * A compiled binary has no package.json to read at runtime, so `forge
 * --version` reads a generated constant. Doing it here puts that file in the
 * same Version Packages pull request as the bump, rather than leaving it to be
 * noticed later.
 */
function syncCliVersion(): TegamiPlugin {
  return {
    name: 'forge:sync-cli-version',
    async applyCliDraft() {
      await run('node', ['scripts/sync-version.mjs'], {
        cwd: new URL('../apps/cli/', import.meta.url).pathname,
      })
    },
  }
}

const paper = tegami({
  conventionalCommits: true,
  plugins: [
    syncCliVersion(),
    github({
      repo: 'kurtiz/forge',
      versionPr: { base: 'main' },
      /*
       * The release workflow creates the tag and the release itself, because
       * only it knows about the binaries that have to be attached. Tegami
       * would skip both anyway: it does not tag a package it did not publish.
       */
      release: false,
      createTags: false,
    }),
  ],
  /* The Worker is deployed, not released. Only the CLI is versioned. */
  ignore: ['@forge/web'],
})

await runCli(paper)
