import type { Answers } from '../types.js';

export function renderGitignore(a: Answers): string {
  return `# ${a.projectName} — parent repo .gitignore

# Bearer token + any local environment overrides
.env
.env.*
!.env.example

# Make stamp dir (sha256 of submodule's setup.sh, cached tfstate.json, ...)
.make/

# Terraform local state, if you ever fall off the S3 backend
terraform.tfstate
terraform.tfstate.backup
*.tfvars.local

# Editor / OS noise
.DS_Store
.vscode/
.idea/
`;
}
