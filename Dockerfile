FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN apk add --no-cache python3 make g++ \
    && pnpm install --frozen-lockfile --ignore-scripts=false
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build \
    && pnpm prune --prod --ignore-scripts

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache wget
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir /data && chown node:node /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8787/health || exit 1
ENV HOST=0.0.0.0 PORT=8787 COOKIE_FILE=/data/cookies.txt ACTUAL_DATA_DIR=/data/actual
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]
