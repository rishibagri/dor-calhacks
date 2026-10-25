# dor worker: one long-running process (not serverless). Build from the repo root:
#   docker build -f deploy/worker/Dockerfile -t dor-worker .
# Secrets come from the runtime environment only (deploy/worker/worker.env.example); none are baked in.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY spacetimedb/package.json spacetimedb/
COPY src/agents/package.json src/agents/
COPY worker/package.json worker/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY contracts/tsconfig.json contracts/
COPY contracts/src contracts/src
COPY src/agents/tsconfig.json src/agents/
COPY src/agents/src src/agents/src
COPY worker worker
RUN npm run build -w @dor/contracts && npm run build -w @dor/agents && npm run build -w @dor/worker \
  && npm prune --omit=dev --ignore-scripts

FROM node:24-slim
# Explicit no-model default: fixed templates and deterministic choices, zero provider calls. Opt in to models only by
# overriding DOR_DROID_TRANSPORT (sdk + FACTORY_API_KEY) after a cost decision.
# All temporary files (Droid slot dirs, Factory session transcripts under $HOME) live on the /tmp tmpfs, so nothing
# persists across restarts and the root filesystem can be mounted read-only.
ENV NODE_ENV=production \
    PORT=8787 \
    DOR_DROID_TRANSPORT=off \
    DOR_WORKER_INTRODUCTIONS=deterministic \
    TMPDIR=/tmp \
    HOME=/tmp/home
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/contracts/package.json contracts/package.json
COPY --from=build /app/contracts/dist contracts/dist
COPY --from=build /app/src/agents/package.json src/agents/package.json
COPY --from=build /app/src/agents/dist src/agents/dist
COPY --from=build /app/worker/package.json worker/package.json
COPY --from=build /app/worker/dist worker/dist
USER node
EXPOSE 8787
# /healthz is 200 only while the SpacetimeDB connection is up (503 otherwise).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "worker/dist/main.js"]
