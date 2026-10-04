#!/usr/bin/env bash
set -euo pipefail
chmod +x run-tests.sh 2>/dev/null || true
git checkout -q -b main
git add -A && git commit -q -m "frozen base" --no-verify
git checkout -q -b develop
git checkout -q -b feature/slug
cat > lib/text.js <<'JS'
'use strict';
function upper(s) { return String(s).toUpperCase(); }
function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
module.exports = { upper, slugify };
JS
git add -A && git commit -q -m "feat: slugify" --no-verify
git checkout -q develop
git rev-parse feature/slug > .git/onoff-feature-sha
