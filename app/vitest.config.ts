import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Point @gsd/shared imports at the TypeScript source so `vitest run`
      // works without first running `npm run build -w @gsd/shared`. Runtime
      // (Nest server + Lambda bundles) still use the built dist/ via the
      // package.json "main" field — this alias only applies inside Vitest.
      '@gsd/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
  esbuild: {
    target: 'es2022',
  },
});
