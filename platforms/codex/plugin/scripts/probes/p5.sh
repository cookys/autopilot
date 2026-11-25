#!/usr/bin/env bash
# P5 live reverse probe: verify finish-triage.js rejects a synthetic broken task
# (missing Used/Pinned) and accepts a valid stubbed task.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$REPO_ROOT/scripts/tests/finish-triage.test.sh"
