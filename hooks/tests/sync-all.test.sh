#!/usr/bin/env bash
# sync-all.test.sh — contract for scripts/sync-all.sh + scripts/sync-manifest.json.
#
# Covers: real-manifest schema validity; --list; --check green on the clean tree;
# a seeded failing ritual is caught (fixture); --changed trigger + tier filtering
# (scratch git repo so the staged set is deterministic); unknown --only id fails loud;
# a malformed manifest fails with a usage error.
. "$(dirname "$0")/lib.sh"

SYNC_ALL="$REPO_ROOT/scripts/sync-all.sh"

# ── field <json> <key> : print d[key] (arrays comma-joined; failures→ids) ──
field() {
  printf '%s' "$1" | node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const k = process.argv[1];
    let v = k === "failures" ? (d.failures || []).map(x => x.id) : d[k];
    process.stdout.write(Array.isArray(v) ? v.join(",") : String(v));
  ' "$2"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Real manifest is schema-valid: schema int, rituals[] non-empty, per-row
#    id/check/tier/trigger, unique ids, tier enum.
# ─────────────────────────────────────────────────────────────────────────────
SCHEMA_ERR=$(node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const errs = [];
  if (typeof m.schema !== "number") errs.push("schema not a number");
  if (!Array.isArray(m.rituals) || m.rituals.length === 0) errs.push("rituals not a non-empty array");
  const ids = new Set();
  const tiers = new Set(["pre-commit", "preflight", "both"]);
  for (const r of (m.rituals || [])) {
    if (!r.id) errs.push("row missing id");
    if (ids.has(r.id)) errs.push("duplicate id: " + r.id);
    ids.add(r.id);
    if (typeof r.check !== "string" || !r.check) errs.push(r.id + ": check must be a non-empty string");
    if (!tiers.has(r.tier)) errs.push(r.id + ": bad tier " + r.tier);
    if (!Array.isArray(r.trigger)) errs.push(r.id + ": trigger must be an array");
    if ("generator" in r && r.generator !== null && typeof r.generator !== "string") errs.push(r.id + ": generator must be string|null");
  }
  process.stdout.write(errs.join("; "));
' "$REPO_ROOT/scripts/sync-manifest.json")
assert_eq "$SCHEMA_ERR" "" "real manifest is schema-valid"

# 2. --list prints the registered ids (sync-version + the new ones present)
LIST=$(bash "$SYNC_ALL" --list 2>/dev/null)
assert_contains "$LIST" "sync-version" "--list includes sync-version"
assert_contains "$LIST" "sync-opencode-plugin" "--list includes the newly-wired sync-opencode-plugin"
assert_contains "$LIST" "check-claude-md-inventory" "--list includes the new membership check"

# 3. --check is green on the clean (synced) tree
OUT=$(bash "$SYNC_ALL" --check 2>/dev/null); RC=$?
assert_exit_code "$RC" "0" "--check exit 0 on clean tree"
assert_eq "$(field "$OUT" ok)" "true" "--check ok:true on clean tree"

# 4. unknown --only id fails loudly (exit 1, named in unknown_only)
OUT=$(bash "$SYNC_ALL" --check --only no-such-ritual 2>/dev/null); RC=$?
assert_exit_code "$RC" "1" "--only unknown id exits 1"
assert_contains "$(field "$OUT" unknown_only)" "no-such-ritual" "unknown_only names the bad id"

# 5. malformed manifest (no rituals[]) → usage error exit 2
echo '{"schema":1}' > "$TEST_TMP/bad-manifest.json"
bash "$SYNC_ALL" --check --manifest "$TEST_TMP/bad-manifest.json" >/dev/null 2>&1; RC=$?
assert_exit_code "$RC" "2" "manifest without rituals[] → exit 2"

# ─────────────────────────────────────────────────────────────────────────────
# 6. Fixture scratch repo: deterministic --changed trigger + tier filtering and
#    a seeded failing ritual. sync-all resolves its repo root as $(dirname $0)/..
#    so we build a mini-repo whose scripts/ holds a copy of sync-all + json-emit +
#    a fixture manifest, then stage files in it and assert what ran.
# ─────────────────────────────────────────────────────────────────────────────
SCRATCH="$TEST_TMP/scratch"
mkdir -p "$SCRATCH/scripts/lib" "$SCRATCH/foo"
cp "$SYNC_ALL" "$SCRATCH/scripts/sync-all.sh"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$SCRATCH/scripts/lib/json-emit.sh"
cat > "$SCRATCH/scripts/fixture-manifest.json" <<'JSON'
{
  "schema": 1,
  "rituals": [
    { "id": "always",         "generator": null, "check": "true",  "fix": "n/a",    "tier": "both",      "trigger": [] },
    { "id": "on-foo",         "generator": null, "check": "true",  "fix": "n/a",    "tier": "both",      "trigger": ["foo/"] },
    { "id": "on-bar",         "generator": null, "check": "true",  "fix": "n/a",    "tier": "both",      "trigger": ["bar.txt"] },
    { "id": "preflight-only", "generator": null, "check": "true",  "fix": "n/a",    "tier": "preflight", "trigger": [] },
    { "id": "boom",           "generator": null, "check": "false", "fix": "fix-me", "tier": "both",      "trigger": ["boom.txt"] }
  ]
}
JSON
FM="scripts/fixture-manifest.json"

(
  cd "$SCRATCH"
  git init -q
  git config user.email t@t; git config user.name t
) >/dev/null 2>&1

run_scratch() { ( cd "$SCRATCH" && bash scripts/sync-all.sh --manifest "$FM" "$@" ) 2>/dev/null; }

# 6a. Stage foo/x only → always + on-foo run; on-bar (no trigger) + preflight-only (tier) skipped
( cd "$SCRATCH" && : > foo/x && git add foo/x ) >/dev/null 2>&1
OUT=$(run_scratch --check --changed); RC=$?
RAN=",$(field "$OUT" ran),"
assert_exit_code "$RC" "0" "changed foo/ → exit 0"
assert_contains "$RAN" ",always," "empty-trigger ritual always runs"
assert_contains "$RAN" ",on-foo," "foo/ trigger fires on staged foo/x"
assert_not_contains "$RAN" ",on-bar," "bar.txt trigger does NOT fire"
assert_not_contains "$RAN" ",preflight-only," "preflight-tier ritual skipped in --changed mode"

# 6b. Stage bar.txt → on-bar fires, on-foo does not
( cd "$SCRATCH" && git rm -q --cached foo/x >/dev/null 2>&1; : > bar.txt && git add bar.txt ) >/dev/null 2>&1
OUT=$(run_scratch --check --changed)
RAN=",$(field "$OUT" ran),"
assert_contains "$RAN" ",on-bar," "bar.txt trigger fires when bar.txt staged"
assert_not_contains "$RAN" ",on-foo," "foo/ trigger does not fire for bar.txt"

# 6c. Stage boom.txt → boom check=false ⇒ exit 1, failures names boom + its fix
( cd "$SCRATCH" && git rm -q --cached bar.txt >/dev/null 2>&1; : > boom.txt && git add boom.txt ) >/dev/null 2>&1
OUT=$(run_scratch --check --changed); RC=$?
assert_exit_code "$RC" "1" "a failing triggered ritual → exit 1"
assert_eq "$(field "$OUT" ok)" "false" "ok:false when a ritual fails"
assert_contains "$(field "$OUT" failures)" "boom" "failures names the failing ritual id"
assert_contains "$OUT" "fix-me" "summary carries the failing ritual's fix command"

# 6d. Full --check (no --changed) ignores triggers AND tier: preflight-only runs
OUT=$(run_scratch --check)
RAN=",$(field "$OUT" ran),"
assert_contains "$RAN" ",preflight-only," "full --check runs preflight-tier rituals"
assert_contains "$RAN" ",boom," "full --check ignores triggers (boom runs without boom.txt staged)"

finalize_test
