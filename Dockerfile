# Multi-stage build for the Next.js app. The same image runs both the web
# server (default) and the background ingest worker (override CMD in compose).

# ---- 1. deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ---- 2. builder ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. runner ----
# Uses Next.js standalone output (set in next.config.ts) — copies only the
# traced runtime deps, dropping eslint/tailwind/typescript/@types/* etc.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# scripts/worker.mjs needs node_modules from the standalone trace.
COPY --from=builder /app/scripts ./scripts

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
