# Build context is the repo root (tools/build/cloudbuild.yaml) so the shared seed is reachable.
FROM grafana/k6:2.2.0
WORKDIR /scripts
COPY services/load-generator/script.js ./script.js
COPY catalog/seed/customers.json ./customers.json
# Fail the build, not the pod, on a script or option error.
RUN k6 inspect /scripts/script.js > /dev/null
ENTRYPOINT ["k6", "run", "--quiet", "--summary-mode=disabled", "/scripts/script.js"]
