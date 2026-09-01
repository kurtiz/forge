import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
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
