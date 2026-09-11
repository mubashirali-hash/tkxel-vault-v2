FROM node:22-alpine AS builder
# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

WORKDIR /app

# Copy all source code (respects .dockerignore)
COPY . .

# Install dependencies and build all workspaces
RUN pnpm config set ignore-scripts true
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# Runner stage
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

WORKDIR /app

# Copy the built application from the builder stage
COPY --from=builder /app /app

# Expose all ports that might be used
EXPOSE 3000 3001 3002 3003

# The default command (will be overridden by docker-compose)
CMD ["echo", "Please provide a command in docker-compose.yml"]
