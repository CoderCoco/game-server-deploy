APP_DIR  := app
TF_DIR   := terraform
STAMP    := .make

# ── Stamp files (touched after each successful build) ───────────────────────
INSTALL_STAMP  := $(STAMP)/install.stamp
SHARED_STAMP   := $(STAMP)/shared.stamp
SERVER_STAMP   := $(STAMP)/server.stamp
WEB_STAMP      := $(STAMP)/web.stamp
LAMBDAS_STAMP  := $(STAMP)/lambdas.stamp

# ── Source globs for change detection ───────────────────────────────────────
SHARED_SRCS  := $(shell find $(APP_DIR)/packages/shared/src  -name '*.ts'  2>/dev/null)
SERVER_SRCS  := $(shell find $(APP_DIR)/packages/server/src  -name '*.ts'  2>/dev/null)
WEB_SRCS     := $(shell find $(APP_DIR)/packages/web/src     -name '*.ts' -o -name '*.tsx' -o -name '*.css' 2>/dev/null) \
                $(APP_DIR)/packages/web/index.html \
                $(APP_DIR)/packages/web/vite.config.ts
LAMBDA_SRCS  := $(shell find $(APP_DIR)/packages/lambda      -name '*.ts' -o -name '*.mjs' 2>/dev/null)
PKG_JSONS    := $(shell find $(APP_DIR)/packages             -name 'package.json' 2>/dev/null) \
                $(APP_DIR)/package.json

.PHONY: all build build-app build-lambdas install dev test lint
.PHONY: tf-init tf-plan tf-apply tf-destroy tf-validate tf-fmt
.PHONY: clean help

# ── Default ──────────────────────────────────────────────────────────────────
all: build

# ── npm install ──────────────────────────────────────────────────────────────
$(STAMP):
	mkdir -p $@

$(INSTALL_STAMP): $(PKG_JSONS) | $(STAMP)
	cd $(APP_DIR) && npm install
	touch $@

install: $(INSTALL_STAMP)

# ── Shared ───────────────────────────────────────────────────────────────────
$(SHARED_STAMP): $(INSTALL_STAMP) $(SHARED_SRCS)
	cd $(APP_DIR) && npm run build -w @gsd/shared
	touch $@

# ── Server ───────────────────────────────────────────────────────────────────
$(SERVER_STAMP): $(SHARED_STAMP) $(SERVER_SRCS)
	cd $(APP_DIR) && npm run build -w @gsd/server
	touch $@

# ── Web ──────────────────────────────────────────────────────────────────────
$(WEB_STAMP): $(SHARED_STAMP) $(WEB_SRCS)
	cd $(APP_DIR) && npm run build -w @gsd/web
	touch $@

# ── Lambdas ──────────────────────────────────────────────────────────────────
$(LAMBDAS_STAMP): $(SHARED_STAMP) $(LAMBDA_SRCS)
	cd $(APP_DIR) && npm run build -w @gsd/lambda-interactions \
	                               -w @gsd/lambda-followup \
	                               -w @gsd/lambda-update-dns \
	                               -w @gsd/lambda-watchdog
	touch $@

# ── Composite build targets ───────────────────────────────────────────────────
build-app:     $(SERVER_STAMP) $(WEB_STAMP)
build-lambdas: $(LAMBDAS_STAMP)
build:         build-app build-lambdas

# ── Dev / test / lint ─────────────────────────────────────────────────────────
dev: $(INSTALL_STAMP)
	cd $(APP_DIR) && npm run dev

test: $(INSTALL_STAMP)
	cd $(APP_DIR) && npm test

lint: $(INSTALL_STAMP)
	cd $(APP_DIR) && npm run lint

# ── Terraform ─────────────────────────────────────────────────────────────────
tf-init:
	cd $(TF_DIR) && terraform init

tf-fmt:
	cd $(TF_DIR) && terraform fmt -recursive

tf-validate: tf-init
	cd $(TF_DIR) && terraform validate

# plan and apply rebuild lambdas first (archive_file reads the CJS bundles)
tf-plan: $(LAMBDAS_STAMP) tf-init
	cd $(TF_DIR) && terraform plan

tf-apply: $(LAMBDAS_STAMP) tf-init
	cd $(TF_DIR) && terraform apply

tf-destroy: tf-init
	cd $(TF_DIR) && terraform destroy

# ── Clean ──────────────────────────────────────────────────────────────────────
clean:
	rm -rf $(APP_DIR)/packages/shared/dist \
	       $(APP_DIR)/packages/server/dist \
	       $(APP_DIR)/packages/web/dist
	find $(APP_DIR)/packages/lambda -type d -name dist -exec rm -rf {} +
	rm -rf $(STAMP)

# ── Help ───────────────────────────────────────────────────────────────────────
help:
	@echo "Build targets"
	@echo "  make install        npm install (skipped when package.json unchanged)"
	@echo "  make build          build shared, server, web, and all lambdas"
	@echo "  make build-app      build shared + server + web"
	@echo "  make build-lambdas  build shared + all four lambdas"
	@echo ""
	@echo "Dev targets"
	@echo "  make dev            start Nest + Vite dev servers"
	@echo "  make test           run vitest"
	@echo "  make lint           run ESLint"
	@echo ""
	@echo "Terraform targets"
	@echo "  make tf-init        terraform init"
	@echo "  make tf-fmt         terraform fmt -recursive"
	@echo "  make tf-validate    terraform validate"
	@echo "  make tf-plan        build lambdas then terraform plan"
	@echo "  make tf-apply       build lambdas then terraform apply"
	@echo "  make tf-destroy     terraform destroy"
	@echo ""
	@echo "  make clean          remove all build output and stamps"
