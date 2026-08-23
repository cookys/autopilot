#!/usr/bin/env bash
# Derive the repo from THIS FILE's location. The original hardcoded the
# ephemeral agent worktree it was authored in — which reap-dispatch-worktrees.sh
# deletes, making the evidence non-rerunnable the moment the run was cleaned up.
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$W" || exit 1
R=687f9e56~1..687f9e56
echo "### Real historical range: $R"
echo "    files touched: $(git diff --name-only $R | wc -l), of which *.test.sh: $(git diff --name-only $R | grep -c '\.test\.sh$')"
echo ""
echo "--- BEFORE: base commit has no .claude/test-integrity-config.md -> template globs"
bash scripts/check-test-integrity.sh validate --no-l1 --range "$R" 2>&1 \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("    source=%s  test_paths_matched=%s  violations=%d  ok=%s  warning=%s"%(d["source"],d["test_paths_matched"],len(d["violations"]),d["ok"],d.get("warning")))'
echo ""
echo "--- AFTER: same range, the new config supplied via --allow-env-config"
export TEST_INTEGRITY_CONFIG_OVERRIDE="$W/.claude/test-integrity-config.md"
bash scripts/check-test-integrity.sh validate --no-l1 --allow-env-config --range "$R" 2>&1 \
  | python3 -c '
import json,sys,collections
d=json.load(sys.stdin)
k=collections.Counter(v["kind"] for v in d["violations"])
print("    source=%s  test_paths_matched=%s  violations=%d  ok=%s"%(d["source"],d["test_paths_matched"],len(d["violations"]),d["ok"]))
print("    kinds: %s"%dict(k))
print("    surface_touches: %s"%d["surface_touches"][:6])
files=sorted({v["file"] for v in d["violations"]})
print("    files carrying violations (%d): %s"%(len(files), files[:8]))
'
unset TEST_INTEGRITY_CONFIG_OVERRIDE
echo ""
# Pin the ship's own range by SHA, not by `HEAD`: after merge, `HEAD` stops
# meaning this commit and the demonstration silently changes subject.
SHIP_RANGE="${SHIP_RANGE:-87b5fead..400c857f}"
echo "### This ship's own range ($SHIP_RANGE) — expected to self-trip protected_path_touch"
bash scripts/check-test-integrity.sh validate --no-l1 --range "$SHIP_RANGE" 2>&1 \
  | python3 -c '
import json,sys,collections
d=json.load(sys.stdin)
k=collections.Counter(v["kind"] for v in d["violations"])
print("    source=%s  test_paths_matched=%s  ok=%s  kinds=%s"%(d["source"],d["test_paths_matched"],d["ok"],dict(k)))
for v in d["violations"]:
    if v["kind"]=="protected_path_touch": print("      protected:",v["file"])
'
