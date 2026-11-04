FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# Source maps stay in the build stage (/app/sourcemaps) for the Datadog upload in
# cloudbuild.yaml; the served image never contains them.
RUN npm run build && mkdir -p /app/sourcemaps && cp -r dist/assets /app/sourcemaps/ \
    && rm -f dist/assets/*.map

FROM nginxinc/nginx-unprivileged:1.31.4-alpine3.24
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY 40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
RUN nginx -t
EXPOSE 8080
