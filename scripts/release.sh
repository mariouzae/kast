#!/usr/bin/env bash
# Build, tag and push Kast Docker images to Docker Hub.
#
# Usage:
#   scripts/release.sh                # server + dashboard
#   scripts/release.sh server         # server only
#   scripts/release.sh dashboard      # dashboard only
#
# Tags pushed:  <short-sha>  and  latest
#   With uncommitted changes the tag becomes <short-sha>-dirty and `latest`
#   is NOT moved, so the VPS never pulls an unreproducible build by accident.
#   Set ALLOW_DIRTY_LATEST=true to override.
#
# Env:
#   REGISTRY   Docker Hub namespace      (default: mariouzae)
#   PLATFORMS  target platform(s)        (default: linux/amd64 — typical VPS)
#              e.g. PLATFORMS=linux/amd64,linux/arm64 for multi-arch
#   BUILDER    buildx builder name       (default: kast-multi, created if missing)
set -euo pipefail

cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-mariouzae}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
BUILDER="${BUILDER:-kast-multi}"
TARGET="${1:-all}"

case "$TARGET" in
  all)       COMPONENTS=(server dashboard) ;;
  server)    COMPONENTS=(server) ;;
  dashboard) COMPONENTS=(dashboard) ;;
  *) echo "usage: $0 [all|server|dashboard]" >&2; exit 1 ;;
esac

COMMIT="$(git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TAG="$COMMIT"
PUSH_LATEST=true
if [ -n "$(git status --porcelain)" ]; then
  TAG="$COMMIT-dirty"
  if [ "${ALLOW_DIRTY_LATEST:-false}" != "true" ]; then
    PUSH_LATEST=false
  fi
  echo "⚠  Uncommitted changes — tagging as $TAG$([ "$PUSH_LATEST" = false ] && echo ', not updating latest')"
fi

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "→ creating buildx builder $BUILDER"
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi

for c in "${COMPONENTS[@]}"; do
  IMAGE="$REGISTRY/kast-$c"
  TAGS=(-t "$IMAGE:$TAG")
  [ "$PUSH_LATEST" = true ] && TAGS+=(-t "$IMAGE:latest")

  echo "→ building $IMAGE:$TAG for $PLATFORMS"
  docker buildx build \
    --builder "$BUILDER" \
    --platform "$PLATFORMS" \
    --build-arg VERSION="$TAG" \
    --build-arg GIT_COMMIT="$COMMIT" \
    --build-arg BUILD_TIME="$BUILD_TIME" \
    "${TAGS[@]}" \
    --push \
    "./$c"
  echo "✓ pushed $IMAGE:$TAG$([ "$PUSH_LATEST" = true ] && echo " + latest")"
done

echo
echo "Deploy on the VPS:"
echo "  KAST_TAG=$TAG   # set in .env to pin this build (or leave unset for latest)"
echo "  docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d"
