/**
 * Where a pull request's preview lives.
 *
 * Two ways to learn it, in order of preference:
 *
 *   1. The host told GitHub. Cloudflare Pages, Vercel, Netlify and friends all
 *      post `deployment_status` events carrying the environment URL, so Forge
 *      verifies exactly what the host published.
 *   2. The project supplied a template. Some setups never report deployments,
 *      and a pattern like `https://pr-{number}.example.pages.dev` is enough.
 *
 * Pure: no Workers imports, no network. The result is still run through
 * `assertSafeTargetUrl` before anything navigates to it.
 */

export type PreviewContext = {
  number: number | null
  branch: string | null
  sha: string | null
}

/**
 * Substitutes `{number}`, `{branch}`, `{sha}` and `{sha7}` into a template.
 * Returns null when the template needs a value this pull request does not
 * have, rather than producing a URL with a literal `{branch}` in it.
 */
export function resolvePreviewTemplate(
  template: string | null,
  context: PreviewContext,
): string | null {
  if (!template) return null

  const values: Record<string, string | null> = {
    number: context.number === null ? null : String(context.number),
    branch: context.branch ? slugifyBranch(context.branch) : null,
    sha: context.sha,
    sha7: context.sha ? context.sha.slice(0, 7) : null,
  }

  let missing = false
  const resolved = template.replace(/\{(number|branch|sha7|sha)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === null || value === '') {
      missing = true
      return ''
    }
    return value
  })

  return missing ? null : resolved
}

/**
 * Branch names become hostname labels on most preview hosts: lowercase, and
 * anything outside `[a-z0-9-]` collapsed to a single dash. This mirrors what
 * Cloudflare Pages and Vercel do, which is the point - the URL has to match
 * one they actually published.
 */
export function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}
