#!/usr/bin/env bash
# P7b — plugin load-source fact: scripts/lib/load-source.js (detector, shared with dev-setup.sh --check) and the
# watcher publisher src/status/load-source.js (<live>/load-source.json). Temp CLAUDE_DIR throughout; no real ~/.claude.
. "$(dirname "$0")/lib.sh"

LIB="$REPO_ROOT/scripts/lib/load-source.js"
PUB="$REPO_ROOT/src/status/load-source.js"

jget() { # '<js over j>' < json
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=eval(process.argv[1]);process.stdout.write(typeof r==="string"?r:JSON.stringify(r));})' "$1"
}

mk_claude() { # <dir> <marketplace-json-source>
  local d="$1"
  mkdir -p "$d/plugins/cache/autopilot/autopilot"
  printf '{"autopilot":{"source":%s}}\n' "$2" > "$d/plugins/known_marketplaces.json"
}

# a minimal "repo" (the plugin tree the dev symlink must point at)
REPO="$TEST_TMP/repo"
mkdir -p "$REPO/.claude-plugin"
printf '{"name":"autopilot","version":"9.8.7"}\n' > "$REPO/.claude-plugin/plugin.json"

# a live pid that is not ours and not the shell's
sleep 600 &
LIVE_PID=$!
trap 'kill $LIVE_PID 2>/dev/null' EXIT

# --- 1. real dev symlink, directory marketplace, no semver dir -> dev
C1="$TEST_TMP/c1"
mk_claude "$C1" "{\"source\":\"directory\",\"path\":\"$REPO\"}"
ln -s "$REPO" "$C1/plugins/cache/autopilot/autopilot/dev"
OUT="$(node "$LIB" detect --claude-dir "$C1" --repo-dir "$REPO")"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source')" "dev" "dev symlink + directory marketplace -> source dev"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source_basis')" "dev_link" "dev source basis is the dev link"
assert_eq "$(printf '%s' "$OUT" | jget 'j.plugin_version')" "9.8.7" "plugin_version comes from .claude-plugin/plugin.json"
assert_eq "$(printf '%s' "$OUT" | jget 'j.marketplace')" "directory" "marketplace kind directory"
assert_eq "$(printf '%s' "$OUT" | jget 'j.flags')" "[]" "a clean dev setup carries no flags"
assert_eq "$(printf '%s' "$OUT" | jget 'j.behind_upstream')" "null" "no upstream -> behind_upstream null"

# --- 2. planted semver cache dir in use by a live pid -> cache:<semver>
C2="$TEST_TMP/c2"
mk_claude "$C2" "{\"source\":\"directory\",\"path\":\"$REPO\"}"
ln -s "$REPO" "$C2/plugins/cache/autopilot/autopilot/dev"
SEMVER_DIR="$C2/plugins/cache/autopilot/autopilot/2.36.36"
mkdir -p "$SEMVER_DIR/.in_use"
: > "$SEMVER_DIR/.in_use/$LIVE_PID"
: > "$SEMVER_DIR/.in_use/999999999"
OUT="$(node "$LIB" detect --claude-dir "$C2" --repo-dir "$REPO")"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source')" "cache:2.36.36" "semver dir with a live in_use pid -> cache:<semver>"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source_basis')" "any_alive_pid" "no session pid -> conservative any-alive-pid basis"
assert_eq "$(printf '%s' "$OUT" | jget 'j.stale_cache_dirs[0].alive')" "[\"$LIVE_PID\"]" "alive lists only the live pid"
assert_eq "$(printf '%s' "$OUT" | jget 'j.stale_cache_dirs[0].in_use_pids.length')" "2" "in_use_pids lists both entries"
assert_contains "$(printf '%s' "$OUT" | jget 'j.flags')" "loaded_from_cache" "cache load is flagged"
OUT="$(node "$LIB" detect --claude-dir "$C2" --repo-dir "$REPO" --session-pid "$LIVE_PID")"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source')" "cache:2.36.36" "session pid listed in .in_use -> that cache copy"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source_basis')" "session_pid" "session pid basis"
OUT="$(node "$LIB" detect --claude-dir "$C2" --repo-dir "$REPO" --session-pid 424242)"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source')" "dev" "session pid in no cache dir + sound dev link -> dev"
# a dead-only semver dir is stale residue, not the loaded copy
rm -f "$SEMVER_DIR/.in_use/$LIVE_PID"
OUT="$(node "$LIB" detect --claude-dir "$C2" --repo-dir "$REPO")"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source')" "dev" "only dead pids listed -> dev (dir still listed as stale)"
assert_contains "$(printf '%s' "$OUT" | jget 'j.flags')" "stale_cache_dirs" "dead-pid semver dir is flagged as stale residue"

# --- 3. github marketplace -> flagged
C3="$TEST_TMP/c3"
mk_claude "$C3" '{"source":"github","repo":"cookys/autopilot"}'
ln -s "$REPO" "$C3/plugins/cache/autopilot/autopilot/dev"
OUT="$(node "$LIB" detect --claude-dir "$C3" --repo-dir "$REPO")"
assert_eq "$(printf '%s' "$OUT" | jget 'j.marketplace')" "github" "marketplace kind github"
assert_contains "$(printf '%s' "$OUT" | jget 'j.flags')" "marketplace_not_directory" "github marketplace is flagged"
assert_eq "$(printf '%s' "$OUT" | jget 'j.marketplace_is_dev')" "false" "github marketplace is not the dev marketplace"

# --- 4. missing everything -> unknown
C4="$TEST_TMP/c4"
mkdir -p "$C4"
OUT="$(node "$LIB" detect --claude-dir "$C4" --repo-dir "$REPO")"
assert_eq "$(printf '%s' "$OUT" | jget 'j.source')" "unknown" "no dev link and no live cache pid -> unknown"
assert_eq "$(printf '%s' "$OUT" | jget 'j.marketplace')" "missing" "no known_marketplaces.json -> marketplace missing"

# --- 5. behind_upstream from local refs
BARE="$TEST_TMP/origin.git"; A="$TEST_TMP/clone-a"; B="$TEST_TMP/clone-b"
git init -q --bare "$BARE"
git clone -q "$BARE" "$A" 2>/dev/null
git -C "$A" -c user.name=t -c user.email=t@t commit -q --allow-empty -m one
git -C "$A" branch -q -M main
git -C "$A" push -q -u origin main 2>/dev/null
git clone -q -b main "$BARE" "$B" 2>/dev/null
for n in 2 3 4; do git -C "$B" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "c$n"; done
git -C "$B" push -q origin main 2>/dev/null
git -C "$A" fetch -q origin
BEHIND="$(node -e 'console.log(require(process.argv[1]).behindUpstreamOf(process.argv[2]))' "$LIB" "$A")"
assert_eq "$BEHIND" "3" "behindUpstreamOf counts commits behind the upstream from local refs"
BEHIND="$(node -e 'console.log(require(process.argv[1]).behindUpstreamOf(process.argv[2]))' "$LIB" "$TEST_TMP")"
assert_eq "$BEHIND" "null" "not a repo -> behind_upstream null"

# --- 6. the watcher publisher: file path, schema, throttle
LIVE="$TEST_TMP/live"
mkdir -p "$LIVE"
RES="$(CLAUDE_CONFIG_DIR="$C2" node -e '
const fs = require("fs");
const { createLoadSourcePublisher, CHECK_S } = require(process.argv[1]);
const writes = [];
const p = createLoadSourcePublisher({ live: process.argv[2], env: process.env, repoDir: process.argv[3],
  writeAtomic: (f, t) => { writes.push(f); fs.writeFileSync(f, t); } });
const t0 = Date.parse("2026-10-06T10:00:00Z");
const a = p.publish({ nowMs: t0 });
const b = p.publish({ nowMs: t0 + 5000 });
const c = p.publish({ nowMs: t0 + (CHECK_S + 1) * 1000 });
const d = p.publish({ nowMs: t0 + 70000 });
const j = JSON.parse(fs.readFileSync(p.file, "utf8"));
console.log(JSON.stringify({ a, b, c, d, n: writes.length, schema: j.schema, checked_at: j.checked_at, source: j.source, file: p.file }));
' "$PUB" "$LIVE" "$REPO")"
assert_eq "$(printf '%s' "$RES" | jget 'j.a')" "true" "publisher: first tick writes"
assert_eq "$(printf '%s' "$RES" | jget 'j.b')" "false" "publisher: a tick inside CHECK_S does not re-detect"
assert_eq "$(printf '%s' "$RES" | jget 'j.c')" "false" "publisher: unchanged fact is not rewritten inside REWRITE_S"
assert_eq "$(printf '%s' "$RES" | jget 'j.d')" "true" "publisher: unchanged fact is refreshed after REWRITE_S"
assert_eq "$(printf '%s' "$RES" | jget 'j.schema')" "autopilot.load-source/1" "publisher: schema"
assert_eq "$(printf '%s' "$RES" | jget 'j.file')" "$LIVE/load-source.json" "publisher: path is <live>/load-source.json"
assert_eq "$(printf '%s' "$RES" | jget 'j.source')" "dev" "publisher: reads CLAUDE_CONFIG_DIR (no live cache pid left -> dev)"

# the watcher actually calls it (a publisher that nothing invokes is dead code)
assert_contains "$(cat "$REPO_ROOT/src/status/runs-watch.js")" "loadSourceSidecar.publish" "runs-watch invokes the load-source publisher"
assert_contains "$(cat "$REPO_ROOT/src/status/code-fingerprint.js")" "scripts/lib/load-source.js" "the watcher's code fingerprint covers the detector"

finalize_test
