#!/usr/bin/env bash
# Calibrate by running the REAL gate, not by re-typing its regexes.
# Every line of every tracked *.test.sh is presented to the engine as an ADDED
# line (files are created fresh in a throwaway repo), so this measures exactly
# what the skip detector would fire on if that line were newly written.
set -uo pipefail
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FIX="$(mktemp -d "${TMPDIR:-/tmp}/skip-recal.XXXXXX")"
trap 'rm -rf "$FIX"' EXIT

mkdir -p "$FIX/.claude"
git -C "$FIX" init -q
git -C "$FIX" config user.email r@e.invalid; git -C "$FIX" config user.name r
printf "## Mode\nmode: warn\n\n## Test Paths\n- '**/*.test.sh'\n" > "$FIX/.claude/test-integrity-config.md"
git -C "$FIX" add -A; git -C "$FIX" commit -qm base

n=0
while IFS= read -r rel; do
  mkdir -p "$FIX/$(dirname "$rel")"
  cp "$W/$rel" "$FIX/$rel"
  n=$((n+1))
done < <(git -C "$W" ls-files '*.test.sh')
git -C "$FIX" add -A; git -C "$FIX" commit -qm "every suite as added lines"

echo "suites presented as pure additions: $n"
bash "$W/scripts/check-test-integrity.sh" validate --no-l1 --range HEAD~1..HEAD --repo "$FIX" \
 | python3 -c '
import json,sys,collections
d=json.load(sys.stdin)
k=collections.Counter(v["kind"] for v in d["violations"])
print("test_paths_matched:", d["test_paths_matched"])
print("violation kinds:", dict(k))
for v in d["violations"]:
    if v["kind"]=="skip_marker":
        print("  skip_marker %s:%s  %s" % (v["file"], v["line"], v["detail"][:90]))
'
