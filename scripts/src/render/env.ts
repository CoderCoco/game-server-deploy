import type { Answers } from '../types.js';

export function renderEnv(a: Answers): string {
  return `# Bearer token for the management app (also used by docker compose).
# This file is gitignored — never commit it. Rotate by deleting and re-running
# \`init-parent init\` (or just generate a new hex string).
API_TOKEN=${a.apiToken}
`;
}
