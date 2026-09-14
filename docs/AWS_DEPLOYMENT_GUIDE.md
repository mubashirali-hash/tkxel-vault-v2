# tkxel Vault: AWS Demo Account Deployment Guide

This guide walks you through deploying **tkxel Vault** to your DEMO AWS account using automated Infrastructure-as-Code (CloudFormation) and GitHub Actions CI/CD.

---

## 1. Architecture Overview (Option B: Low-Cost Turnkey Stack)

For testing in a Demo AWS account, this architecture minimizes costs (~$10–15/mo or Free Tier eligible) while maintaining full production parity:
- **Compute:** Single AWS EC2 instance (`t3.small` or `t3.medium`) running containerized:
  - `web-app`: Web Admin & 2D/3D Knowledge Graph on `:3000`
  - `api-server`: REST API Server on `:3002`
  - `mcp-gateway`: Streamable HTTP & stdio MCP Gateway on `:3001`
  - `postgres`: PostgreSQL 16 with `pgvector` on `:5432`
  - `redis`: Redis 7 Cache on `:6379`
- **Security:** Native **AWS KMS** Customer Master Key (`alias/tkxel-vault-demo-key`) for AES-256-GCM envelope encryption.
- **CI/CD:** Automated GitHub Actions pipeline (`ci.yml` + `deploy-aws.yml`).

---

## 2. Fast-Track Deployment (1-Click CloudFormation)

### Step 1: Launch Stack in AWS Console
1. Open the **AWS CloudFormation Console**: [console.aws.amazon.com/cloudformation](https://console.aws.amazon.com/cloudformation)
2. Click **Create stack > With new resources (standard)**.
3. Select **Upload a template file** and choose:
   `infra/cloudformation/tkxel-vault-demo.yml`
4. Enter Stack name: `tkxel-vault-demo`.
5. Parameters:
   - `InstanceType`: `t3.small` (default)
   - `KeyPairName`: Select your SSH key pair (or leave blank if using AWS SSM).
6. Click **Next > Next > Check "I acknowledge that AWS CloudFormation might create IAM resources" > Submit**.

### Step 2: Retrieve Output URLs
Within ~3–4 minutes, check the **Outputs** tab of your stack:
- **`WebUrl`**: `http://<PUBLIC_IP>:3000` (Access Web App & Knowledge Graph)
- **`ApiUrl`**: `http://<PUBLIC_IP>:3002/api`
- **`McpGatewayUrl`**: `http://<PUBLIC_IP>:3001/mcp`
- **`KmsKeyArn`**: ARN of the provisioned AWS KMS key

---

## 3. Configuring GitHub Actions CI/CD

To automate deployments whenever you push changes to `main` or `dev`:

1. Navigate to your GitHub Repository:
   `https://github.com/mubashirali-hash/tkxel-vault-v2`
2. Go to **Settings > Secrets and variables > Actions**.
3. Add the following repository secrets:

| Secret Name | Value | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | `wJalr...` | IAM user secret key |
| `AWS_REGION` | `us-east-1` | AWS deployment region |
| `EC2_HOST` | `<PUBLIC_IP>` | Output IP from CloudFormation |
| `EC2_SSH_KEY` | `-----BEGIN OPENSSH...` | Private SSH key (if deploying via SSH) |
| `AWS_KMS_KEY_ID` | `arn:aws:kms:...` | Output KMS Key ARN from CloudFormation |

### Step 3: Trigger Deployment
- Go to the **Actions** tab on GitHub.
- Select **Deploy to AWS Demo**.
- Click **Run workflow** and choose branch (`main` or `dev`).
- The pipeline will run all 145 tests, connect to your AWS Demo instance, pull the latest code, build containers, and verify health.

---

## 4. Connecting Claude Code & Cursor to Cloud MCP Gateway

Once deployed on AWS, configure your AI coding agents to communicate with your remote tkxel Vault over Streamable HTTP:

### Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "tkxel-vault-cloud": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote-client",
        "http://<PUBLIC_IP>:3001/mcp"
      ]
    }
  }
}
```

### Cursor / Codex IDE
In Cursor **Settings > Features > MCP**:
- Name: `tkxel-vault-cloud`
- Type: `sse` (or `http`)
- URL: `http://<PUBLIC_IP>:3001/mcp`

---

## 5. Cost Teardown (When Testing Completes)

When you have finished testing in your demo account, delete the stack to avoid any ongoing charges:
1. Open CloudFormation Console.
2. Select `tkxel-vault-demo`.
3. Click **Delete**.
4. AWS will automatically terminate the EC2 instance, release the Elastic IP, and schedule the KMS key for deletion.
