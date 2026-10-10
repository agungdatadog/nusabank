FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build && rm -f dist/assets/*.map

FROM nginxinc/nginx-unprivileged:1.31.4-alpine3.24
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY 40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
RUN nginx -t
EXPOSE 8080
