#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo ""
echo "  🎮  Palworld Server Manager — Setup"
echo "  ──────────────────────────────────────"
echo ""

# 1. Check prerequisites
command -v python3 >/dev/null 2>&1 || { echo "❌  python3 is required. Install it first."; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "❌  terraform is required. Install it first."; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "❌  AWS CLI is required. Install it first."; exit 1; }

echo "✅  Prerequisites found (python3, terraform, aws cli)"

# 2. Python dependencies
echo ""
echo "📦  Installing Python dependencies..."
cd "$SCRIPT_DIR"
python3 -m pip install -r requirements.txt --quiet

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
echo "    1. Edit terraform/terraform.tfvars with your settings"
echo "    2. Run: cd terraform && terraform plan"
echo "    3. Run: cd terraform && terraform apply"
echo "    4. Run: cd app && python3 app.py"
echo "    5. Open http://localhost:5000"
echo ""
