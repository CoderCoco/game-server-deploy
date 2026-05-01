import type { Answers } from '../types.ts';

/**
 * Mirrors the structure documented in the Makefile-driven submodule pattern:
 *   setup → init submodule, run setup.sh, stamp its sha
 *   plan  → copy tfvars in, delegate to submodule's `make tf-plan`
 *   apply → same, delegate to `make tf-apply`
 *   update → bump submodule, rerun setup.sh only if its sha changed
 *   dev   → pull live tfstate into .make/, then `make dev` in submodule
 *
 * API_TOKEN is loaded from .env (gitignored) — never hardcoded.
 */
export function renderMakefile(a: Answers): string {
  return `SHELL      := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

REPO_ROOT   := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
SUBMODULE   := $(REPO_ROOT)/${a.submoduleDir}
TF_DIR      := $(SUBMODULE)/terraform
TFVARS      := $(REPO_ROOT)/terraform.tfvars
STAMP_DIR   := $(REPO_ROOT)/.make
SETUP_STAMP := $(STAMP_DIR)/setup.stamp

# Load API_TOKEN (and any other K=V) from .env without leaking it into git.
ifneq (,$(wildcard $(REPO_ROOT)/.env))
include $(REPO_ROOT)/.env
export
endif

.PHONY: help setup plan apply update dev copy-tfvars

# ── Help ─────────────────────────────────────────────────────────────────────
help:
\t@echo "${a.projectName} — submodule deployment wrapper"
\t@echo ""
\t@echo "  make setup    One-time bootstrap: init submodule, install deps, terraform init"
\t@echo "  make plan     Copy tfvars into submodule then terraform plan"
\t@echo "  make apply    Copy tfvars into submodule then terraform apply"
\t@echo "  make update   Pull latest ${a.submoduleDir}/main; rerun setup.sh if changed"
\t@echo "  make dev      Start dev servers (Nest :3001 + Vite :5173)"

# ── Stamp dir ────────────────────────────────────────────────────────────────
$(STAMP_DIR):
\t@mkdir -p $@

# ── One-time setup ───────────────────────────────────────────────────────────
setup: | $(STAMP_DIR)
\tgit submodule update --init --recursive
\tbash $(SUBMODULE)/setup.sh
\t@sha256sum $(SUBMODULE)/setup.sh | cut -d' ' -f1 > $(SETUP_STAMP)

# ── Copy tfvars into the submodule terraform dir ─────────────────────────────
$(TF_DIR)/terraform.tfvars: $(TFVARS)
\tcp $(TFVARS) $@

# Force a fresh copy on every plan/apply so stale vars can't slip through.
copy-tfvars: $(TFVARS)
\tcp $(TFVARS) $(TF_DIR)/terraform.tfvars

# ── Terraform targets ────────────────────────────────────────────────────────
plan: copy-tfvars
\t$(MAKE) -C $(SUBMODULE) tf-plan

apply: copy-tfvars
\t$(MAKE) -C $(SUBMODULE) tf-apply

# ── Submodule update with idempotent setup.sh re-run ─────────────────────────
update: | $(STAMP_DIR)
\tgit submodule update --remote --merge $(SUBMODULE)
\t@CURRENT=$$(sha256sum $(SUBMODULE)/setup.sh | cut -d' ' -f1); \\
\t PREVIOUS=$$(cat $(SETUP_STAMP) 2>/dev/null || echo ""); \\
\t if [ "$$CURRENT" != "$$PREVIOUS" ]; then \\
\t   echo "setup.sh changed — clearing .terraform/ and rerunning..."; \\
\t   rm -rf $(TF_DIR)/.terraform; \\
\t   bash $(SUBMODULE)/setup.sh; \\
\t   echo "$$CURRENT" > $(SETUP_STAMP); \\
\t else \\
\t   echo "setup.sh unchanged — skipping."; \\
\t fi
\t@echo ""
\t@echo "Submodule updated. Commit the new pointer when ready:"
\t@echo "  git add ${a.submoduleDir} && git commit -m 'chore: bump ${a.submoduleDir}'"

# ── Dev server ───────────────────────────────────────────────────────────────
# Pull live tfstate so embed-tfstate has something to read; falls back to null
# when the backend isn't reachable yet (e.g. before the first apply).
dev: | $(STAMP_DIR)
\tterraform -chdir=$(TF_DIR) state pull > $(STAMP_DIR)/tfstate.json 2>/dev/null || echo 'null' > $(STAMP_DIR)/tfstate.json
\trm -f $(SUBMODULE)/app/packages/*/tsconfig*.tsbuildinfo
\tTF_STATE_PATH=$(STAMP_DIR)/tfstate.json $(MAKE) -C $(SUBMODULE) dev
`;
}
