import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    /**
     * Source attribution is off.
     *
     * The devtools plugin stamps every JSX element with a `data-tsd-source`
     * attribute carrying its file and line number. That turns a source edit
     * into a hydration mismatch: a tab holding HTML rendered before the edit
     * re-hydrates against hot-updated modules whose line numbers have moved,
     * and React reports every element in the tree as mismatched. The warning is
     * real but says nothing about the application, and it buries the mismatches
     * that would.
     *
     * The cost is click-to-open-in-editor from the devtools panel. Everything
     * else the devtools do is unaffected.
     */
    devtools({ injectSource: { enabled: false } }),
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      /**
       * Remote bindings, and therefore Workers AI in development, switch on
       * when CLOUDFLARE_ACCOUNT_ID names an account:
       *
       *   CLOUDFLARE_ACCOUNT_ID=<id> pnpm dev     # real model calls
       *   pnpm dev                                # offline, heuristic agents
       *
       * Which bindings actually go remote is decided per binding in
       * wrangler.jsonc, and only `ai` is marked, so D1, R2, and the Durable
       * Object stay local either way.
       *
       * Tied to the account id rather than switched on outright because the
       * plugin cannot pick between the accounts a login can see: on a login
       * with several, unconditional remote bindings do not degrade to local,
       * they stop `pnpm dev` from starting at all. `wrangler whoami` lists the
       * ids. Without one, model calls fail and the agents fall back to their
       * heuristics, which is a working run with worse journeys - a run never
       * depends on a model being reachable.
       */
      remoteBindings: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
