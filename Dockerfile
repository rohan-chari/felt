# syntax=docker/dockerfile:1.7

# Debian-based (glibc) — required by uWebSockets.js prebuilt native binary.
FROM node:22-slim AS base
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- deps: install all workspaces' deps with full pnpm cache layer ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @felt/server... --filter "!@felt/web"

# --- runtime: deps + source, run server via tsx ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY pnpm-workspace.yaml package.json ./
COPY apps/server ./apps/server
COPY packages/engine ./packages/engine
COPY packages/shared ./packages/shared
EXPOSE 8080
CMD ["pnpm", "--filter", "@felt/server", "start"]
