#!/usr/bin/env bash
set -euo pipefail
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
