# Build context is the repo root (tools/build/cloudbuild.yaml).
FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY services/chat-service/package.json services/chat-service/package-lock.json ./
RUN npm ci
COPY services/chat-service/tsconfig.json ./
COPY services/chat-service/src ./src
RUN npm run build && npm test && npm prune --omit=dev

FROM node:22.23.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY services/chat-service/package.json ./
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.js"]
