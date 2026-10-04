#!/usr/bin/env bash
# develop diverged from the feature base (so a merge makes a NEW commit); HEAD = feature tip = frozen base.
set -euo pipefail
chmod +x run-tests.sh 2>/dev/null || true
git checkout -q -b develop
git add -A && git commit -q -m "base" --no-verify
git checkout -q -b feature/greet
printf '# greet\n\nStatus: implementation complete.\n' > docs/projects/greet/STATUS.md
git add -A && git commit -q -m "feat: greeting complete" --no-verify
git rev-parse HEAD > .git/onoff-feature-sha
git checkout -q develop
printf 'notes\n' > NOTES.md
git add -A && git commit -q -m "chore: notes" --no-verify
git checkout -q feature/greet
