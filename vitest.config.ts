import { defineConfig } from 'vitest/config'

/**
 * Unit tests cover the modules that decide things: the run state machine,
 * failure classification and scoring, budget enforcement, target-URL safety,
 * and model-output parsing. All of them are free of Workers runtime imports by
 * design, which is what makes them testable here without a workerd pool.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '#': new URL('./src/', import.meta.url).pathname },
  },
})
