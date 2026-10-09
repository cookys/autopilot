#!/usr/bin/env bash
# g7-close fixture: the close-out state. A finished change was merged into develop with a normal merge commit,
# the feature branch is gone, the tree is clean, HEAD = develop = frozen base. No dispatch branch, no ledger, no
# worktree exists: the dispatch-branch close-out has nothing to act on, which is exactly what "unconditionally" means.
set -euo pipefail
chmod +x run-tests.sh 2>/dev/null || true
git checkout -q -b develop
git add -A && git commit -q -m "base" --no-verify
git checkout -q -b feature/greet
mkdir -p docs/projects/greet
printf '# greet\n\nStatus: implementation complete.\n' > docs/projects/greet/STATUS.md
git add -A && git commit -q -m "feat: greeting complete" --no-verify
git checkout -q develop
printf 'notes\n' > NOTES.md
git add -A && git commit -q -m "chore: notes" --no-verify
git merge -q --no-ff feature/greet -m "merge feature/greet" --no-verify
git branch -q -d feature/greet
