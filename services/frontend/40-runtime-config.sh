#!/bin/sh
# Writes /tmp/config.js from env at container start, so RUM ids and the version come
# from the Deployment (and the Admission Controller's DD_VERSION), not the image.
set -eu
cat > /tmp/config.js <<EOF
window.NUSABANK_CONFIG = {
  rumApplicationId: "${RUM_APPLICATION_ID:-}",
  rumClientToken: "${RUM_CLIENT_TOKEN:-}",
  rumRemoteConfigId: "${RUM_REMOTE_CONFIG_ID:-}",
  env: "${DD_ENV:-demo}",
  version: "${DD_VERSION:-unknown}"
};
EOF
