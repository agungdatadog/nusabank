# Build context is the repo root (tools/build/cloudbuild.yaml) so the shared seed is reachable.
FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY services/rewards-service/package.json services/rewards-service/package-lock.json ./
RUN npm ci
COPY services/rewards-service/tsconfig.json ./
COPY services/rewards-service/src ./src
RUN npm run build && npm test && npm prune --omit=dev

FROM node:22.23.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY services/rewards-service/package.json ./
COPY services/rewards-service/migrations ./migrations
COPY catalog/seed/customers.json ./seed/customers.json
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.js"]
