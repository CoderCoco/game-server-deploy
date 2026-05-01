/**
 * Bundles src/index.ts into a single self-contained ESM file. The source only
 * uses node:* builtins, so the output has no runtime npm dependencies.
 *
 * Output: dist/init-parent.mjs
 * Run via: npm run build (from scripts/ or -w @gsd/scripts from root)
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/init-parent.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // The shebang lets the file be executed directly as a script.
  banner: { js: '#!/usr/bin/env node' },
});

console.log('✓ dist/init-parent.mjs');
