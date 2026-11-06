#!/usr/bin/env bash
set -euo pipefail

expected_version="$(node -p "require('./package.json').version")"
actual_version="$(node dist/cli.js --version)"

if [[ "$actual_version" != "$expected_version" ]]; then
  echo "CLI version mismatch: expected $expected_version, got $actual_version" >&2
  exit 1
fi

node dist/cli.js --help >/dev/null
echo "CLI smoke checks passed ($actual_version)"
