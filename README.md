# Palworld Server Manager (POC)

A cost-efficient Palworld dedicated server on **AWS Fargate** with a local web UI to manage everything. The server only runs (and costs money) when you want to play.

## Architecture

- **AWS Fargate** — runs the Palworld dedicated server container on-demand (no idle EC2 costs)
- **EFS** — persists world saves across server restarts
- **Terraform** — provisions all AWS infrastructure
- **Flask web app** — local dashboard to start/stop the server, edit config, and monitor costs

## Quick Start

```bash
# 1. Run setup (installs deps, inits terraform)
chmod +x setup.sh && ./setup.sh

# 2. Configure your server
#    Edit terraform/terraform.tfvars

# 3. Deploy infrastructure
cd terraform
terraform plan      # review changes
terraform apply     # create resources

# 4. Launch the management UI
cd ../app
python3 app.py
# Open http://localhost:5000
```

## Cost Breakdown

| Resource | Cost |
|----------|------|
| Fargate (2 vCPU, 8 GB) | ~$0.12/hr while running |
| EFS storage | ~$0.30/GB/month |
| Data transfer | minimal for game traffic |

**Example**: Playing 4 hours/day, 5 days/week ≈ **$10–12/month**.

Compare to a t3.large running 24/7 ≈ $60/month.

## Management App Features

- **Start/Stop** — scales Fargate service between 0 and 1 tasks
- **Server Config** — edit player count, difficulty, passwords, and Fargate sizing
- **Cost Monitoring** — real-time estimates and AWS Cost Explorer integration
- **Live Logs** — stream CloudWatch logs in the browser

## Project Structure

```
palworld-server/
├── terraform/
│   ├── main.tf              # VPC, ECS, EFS, IAM, security groups
│   ├── variables.tf         # All configurable parameters
│   ├── outputs.tf           # Values used by the management app
│   └── terraform.tfvars.example
├── app/
│   ├── app.py               # Flask web server
│   ├── server_manager.py    # AWS SDK logic (ECS, CloudWatch, Cost Explorer)
│   └── templates/
│       └── index.html       # Dashboard UI
├── requirements.txt
├── setup.sh
└── README.md
```

## Tearing Down

To stop all costs:

```bash
# First stop the server via the UI, then:
cd terraform
terraform destroy
```
