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

# --- nested-worktree skip: a broken scripts/... ref inside a nested git worktree
# (e.g. a live .claude/worktrees/agent-* background-agent checkout) must NOT flag
# the gate red — its docs resolve against a different repo root.
mkdir -p "$fixture/.claude/worktrees/agent-fake/docs" "$fixture/.claude/worktrees/agent-fake/scripts"
printf '%s\n' '.' >"$fixture/.claude/worktrees/agent-fake/.git" # linked-worktree gitdir file
printf '%s\n' '# Nested' '' 'Run `scripts/does-not-exist.sh`.' \
  >"$fixture/.claude/worktrees/agent-fake/docs/CHANGELOG.md"

if ! node "$script_dir/doc-drift-gate.js" "$fixture" --repo-root "$fixture" >/dev/null; then
  echo "test-doc-drift-gate: FAIL — nested worktree broken ref should have been skipped" >&2
  exit 1
fi

# Control: the SAME broken ref placed OUTSIDE the nested worktree (a real doc in the
# scanned repo) must still turn the gate red — the skip must not eat real drift.
mkdir -p "$fixture/docs2"
printf '%s\n' '# Real' '' 'Run `scripts/does-not-exist.sh`.' >"$fixture/docs2/broken.md"

if node "$script_dir/doc-drift-gate.js" "$fixture/docs2" --repo-root "$fixture" >/dev/null; then
  echo "test-doc-drift-gate: FAIL — real broken ref outside nested dir should still fail the gate" >&2
  exit 1
fi
rm -rf "$fixture/docs2"

# --- general rule (not just the .claude/worktrees fast path): ANY nested dir that
# carries its own .git is skipped, regardless of location.
mkdir -p "$fixture/vendor/subrepo/docs"
printf '%s\n' '.' >"$fixture/vendor/subrepo/.git"
printf '%s\n' '# Vendored' '' 'Run `scripts/does-not-exist.sh`.' \
  >"$fixture/vendor/subrepo/docs/README.md"

if ! node "$script_dir/doc-drift-gate.js" "$fixture/vendor" --repo-root "$fixture" >/dev/null; then
  echo "test-doc-drift-gate: FAIL — nested git root outside .claude/worktrees should have been skipped" >&2
  exit 1
fi
rm -rf "$fixture/vendor"

printf '%s\n' 'test-doc-drift-gate: PASS'
