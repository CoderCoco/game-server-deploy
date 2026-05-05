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
      // The @gsd/web package uses `@/foo` as a shortcut for `./src/foo`
      // (matches its tsconfig + Vite config). Re-declare it here so the
      // same imports resolve under Vitest.
      '@': resolve(__dirname, 'packages/web/src'),
    },
  },
  test: {
    include: ['packages/**/*.test.{ts,tsx}'],
    // Default environment for server-side and shared tests is Node.
    // React component tests under @gsd/web override this via
    // `environmentMatchGlobs` so they get a real DOM.
    environment: 'node',
    environmentMatchGlobs: [['packages/web/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
  esbuild: {
    target: 'es2022',
  },
});
