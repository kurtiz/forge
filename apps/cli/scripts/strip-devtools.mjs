/**
 * A Bun bundler plugin that empties Ink's React DevTools integration.
 *
 * Ink loads the integration behind a `process.env['DEV'] === 'true'` guard, so
 * it can never run in a released build. The bundler still has to resolve what
 * is inside the branch, though, and that pulls in two packages worth of code:
 * react-devtools-core, and a full `ws` WebSocket client that ink/build/
 * devtools.js imports on its own to probe for a listening devtools server.
 *
 * `--define process.env.DEV="false"` looks like it should collapse the guard,
 * and used to be what the compile did, but Bun only rewrites the dotted form
 * and Ink reads the bracket form -- so the branch survived and the devtools
 * shipped in every released binary. Bun rejects a bracketed --define key
 * outright, and `--external` is worse than the disease: the import turns eager
 * and the CLI dies on startup with ERR_MODULE_NOT_FOUND.
 *
 * So the module is emptied instead. Stubbing devtools.js rather than the two
 * packages under it takes both out in one interception, and leaves `ws` alone
 * everywhere else in case something legitimately wants it. Nothing reaches the
 * stub unless DEV is set, and the guard is what keeps it from being reached.
 */
const EMPTY_MODULE = 'export {}'

/** Ink's devtools entry, as imported by ink/build/reconciler.js. */
const DEVTOOLS_SPECIFIER = /^\.\/devtools\.js$/
const INK_RECONCILER = /[\\/]ink[\\/]build[\\/]reconciler\.js$/

/**
 * Set by the plugin when it actually replaces something, so a build can tell
 * the difference between "no devtools in the output" and "the filter stopped
 * matching because Ink moved the file". The first is the goal; the second is
 * how this regressed the last time, silently.
 */
export const applied = { count: 0 }

/** @type {import('bun').BunPlugin} */
export const stripDevtools = {
  name: 'strip-devtools',
  setup(build) {
    build.onResolve({ filter: DEVTOOLS_SPECIFIER }, (args) => {
      if (!INK_RECONCILER.test(args.importer)) return
      applied.count++
      return { path: 'ink-devtools', namespace: 'strip-devtools' }
    })

    build.onLoad({ filter: /.*/, namespace: 'strip-devtools' }, () => ({
      contents: EMPTY_MODULE,
      loader: 'js',
    }))
  },
}

/**
 * Fails a build whose output still carries the devtools. The marker is the
 * address ink/build/devtools.js probes for a running DevTools server. It is a
 * plain string literal, so minification leaves it intact, and it is specific to
 * the module being stubbed -- unlike the WebSocket handshake GUID, which reads
 * as a match against any compiled binary because Bun's own runtime implements
 * WebSocket and embeds the same constant.
 *
 * Both halves matter. The plugin counter catches Ink moving the file, which
 * would leave the filter matching nothing; the scan catches the devtools
 * arriving by some path the plugin does not intercept. Either way the build
 * stops, rather than quietly shipping a WebSocket server to users the way the
 * --define it replaced did.
 */
export async function assertStripped(paths) {
  const DEVTOOLS_PROBE = 'ws://localhost:8097'

  if (applied.count === 0) {
    throw new Error(
      'strip-devtools matched nothing: Ink has probably moved build/devtools.js.\n' +
        'Check ink/build/reconciler.js and update the filter in scripts/strip-devtools.mjs.',
    )
  }

  for (const path of paths) {
    if ((await Bun.file(path).text()).includes(DEVTOOLS_PROBE)) {
      throw new Error(
        `${path} still contains Ink's React DevTools client.\n` +
          'Something reaches it by a path scripts/strip-devtools.mjs does not intercept.',
      )
    }
  }
}
