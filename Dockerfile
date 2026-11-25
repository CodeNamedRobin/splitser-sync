FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache wget
COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .build python3 make g++ \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && apk del .build \
    && chown node:node /app
COPY --chown=node:node server.js client.js config.js actual.js reconcile.js http.js ./
RUN mkdir /data && chown node:node /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8787/health || exit 1
ENV HOST=0.0.0.0 PORT=8787 COOKIE_FILE=/data/cookies.txt ACTUAL_DATA_DIR=/data/actual
USER node
EXPOSE 8787
CMD ["node", "server.js"]
