# Release workflow

This repository uses [Tegami](https://tegami.fuma-nama.dev) for versioning and publishing.

## Write changelog files

Create pending changelog files under `.tegami/` as `YYYY-MM-DD-{hash}.md`.

See the [changelog format docs](https://tegami.fuma-nama.dev/changelog) for details.

### Example

```md
---
packages:
  "npm:@acme/ui": patch
---

### Fix button hover state

The hover color now matches the design system.
```

### Package references

Use package names, ids, or groups in frontmatter. For example:

- `"@acme/ui"` — package name
- `"npm:@acme/ui"` — package id
- `"group:acme"` — every package in a group

Rules:

- Include YAML frontmatter with `packages`
- Include at least one `#`, `##`, or `###` heading in the body
- Write user-facing release notes under each heading
- Do not edit the publish lock file (`.tegami/publish-lock.yaml`) or package `CHANGELOG.md` files directly

## In this repository

`@forge/cli` is the only versioned package. `@forge/web` is deployed to
Cloudflare rather than released, and `@forge/video` renders a film this
repository builds rather than something anyone installs. Both are named in the
`ignore` list in `scripts/tegami.mts`, because being `private` exempts nothing --
that is exactly how `@forge/cli` is versioned without ever reaching a registry.
`video/CHANGELOG.md` and the version in `video/package.json` are what is left of
the period before that list was right; neither is bumped now.

Most changes need no changelog file at all: versions are derived from
conventional commit subjects since the last release tag, so a `feat(cli):` or
`fix(cli):` commit is enough on its own. Write a `.tegami/*.md` file when the
release note needs more than a commit subject can carry, or when the bump the
commits imply is not the bump the change deserves.

The scope is what does the work, and only the scope. Tegami resolves a commit to
a package by the name in the parentheses -- never by the files the commit
touched -- so a bare `feat:` resolves to no package at all and is dropped
silently, however much of `apps/cli` it rewrote. A change to the CLI that goes in
under `feat:` or under another package's scope will not be released, and nothing
reports that it was skipped. When commits have already landed that way, a
`.tegami/*.md` file naming the package is how the release is recovered.

Nothing is published to a registry. `@forge/cli` is `private`, so Tegami
versions it and writes its changelog while the release workflow tags the
version and attaches the compiled binaries to a GitHub release.

Do not edit `apps/cli/src/version.ts` either. It is generated from
`package.json`, and CI fails a pull request where the two disagree.

See [`docs/releasing.md`](docs/releasing.md) for the whole pipeline.
