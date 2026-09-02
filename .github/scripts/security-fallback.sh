#!/usr/bin/env bash
set -euo pipefail

# Private personal repositories cannot assume GitHub Secret Protection or code
# scanning is available. These checks are ordinary required-job steps instead.
npm audit --audit-level=high
npm --prefix club audit --audit-level=high

gitleaks_version=8.30.1
case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    gitleaks_asset=linux_x64
    gitleaks_sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    ;;
  Darwin:arm64)
    gitleaks_asset=darwin_arm64
    gitleaks_sha256=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5
    ;;
  *)
    echo "no pinned Gitleaks asset for $(uname -s) $(uname -m)" >&2
    exit 2
    ;;
esac
security_tmp=$(mktemp -d)
trap 'rm -rf -- "$security_tmp"' EXIT
archive="$security_tmp/gitleaks.tar.gz"

curl --proto '=https' -fsSL --retry 3 \
  -o "$archive" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/gitleaks_${gitleaks_version}_${gitleaks_asset}.tar.gz"
printf '%s  %s\n' "$gitleaks_sha256" "$archive" | sha256sum -c -
tar -xzf "$archive" -C "$security_tmp" gitleaks
"$security_tmp/gitleaks" git --no-banner --redact \
  --config .github/gitleaks.toml .
