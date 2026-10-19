import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/integration/**/*.test.js',
  version: '1.90.0',
  mocha: { ui: 'tdd', timeout: 20000 },
});
