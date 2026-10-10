FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app

# The lockfile is the dependency source of truth. The build context excludes
# local dependencies, generated assets, secrets, and Git history.
COPY . .

# Web bundle configuration is fixed at build time. Leave unset for local defaults; the TLS overlay sets
# VITE_API_URL=/api so the browser talks to the same origin that served the page.
ARG VITE_API_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_ALLOWED_EMAIL_DOMAINS
ENV VITE_API_URL=${VITE_API_URL}     VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}     VITE_ALLOWED_EMAIL_DOMAINS=${VITE_ALLOWED_EMAIL_DOMAINS}

RUN pnpm config set ignore-scripts true \
  && pnpm install --frozen-lockfile \
  && pnpm run build

FROM node:22-alpine AS runtime-base

RUN corepack enable \
  && corepack prepare pnpm@11.22.0 --activate \
  && addgroup -S -g 10001 vault \
  && adduser -S -D -H -u 10001 -G vault vault

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app

FROM runtime-base AS migration
CMD ["pnpm", "run", "--filter", "@tkxel-vault/vault-core", "migrate"]

# Long-running services run as the unprivileged vault user and start node directly, so signals reach
# the process and nothing needs a writable home directory.
FROM runtime-base AS api-server
EXPOSE 3002
USER 10001:10001
CMD ["node", "apps/api-server/dist/server.js"]

FROM runtime-base AS mcp-gateway
EXPOSE 3001
USER 10001:10001
CMD ["node", "services/mcp-gateway/dist/start.js"]

FROM runtime-base AS skill-runner
EXPOSE 3003
USER 10001:10001
CMD ["node", "services/skill-runner/dist/server.js"]

FROM nginx:1.27-alpine AS web-app
COPY docker/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web-app/dist /usr/share/nginx/html
EXPOSE 80
