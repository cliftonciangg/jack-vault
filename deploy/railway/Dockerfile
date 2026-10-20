# Production image for Railway (or any host that runs one container behind HTTPS).
# One container serves the whole site on $PORT:
#   Caddy   serves the player client and proxies /api, /ws and /office to
#   Node    the game server on 127.0.0.1:8081.
# Build context is the repository root (railway.json points here).

# 1. Player client
FROM node:22-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY profiles ./profiles
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client
COPY client ./client
RUN npm run build --prefix client

# 2. Game server + Caddy
FROM node:22-slim
COPY --from=caddy:2.10 /usr/bin/caddy /usr/bin/caddy
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY profiles ./profiles
COPY office ./office
COPY --from=client /app/client/dist /srv/client
COPY deploy/railway/Caddyfile /etc/caddy/Caddyfile
COPY deploy/railway/start.sh /app/start.sh
# NODE_ENV=production turns off the demo-distributor account.
ENV NODE_ENV=production PORT=8080 XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
EXPOSE 8080
USER node
CMD ["sh", "/app/start.sh"]
