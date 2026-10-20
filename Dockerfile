# Jack Vault game server (API, WebSocket and back office).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY profiles ./profiles
COPY office ./office
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["npx", "tsx", "src/api/server.ts"]
