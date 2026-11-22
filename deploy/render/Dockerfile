# The whole system in one container, for a free public demo (Render: 0.1 CPU, 512 MB).
# Data is disposable on purpose. For anything real use compose.yaml or managed databases.
# Build from the repository root: docker build -f deploy/render/Dockerfile .

FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache postgresql17 redis tini
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
COPY deploy/render/start.mjs /app/start.mjs
RUN mkdir -p /data /run/postgresql /app/.cache \
  && chown postgres:postgres /data /run/postgresql /app/.cache

ENV NODE_ENV=production \
    NODE_COMPILE_CACHE=/app/.cache \
    HOST=0.0.0.0 \
    PGHOST=127.0.0.1 \
    PGPORT=5432 \
    PGADMIN_USERNAME=taskforge \
    PGDATABASE=taskforge \
    REDIS_HOST=127.0.0.1 \
    DEMO_MODE=true \
    PUBLIC_DEMO=true \
    CLIENT_IP_HEADER=cf-connecting-ip \
    LEASE_MS=10000 \
    SHUTDOWN_GRACE_MS=3000 \
    HASH_COST=256

USER postgres

# The app connects as an ordinary role. Postgres only listens on the container's loopback.
RUN initdb -D /data -U postgres --auth=trust --encoding=UTF8 >/dev/null \
  && pg_ctl -D /data -w -o "-c listen_addresses=127.0.0.1" start >/dev/null \
  && psql -qU postgres -d postgres -c "CREATE ROLE taskforge LOGIN" -c "CREATE DATABASE taskforge OWNER taskforge" \
  && pg_ctl -D /data -w stop >/dev/null

# Boot once during the build. A wake-up then finds migrations applied and code already compiled,
# which matters a great deal on a tenth of a CPU.
RUN node /app/start.mjs > /tmp/prime.log 2>&1 & pid=$!; \
  for i in $(seq 1 60); do grep -q '"worker started"' /tmp/prime.log && break; sleep 1; done; \
  sleep 2; kill -TERM $pid; wait $pid || { cat /tmp/prime.log; exit 1; }; \
  grep -q '"worker started"' /tmp/prime.log || { cat /tmp/prime.log; exit 1; }; \
  rm /tmp/prime.log

EXPOSE 10000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/start.mjs"]
