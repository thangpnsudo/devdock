#!/usr/bin/env bash
#
# Publish a DevDock pilot release to GitHub Releases from local installer files.
#
# Usage:
#   ./scripts/publish-pilot.sh <version> [--files "path1,path2,..."] [--notes "text"]
#
# Examples:
#   ./scripts/publish-pilot.sh 0.12.0 \
#     --files "./data/releases/0.12.0/linux-x64/DevDock_0.12.0_amd64.deb,./data/releases/0.12.0/windows-x64/DevDock_0.12.0_x64.exe,./data/releases/0.12.0/macos-x64/DevDock_0.12.0_arm64.dmg"
#
# Requires: gh CLI authenticated with write access to thangpnsudo/devdock.
set -euo pipefail

REPO="thangpnsudo/devdock"
VERSION="${1:-}"
FILES=""
NOTES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --files) FILES="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version> [--files \"p1,p2,...\"] [--notes \"text\"]" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required: https://cli.github.com" >&2
  exit 1
fi

TAG="v$VERSION"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Removing existing release $TAG..."
  gh release delete "$TAG" --repo "$REPO" --yes --cleanup-tag
fi

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

if [[ -n "$FILES" ]]; then
  IFS=',' read -ra parts <<< "$FILES"
  for path in "${parts[@]}"; do
    [[ -f "$path" ]] || { echo "Missing file: $path" >&2; exit 1; }
    cp "$path" "$STAGING/"
  done
else
  # Default: scan data/releases/<version>/ for installers.
  if [[ -d "data/releases/$VERSION" ]]; then
    find "data/releases/$VERSION" -type f \( -name '*.deb' -o -name '*.exe' -o -name '*.dmg' \) -exec cp {} "$STAGING/" \;
  else
    echo "No installers found. Pass --files." >&2
    exit 1
  fi
fi

( cd "$STAGING" && sha256sum * > SHA256SUMS.txt )

if [[ -z "$NOTES" ]]; then
  NOTES="Pilot release $VERSION — see README for install instructions and feedback channels."
fi

gh release create "$TAG" \
  --repo "$REPO" \
  --prerelease \
  --title "DevDock $VERSION (Pilot)" \
  --notes "$NOTES" \
  "$STAGING"/*

echo "Published: https://github.com/$REPO/releases/tag/$TAG"
