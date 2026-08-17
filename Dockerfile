FROM node:22-alpine AS dependencies
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
ARG CODEPOOL_COMMIT_SHA=unknown
WORKDIR /app/apps/web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CODEPOOL_COMMIT_SHA=${CODEPOOL_COMMIT_SHA} \
    CODEPOOL_DATABASE_PATH=/app/apps/web/data/codepool.db

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && mkdir -p -m 0700 /app/apps/web/data \
    && mkdir -p -m 0700 /backup/codepool \
    && chown -R nextjs:nodejs /app /backup

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/scripts/*.mjs /app/apps/web/scripts/

USER nextjs
EXPOSE 3000
VOLUME ["/app/apps/web/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
