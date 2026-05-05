// Vitest setup for the workspace. Loaded for every test file via
// `test.setupFiles` in vitest.config.ts. Currently registers the
// @testing-library/jest-dom matchers (`toBeInTheDocument`,
// `toHaveTextContent`, etc.) and runs RTL's cleanup after each test —
// this isn't auto-wired because we run with `globals: false`, which
// disables RTL's normal auto-cleanup hook. Only React component tests
// in @gsd/web run under the `jsdom` environment, so this is a no-op for
// server-side specs.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
