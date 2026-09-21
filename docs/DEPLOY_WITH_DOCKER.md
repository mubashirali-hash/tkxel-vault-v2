# Deploy tkxel Vault with Docker

The repository builds five deployment images from the root `Dockerfile`:

| Image suffix | Purpose |
| --- | --- |
| `web-app` | Nginx-served browser application |
| `api-server` | REST API |
| `mcp-gateway` | Streamable HTTP MCP gateway |
| `skill-runner` | Isolated locked-skill service |
| `migration` | One-shot schema migrator |

PostgreSQL/pgvector and Redis use their official upstream images. The Compose file starts the migration image before application services.

## Build and run on a deployment host

1. Copy `.env.deploy.example` to `.env` and replace every placeholder using your secret manager. Do not commit `.env`.
2. Ensure Docker has the `runsc` runtime registered before starting the stack. The skill runner fails closed when that runtime is unavailable.
3. Build and start:

```bash
docker compose --env-file .env build
docker compose --env-file .env up -d
```

The web application is available on port `3000`; the MCP gateway is on port `3001`. The runner is deliberately not published to the host. Put the public services behind TLS ingress before exposing them to users.

## Tag for a registry

Set `IMAGE_PREFIX` and `IMAGE_TAG` in `.env` before building. For example:

```dotenv
IMAGE_PREFIX=ghcr.io/your-organization/tkxel-vault
IMAGE_TAG=2026-09-21
```

Then build and publish the application images:

```bash
docker compose --env-file .env build
docker compose --env-file .env push web-app api-server mcp-gateway skill-runner migration
```

On another host, use the same `.env`, run `docker compose pull`, then `docker compose up -d`. This deployment bundle does not publish images automatically or include credentials.

## Required evidence before public production use

Containerization makes the stack deployable; it does not replace the outstanding release gates. Complete the genuine cloud-KMS and hosted-LLM smoke tests, migrate the plaintext timeline-entry field, and follow the [production operations runbook](./runbooks/PRODUCTION_OPERATIONS_RUNBOOK.md) before claiming production approval.
