#!/usr/bin/env bash
# Writes review_ledger_archive.dir under the scratch HOME this cell already uses.
# $1 is that HOME. Nothing outside it is created.
set -euo pipefail
home="$1"
arch="$home/review-ledger-archive"
mkdir -p "$home/.autopilot" "$arch"
node -e '
  const fs = require("fs");
  const path = require("path");
  const home = process.argv[1];
  const dir = process.argv[2];
  fs.writeFileSync(path.join(home, ".autopilot", "config.json"), JSON.stringify({
    review_ledger_archive: { dir }
  }, null, 2) + "\n");
' "$home" "$arch"
