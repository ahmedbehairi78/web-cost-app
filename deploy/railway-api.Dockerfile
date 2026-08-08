# Full-stack production image for Railway: Vite SPA + Express API + Prisma.
# Same service serves https://<domain>/ (UI) and https://<domain>/api/* (API).
# Docs: docs/RAILWAY_DEPLOY.md · DEPLOYMENT_PLAN.md
#
# Uses Debian (glibc) instead of Alpine (musl): Windows-generated lockfiles often
# skip optional platform binaries under npm ci (npm/cli#4828), which breaks
# Vite/Rollup/lightningcss/Tailwind oxide on Alpine.

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Force Linux glibc natives that npm ci may skip when lockfile was made on Windows.
RUN npm ci \
 && npm install --no-save \
      @rollup/rollup-linux-x64-gnu \
      lightningcss-linux-x64-gnu \
      @tailwindcss/oxide-linux-x64-gnu \
      @esbuild/linux-x64

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY scripts/copy-coa-seed.mjs ./scripts/copy-coa-seed.mjs
COPY scripts/generate-vite-env.mjs ./scripts/generate-vite-env.mjs
COPY config ./config

ENV VITE_DATA_BACKEND=local
ENV VITE_API_BASE_URL=/api
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN npx prisma generate
RUN node scripts/copy-coa-seed.mjs
RUN node scripts/generate-vite-env.mjs
RUN npm run build
RUN npx tsc -p server/tsconfig.build.json
# Prune dev deps once native modules (bcrypt, better-sqlite3) are built.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config
COPY scripts/start-api-production.mjs ./scripts/

# prisma CLI is devDependency — required for `migrate deploy` at container start.
RUN npm install --no-save prisma@^7.8.0

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/start-api-production.mjs"]
