#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/docs" "$fixture/scripts"
printf '%s\n' '# Fixture' '' 'Run `scripts/exists.py`.' >"$fixture/docs/README.md"
printf '%s\n' '#!/usr/bin/env python3' >"$fixture/scripts/exists.py"

(
  cd "$fixture"
  node "$script_dir/doc-drift-gate.js" docs >/dev/null
)

# An explicit repository root must also work when invoked outside that repo.
node "$script_dir/doc-drift-gate.js" "$fixture/docs" --repo-root "$fixture" >/dev/null

printf '%s\n' 'test-doc-drift-gate: PASS'
