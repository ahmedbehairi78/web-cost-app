# Full-stack production image for Railway: Vite SPA + Express API + Prisma.
# Same service serves https://<domain>/ (UI) and https://<domain>/api/* (API).
# Docs: docs/RAILWAY_DEPLOY.md · DEPLOYMENT_PLAN.md
#
# Uses Debian (glibc) instead of Alpine (musl): Windows-generated lockfiles often
# skip optional platform binaries under npm ci (npm/cli#4828), which breaks
# Vite/Rollup/lightningcss/Tailwind oxide on Alpine.
#
# Size: UI/build packages live in devDependencies — pruned after Vite/tsc build.
# Runtime image keeps Express + Prisma + server natives only (SPA is static `dist/`).

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

# Keep Prisma CLI for migrate deploy (devDependency) before prune removes it.
RUN mkdir -p /opt/keep \
 && cp -a node_modules/prisma /opt/keep/prisma \
 && cp -a node_modules/@prisma/engines /opt/keep/engines 2>/dev/null || true \
 && cp -a node_modules/@prisma/engines-version /opt/keep/engines-version 2>/dev/null || true \
 && cp -a node_modules/@prisma/fetch-engine /opt/keep/fetch-engine 2>/dev/null || true \
 && cp -a node_modules/@prisma/get-platform /opt/keep/get-platform 2>/dev/null || true

# Drop Vite/React/UI toolchain — already baked into dist/.
# Explicit rm covers packages npm may keep as peerOptional after prune.
RUN npm prune --omit=dev \
 && rm -rf \
      node_modules/electron-updater \
      node_modules/react \
      node_modules/react-dom \
      node_modules/scheduler \
      node_modules/lucide-react \
      node_modules/recharts \
      node_modules/motion \
      node_modules/framer-motion \
      node_modules/firebase \
      node_modules/vite \
      node_modules/@vitejs \
      node_modules/@tailwindcss \
      node_modules/tailwindcss \
      node_modules/tailwind-merge \
      node_modules/xlsx \
      node_modules/html2canvas \
      node_modules/react-hook-form \
      node_modules/@hookform \
      node_modules/react-hot-toast \
      node_modules/goober \
      node_modules/clsx \
      node_modules/@google \
      node_modules/arabic-reshaper \
      node_modules/bidi-js \
      node_modules/electron \
      node_modules/electron-builder \
      node_modules/app-builder-bin \
      node_modules/app-builder-lib \
      node_modules/typescript \
      node_modules/vitest \
      node_modules/@vitest \
      node_modules/tsx \
      node_modules/knip \
      node_modules/concurrently \
      node_modules/esbuild \
      node_modules/@esbuild \
      node_modules/rollup \
      node_modules/@rollup \
      node_modules/lightningcss \
 && cp -a /opt/keep/prisma node_modules/prisma \
 && mkdir -p node_modules/@prisma \
 && if [ -d /opt/keep/engines ]; then cp -a /opt/keep/engines node_modules/@prisma/engines; fi \
 && if [ -d /opt/keep/engines-version ]; then cp -a /opt/keep/engines-version node_modules/@prisma/engines-version; fi \
 && if [ -d /opt/keep/fetch-engine ]; then cp -a /opt/keep/fetch-engine node_modules/@prisma/fetch-engine; fi \
 && if [ -d /opt/keep/get-platform ]; then cp -a /opt/keep/get-platform node_modules/@prisma/get-platform; fi \
 && npm cache clean --force \
 && rm -rf /tmp/* /root/.npm /opt/keep

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

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/start-api-production.mjs"]
