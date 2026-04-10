#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo ""
echo "  🎮  Game Server Manager — Setup"
echo "  ──────────────────────────────────────"
echo ""

# 1. Check / install prerequisites

# Python 3
if ! command -v python3 >/dev/null 2>&1; then
  echo "📥  python3 not found — installing via apt..."
  sudo apt-get update -qq && sudo apt-get install -y python3 python3-pip
fi

# pipenv (installed via pipx to avoid externally-managed-environment errors)
if ! command -v pipenv >/dev/null 2>&1; then
  echo "📥  pipenv not found — installing via pipx..."
  if ! command -v pipx >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y pipx
    pipx ensurepath
  fi
  pipx install pipenv
  export PATH="$HOME/.local/bin:$PATH"
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

echo "✅  Prerequisites found (python3, terraform, aws cli)"

# 2. Python dependencies
echo ""
echo "📦  Installing Python dependencies via pipenv..."
cd "$SCRIPT_DIR"
pipenv install --quiet

# 3. Terraform init
echo ""
echo "🔧  Initializing Terraform..."
cd "$SCRIPT_DIR/terraform"
if [ ! -f terraform.tfvars ]; then
  cp terraform.example.tfvars terraform.tfvars
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
echo "         Direct:  cd app && pipenv run python app.py"
echo "         Docker:  docker compose up --build"
echo "    5. Open http://localhost:5000"
echo ""
