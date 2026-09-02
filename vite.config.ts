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
       * Workers AI has no local simulator, so enabling remote bindings would
       * make `pnpm dev` require a Cloudflare login and an account selection.
       * Forge degrades to its heuristic agents when no model is reachable, so
       * local development stays offline by default. Set `remoteBindings: true`
       * (and CLOUDFLARE_ACCOUNT_ID, if the login has several accounts) to
       * exercise Workers AI locally.
       */
      remoteBindings: false,
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
