# NAVADA World View — WorldMonitor dashboard (frontend + local API server)
# Build:  docker build -t navada-world-view .
# Run:    docker compose up -d

# ---- Stage 1: build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ENV VITE_VARIANT=full
ENV VITE_MAP_INTERACTION_MODE=3d
ENV NODE_OPTIONS=--max-old-space-size=4096

# Bundle the sebuf RPC gateway (api/[domain]/v1/[rpc].ts -> .js) then build the frontend
RUN node scripts/build-sidecar-sebuf.mjs && npx vite build

# ---- Stage 2: runtime ----
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Static frontend + API handlers + sidecar server
COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/server ./server
COPY --from=build /app/src-tauri/sidecar ./src-tauri/sidecar
COPY --from=build /app/serve-local.mjs /app/start-api.mjs ./
COPY --from=build /app/data ./data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

EXPOSE 4173

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:4173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run API server (:46123) and frontend/proxy (:4173) together;
# container exits (and Docker restarts it) if either process dies.
CMD ["bash", "-c", "node start-api.mjs & node serve-local.mjs & wait -n; exit 1"]
