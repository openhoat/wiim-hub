#!/usr/bin/env sh
# Build the image and push it to the registry.
# Usage: scripts/build.sh [VERSION]
set -eu

cd "$(dirname "$0")/.."

VERSION=${1:-$(node -p "require('./package.json').version")}
REGISTRY=${REGISTRY:-registry.op3n.cloud}
IMAGE=${IMAGE:-wiim-hub}

echo "building $REGISTRY/$IMAGE:$VERSION (linux/amd64)"

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --tag "$REGISTRY/$IMAGE:$VERSION" \
  --tag "$REGISTRY/$IMAGE:latest" \
  --push \
  .
