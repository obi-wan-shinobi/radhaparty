# Builds the WebSocket server into one bundled file and runs it with plain
# Node. Works on any host that builds from a Dockerfile (Render, Fly.io,
# Railway). The host sets PORT; the server defaults to 8787.

FROM node:22-slim AS build
RUN npm install -g pnpm@10.34.5
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @radhaparty/server...
RUN pnpm --filter @radhaparty/server build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/packages/server/dist/index.cjs ./index.cjs
ENV NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node", "index.cjs"]
