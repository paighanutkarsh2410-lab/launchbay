# Install production dependencies with npm in a build stage...
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ...then run on a runtime image without npm, yarn or corepack: the service never needs them,
# and they are where most of a Node base image's vulnerabilities live.
FROM node:22-alpine
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Run as the image's non-root "node" user; cluster policies reject root containers.
USER 1000
EXPOSE 3000
CMD ["node", "src/server.js"]
