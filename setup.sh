#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo ""
echo "  🎮  Game Server Manager — Setup"
echo "  ──────────────────────────────────────"
echo ""

# 1. Check / install prerequisites

# Node.js 20+
if ! command -v node >/dev/null 2>&1; then
  echo "📥  Node.js not found — please install Node.js 20+ (e.g. via nvm) and re-run."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌  Node.js 20+ required (detected $NODE_MAJOR)."
  exit 1
fi

# Terraform
if ! command -v terraform >/dev/null 2>&1; then
  echo "📥  terraform not found — installing via official HashiCorp repo..."
  sudo apt-get update -qq && sudo apt-get install -y gnupg software-properties-common curl
  curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
    | sudo tee /etc/apt/sources.list.d/hashicorp.list
  sudo apt-get update -qq && sudo apt-get install -y terraform
fi

# AWS CLI
if ! command -v aws >/dev/null 2>&1; then
  echo "📥  AWS CLI not found — installing v2..."
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  sudo /tmp/aws/install
  rm -rf /tmp/awscliv2.zip /tmp/aws
fi

echo "✅  Prerequisites found (node, terraform, aws cli)"

# 2. Install JS dependencies and build lambda bundles.
#
# Each Lambda is an esbuild-produced single-file bundle at
# packages/lambda/<name>/dist/handler.cjs. Terraform's `archive_file` resources
# zip that up at apply time, so the bundles must exist on disk BEFORE
# `terraform apply` can run. `npm run build:lambdas` does exactly that.
echo ""
echo "📦  Installing Node dependencies..."
cd "$SCRIPT_DIR/app"
npm ci
echo ""
echo "🧱  Building Lambda bundles..."
npm run build:lambdas

# 3. Terraform init
echo ""
echo "🔧  Initializing Terraform..."
cd "$SCRIPT_DIR/terraform"
if [ ! -f terraform.tfvars ]; then
  cp terraform.tfvars.example terraform.tfvars
  echo "   Created terraform.tfvars from example — edit it with your settings."
fi
terraform init

echo ""
echo "  ✅  Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Edit terraform/terraform.tfvars with your game servers and domain"
echo "    2. Run: cd terraform && terraform plan"
echo "    3. Run: cd terraform && terraform apply"
echo "    4. Run the management app:"
echo "         Dev:     cd app && npm run dev"
echo "         Docker:  docker compose up --build"
echo "    5. Open http://localhost:5173 (dev) or http://localhost:5000 (docker)"
echo ""
echo "  Discord bot setup (serverless):"
echo "    - Open Credentials tab in the web UI and save the Application ID,"
echo "      Bot Token, and Application Public Key from the Discord Developer Portal."
echo "    - Copy the 'Interactions Endpoint URL' from the same tab and paste it"
echo "      into the Discord Developer Portal under General Information."
echo "    - Add a guild ID under the Guilds tab and click 'Register commands'."
echo ""
