# Build context is the repo root (tools/build/cloudbuild.yaml) so the shared seed is reachable.
FROM grafana/k6:2.2.0
WORKDIR /scripts
COPY services/load-generator/script.js ./script.js
COPY catalog/seed/customers.json ./customers.json
ENTRYPOINT ["k6", "run", "--quiet", "--no-summary", "/scripts/script.js"]
