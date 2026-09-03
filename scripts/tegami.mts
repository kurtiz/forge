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

// @ts-ignore
import { execFile } from "node:child_process";
// @ts-ignore
import { promisify } from "node:util";
import { type LogGenerator, tegami, type TegamiPlugin } from "tegami";
import { runCli } from "tegami/cli";
import { simpleGenerator } from "tegami/generators/simple";
import { github } from "tegami/plugins/github";

const run = promisify(execFile);

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
    name: "forge:sync-cli-version",
    async applyCliDraft() {
      await run("node", ["scripts/sync-version.mjs"], {
        cwd: new URL("../apps/cli/", import.meta.url).pathname,
      });
    },
  };
}

/**
 * Trailers are addressed to the repository, not to the reader of a release.
 *
 * Changelog entries are generated from commit bodies, so anything a commit
 * carries for tooling -- session links, sign-offs, co-authors -- would be
 * published as part of the release note. They are stripped here rather than
 * left out of commits, because the commits are the right place for them.
 */
const TRAILER = /^(?:Claude-Session|Co-authored-by|Signed-off-by|Refs|Closes):/i;

function withoutTrailers(): LogGenerator {
  const base = simpleGenerator();
  return {
    async generate(options) {
      const text = await base.generate.call(this, options);
      return text
        .split("\n")
        .filter((line) => !TRAILER.test(line.trim()))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    },
  };
}

const paper = tegami({
  conventionalCommits: true,
  generator: withoutTrailers(),
  plugins: [
    syncCliVersion(),
    github({
      repo: "kurtiz/forge",
      versionPr: { base: "main" },
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
  ignore: ["@forge/web"],
});

await runCli(paper);
