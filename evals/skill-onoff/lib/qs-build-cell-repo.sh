#!/usr/bin/env bash
# qs-build-cell-repo.sh <task-id> <dest-dir> — builds a qs fixture repo the way run-skill-onoff-eval.sh does (task repo/, then the
# frozen fixture_scripts packs in order, then init-repo.sh). Used by check-qs-answers.js only; the runner does not call it.
set -euo pipefail
B="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$B/tasks/$1"; D="$2"; mkdir -p "$D"
cp -r "$T/repo"/. "$D"/
for p in fixture-scripts-qs fixture-config-qs; do cp -r "$B/packs/$p"/. "$D"/; done
( cd "$D" && git init -q && git config user.name e && git config user.email e@e && git config commit.gpgsign false && bash "$T/init-repo.sh" )
