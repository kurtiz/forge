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
Cloudflare rather than released, and its version is never bumped.

Most changes need no changelog file at all: versions are derived from
conventional commit subjects since the last release tag, so a `feat(cli):` or
`fix(cli):` commit is enough on its own. Write a `.tegami/*.md` file when the
release note needs more than a commit subject can carry, or when the bump the
commits imply is not the bump the change deserves.

Nothing is published to a registry. `@forge/cli` is `private`, so Tegami
versions it and writes its changelog while the release workflow tags the
version and attaches the compiled binaries to a GitHub release.

Do not edit `apps/cli/src/version.ts` either. It is generated from
`package.json`, and CI fails a pull request where the two disagree.

See [`docs/releasing.md`](docs/releasing.md) for the whole pipeline.
