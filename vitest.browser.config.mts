import { defineConfig } from 'vitest/config';

/** Tests that drive a real Chromium-based browser. Run `npm run compile` first. */
export default defineConfig({
  test: {
    include: ['test/browser/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
