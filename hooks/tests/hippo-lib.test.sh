#!/usr/bin/env bash
# hooks/tests/hippo-lib.test.sh - scripts/lib/hippo.js against the REAL hippo binary (plan 2026-11-02-oc-a3-writers-use-hippo,
# A3.1 step 1): the four store states, the plugin-dir refusal, the write spool and its flush (lock, worktree/branch filter),
# the idempotent step runner under fault injection, the leak_ok / refusal contract, flush in state `files`.
# Needs HIPPO_BIN (path to a hippo >= 0.2.2); prints SKIPPED and exits 0 without it. Every repo is a temp repo under a sandbox
# HOME (hooks/tests/lib/hippo-sandbox.sh, C6). Red-checks: docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/a3.1-lib/.
. "$(dirname "$0")/lib.sh"
if [ -z "${HIPPO_BIN:-}" ]; then echo "SKIPPED: HIPPO_BIN unset"; exit 0; fi
HIPPO_BIN="$(command -v "$HIPPO_BIN")" || fail "HIPPO_BIN is not executable"
export HIPPO_BIN
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup

LIB="$REPO_ROOT/scripts/lib/hippo.js"
DRV="$REPO_ROOT/hooks/tests/lib/hippo-lib-driver.js"
H() { "$HIPPO_BIN" --json -C "$1" "${@:2}"; }
jf() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const v=eval(process.argv[1]); console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
detect_json() { node "$LIB" detect --target "$1" --json; }
spool_dir() { echo "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/autopilot/hippo-spool"; }
spool_count() { find "$(spool_dir "$1")" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
key_count() { H "$1" list --tag "key:$2" --history | jf 'd.data.records.length'; }
key_id() { H "$1" list --tag "key:$2" --history | jf 'd.data.records[0].id'; }
eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
ULID_RE='^[0-9A-Z]{26}$'

# --- C6 pre-flight negative control: the check itself must go red on an outside hooksPath, and pass on an inside one
R_PF="$(hs_mkrepo preflight)"
if GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/nonexistent-outside-hooks hs_preflight "$R_PF" 2>/dev/null; then
  fail "pre-flight accepted a core.hooksPath outside the temp tree"
else eq 1 1 "pre-flight rejects an outside core.hooksPath"; fi
if GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$TEST_TMP/hooks" hs_preflight "$R_PF" 2>/dev/null; then
  eq 1 1 "pre-flight accepts a core.hooksPath inside the temp tree"
else fail "pre-flight rejected an inside core.hooksPath"; fi

# --- detect: the four states
R_FILES="$(hs_mkrepo files)"
D="$(detect_json "$R_FILES")"
eq files "$(echo "$D" | jf d.state)" "detect: no .hippo/repo.toml -> files"
eq "$(cd "$R_FILES" && pwd -P)" "$(echo "$D" | jf d.repo_root)" "detect: repo_root is the git toplevel"

R_HIP="$(hs_mkrepo hippo store)"
D="$(detect_json "$R_HIP")"
eq hippo "$(echo "$D" | jf d.state)" "detect: store + check exit 0 -> hippo"
eq hs-hippo "$(echo "$D" | jf d.store_id)" "detect: store_id from repo.toml"
assert_contains "$(echo "$D" | jf d.hippo_version)" "0." "detect: hippo_version parsed"
D="$(cd "$R_HIP/.hippo" && detect_json .)"
eq hippo "$(echo "$D" | jf d.state)" "detect: a subdirectory target resolves to the toplevel"

R_PROB="$(hs_mkrepo prob store)"
H "$R_PROB" new issue --title one --status open >/dev/null
BAD="$(hs_corrupt_record "$R_PROB")"
D="$(detect_json "$R_PROB")"
eq hippo-problems "$(echo "$D" | jf d.state)" "detect: store + check exit 3 -> hippo-problems"
assert_contains "$(echo "$D" | jf 'd.problems.join("\n")')" "problem: record-drift .hippo/records/$(basename "$BAD")" "detect: problems carry check's offending-file line"

D="$(HIPPO_BIN=/nonexistent/hippo detect_json "$R_HIP")"
eq spool "$(echo "$D" | jf d.state)" "detect: store + binary missing -> spool"
# exit 5 (environment) from `hippo check`: a stub binary stands in, since a real check needs no actor
STUB5="$HS_ROOT/hippo-exit5.sh"
cat > "$STUB5" <<'STUB'
#!/bin/sh
case "$1" in --version) echo "hippo 0.2.2 (stub)"; exit 0;; esac
echo '{"schema":"hippo/1","command":"check","ok":false,"data":null,"warnings":[],"error":{"code":"environment","rule":null,"message":"no actor: set HIPPO_ACTOR","file":null,"hint":null,"candidates":[]}}'
exit 5
STUB
chmod +x "$STUB5"
D="$(HIPPO_BIN="$STUB5" detect_json "$R_HIP")"
eq spool "$(echo "$D" | jf d.state)" "detect: store + hippo exit 5 -> spool"
assert_contains "$(echo "$D" | jf d.reason)" "no actor" "detect: spool reason names the exit-5 cause"

# --- plugin install directory refused (a temp copy of the module placed at <root>/scripts/lib, so <root> is its plugin root)
PLG="$TEST_TMP/plugin-copy"; mkdir -p "$PLG/scripts/lib"; cp "$LIB" "$PLG/scripts/lib/hippo.js"
git init -q "$PLG" && git -C "$PLG" add -A && git -C "$PLG" commit -q -m copy
node "$PLG/scripts/lib/hippo.js" detect --target "$PLG" >/dev/null 2>"$TEST_TMP/plg.err"; RC=$?
eq 2 "$RC" "detect: plugin install directory -> exit 2"
assert_contains "$(cat "$TEST_TMP/plg.err")" "plugin's own install directory" "detect: plugin-dir refusal names the reason"
node "$LIB" detect --target "$TEST_TMP" >/dev/null 2>&1; eq 2 "$?" "detect: not a git work tree -> exit 2"

# --- spool: two writes with hippo hidden -> 2 entries, flush with hippo -> 2 records, 0 entries
mkplan() { # mkplan <file> <key> <title> -> one-create plan
  printf '{"key":"%s","steps":[{"op":"create","ref":"root","kind":"issue","argv":["--title","%s","--status","open"],"body":"body of %s","key":"%s"}]}\n' "$2" "$3" "$3" "$2" > "$1"
}
R_SP="$(hs_mkrepo spool store)"
mkplan "$TEST_TMP/p1.json" aaaaaaaaaaaaaaa1 first; mkplan "$TEST_TMP/p2.json" aaaaaaaaaaaaaaa2 second
HIPPO_BIN=/nonexistent/hippo node "$DRV" spool "$R_SP" "$TEST_TMP/p1.json" backlog-new >/dev/null
HIPPO_BIN=/nonexistent/hippo node "$DRV" spool "$R_SP" "$TEST_TMP/p2.json" backlog-new >/dev/null
eq 2 "$(spool_count "$R_SP")" "spool: two writes with hippo hidden -> 2 spool files"
eq 0 "$(git -C "$R_SP" status --porcelain | grep -c hippo-spool)" "spool: entries are not in the work tree status (never committed)"
E="$(node "$DRV" list "$R_SP")"
eq "$(cd "$R_SP" && pwd -P)" "$(echo "$E" | jf 'd[0].worktree')" "spool: entry records the worktree toplevel"
eq "$(git -C "$R_SP" symbolic-ref --short HEAD)" "$(echo "$E" | jf 'd[0].branch')" "spool: entry records the branch"
HIPPO_BIN=/nonexistent/hippo node "$LIB" flush --target "$R_SP" 2>/dev/null; eq 5 "$?" "flush: hippo missing -> exit 5, nothing replayed"
eq 2 "$(spool_count "$R_SP")" "flush: entries kept while the store is degraded"
node "$LIB" flush --target "$R_SP" 2>/dev/null; eq 0 "$?" "flush: with hippo -> exit 0"
eq 1 "$(key_count "$R_SP" aaaaaaaaaaaaaaa1)" "flush: first entry became a record"
eq 1 "$(key_count "$R_SP" aaaaaaaaaaaaaaa2)" "flush: second entry became a record"
eq 0 "$(spool_count "$R_SP")" "flush: 0 spool files after the replay"
eq 0 "$(H "$R_SP" check | jf d.data.problems.length)" "flush: hippo check clean after the replay"

# --- two concurrent flushes -> exactly one record per entry (slow `new` makes an unlocked race deterministic)
R_CC="$(hs_mkrepo concurrent store)"
for n in 1 2 3; do mkplan "$TEST_TMP/c$n.json" "bbbbbbbbbbbbbbb$n" "conc$n"; HIPPO_BIN=/nonexistent/hippo node "$DRV" spool "$R_CC" "$TEST_TMP/c$n.json" backlog-new >/dev/null; done
SLOW="$(hs_slow_hippo)"
HIPPO_BIN="$SLOW" node "$LIB" flush --target "$R_CC" 2>/dev/null & P1=$!
HIPPO_BIN="$SLOW" node "$LIB" flush --target "$R_CC" 2>/dev/null & P2=$!
wait "$P1"; RC1=$?; wait "$P2"; RC2=$?
eq "0 0" "$RC1 $RC2" "concurrent flush: both exit 0"
for n in 1 2 3; do eq 1 "$(key_count "$R_CC" "bbbbbbbbbbbbbbb$n")" "concurrent flush: exactly one record for entry $n"; done
eq 0 "$(spool_count "$R_CC")" "concurrent flush: spool empty"

# --- stale lock (holder pid gone) is taken over
R_ST="$(hs_mkrepo stale store)"
mkplan "$TEST_TMP/s1.json" ccccccccccccccc1 stale1
HIPPO_BIN=/nonexistent/hippo node "$DRV" spool "$R_ST" "$TEST_TMP/s1.json" backlog-new >/dev/null
sh -c 'echo $$' > "$(spool_dir "$R_ST")/.lock"
node "$LIB" flush --target "$R_ST" 2>/dev/null; eq 0 "$?" "flush: stale-pid lock recovered"
eq 1 "$(key_count "$R_ST" ccccccccccccccc1)" "flush: stale-lock run replayed the entry"

# --- worktree / branch filter: an entry spooled in worktree A is not replayed from worktree B (or another branch of A)
R_WA="$(hs_mkrepo wa store)"
git -C "$R_WA" add .hippo && git -C "$R_WA" commit -q -m store
BR_A="$(git -C "$R_WA" symbolic-ref --short HEAD)"
git -C "$R_WA" worktree add -q -b other "$HS_ROOT/wb" || fail "worktree add"
hs_preflight "$HS_ROOT/wb" || fail "pre-flight worktree B"
mkplan "$TEST_TMP/w1.json" ddddddddddddddd1 wt1
HIPPO_BIN=/nonexistent/hippo node "$DRV" spool "$R_WA" "$TEST_TMP/w1.json" backlog-new >/dev/null
eq 1 "$(spool_count "$HS_ROOT/wb")" "worktree: B sees A's spool (shared common dir)"
node "$LIB" flush --target "$HS_ROOT/wb" 2>"$TEST_TMP/wb.err"; eq 0 "$?" "worktree: flush from B exits 0"
eq 0 "$(H "$HS_ROOT/wb" list --history | jf d.data.total)" "worktree: B created no record from A's entry"
eq 1 "$(spool_count "$R_WA")" "worktree: A's entry still spooled after B's flush"
assert_contains "$(cat "$TEST_TMP/wb.err")" "another worktree or branch" "worktree: B lists the foreign entry"
git -C "$R_WA" checkout -q -b branch2
node "$LIB" flush --target "$R_WA" 2>/dev/null
eq 0 "$(H "$R_WA" list --history | jf d.data.total)" "branch: same worktree, other branch -> not replayed"
eq 1 "$(spool_count "$R_WA")" "branch: entry still spooled"
git -C "$R_WA" checkout -q "$BR_A"
node "$LIB" flush --target "$R_WA" 2>/dev/null
eq 1 "$(key_count "$R_WA" ddddddddddddddd1)" "worktree: back on A's branch the entry is replayed"
eq 0 "$(spool_count "$R_WA")" "worktree: replayed entry removed"

# --- flush --drop removes one entry
mkplan "$TEST_TMP/d1.json" eeeeeeeeeeeeeee1 drop1
HIPPO_BIN=/nonexistent/hippo node "$DRV" spool "$R_ST" "$TEST_TMP/d1.json" backlog-new >/dev/null
node "$LIB" flush --target "$R_ST" --drop eeeeeeeeeeeeeee1 2>/dev/null; eq 0 "$?" "flush --drop: exit 0"
eq 0 "$(spool_count "$R_ST")" "flush --drop: entry removed"
eq 0 "$(key_count "$R_ST" eeeeeeeeeeeeeee1)" "flush --drop: nothing created"

# --- step runner. Targets T1/T2 are pre-existing records; the plan creates a root, links it to both, closes it.
R_RUN="$(hs_mkrepo runner store)"
T1="$(H "$R_RUN" new issue --title target1 --status open | jf 'd.data.ids[0]')"
T2="$(H "$R_RUN" new issue --title target2 --status open | jf 'd.data.ids[0]')"
plan_links() { # plan_links <file> <key> -> create + 2 relates_to + close
  cat > "$1" <<JSON
{"key":"$2","steps":[
 {"op":"create","ref":"root","kind":"issue","argv":["--title","root $2","--status","open"],"body":"root body","key":"$2"},
 {"op":"link","from":"root","rel":"relates_to","to":"$T1","leak_ok":false},
 {"op":"link","from":"root","rel":"relates_to","to":"$T2","leak_ok":false},
 {"op":"close","id":"root","status":"done"}]}
JSON
}
plan_children() { # plan_children <file> <key> -> note + child (key.1) + child->note link
  cat > "$1" <<JSON
{"key":"$2","steps":[
 {"op":"create","ref":"root","kind":"handoff-note","argv":["--title","note $2","--area","autopilot","--status","open"],"body":null,"key":"$2"},
 {"op":"create","ref":"c1","kind":"issue","argv":["--title","child $2","--status","open"],"body":"child body","key":"$2.1"},
 {"op":"link","from":"c1","rel":"relates_to","to":"root","leak_ok":false}]}
JSON
}
out_rels() { H "$1" show "$2" | jf 'd.data.record.relations.out.filter(r=>r.rel==="relates_to").map(r=>r.link_ops.length).join(",")'; }

plan_links "$TEST_TMP/r0.json" 0000000000000a00
node "$DRV" execute "$R_RUN" "$TEST_TMP/r0.json" > "$TEST_TMP/r0.out" 2>/dev/null; eq 0 "$?" "runner: plain run exits 0"
eq true "$(jf d.ok < "$TEST_TMP/r0.out")" "runner: plain run ok"
RID="$(jf d.ids.root < "$TEST_TMP/r0.out")"
[[ "$RID" =~ $ULID_RE ]] && eq 1 1 "runner: ids are full 26-char ULIDs" || fail "runner: root id not a ULID: $RID"
eq "1,1" "$(out_rels "$R_RUN" "$RID")" "runner: two relates_to edges, one op each"
eq done "$(H "$R_RUN" show "$RID" | jf d.data.record.status)" "runner: root closed"
eq "root body" "$(H "$R_RUN" show "$RID" | jf d.data.record.body.trim\(\))" "runner: body passed on stdin"
node "$DRV" execute "$R_RUN" "$TEST_TMP/r0.json" > "$TEST_TMP/r0b.out" 2>/dev/null; eq 0 "$?" "runner: full rerun exits 0"
eq 1 "$(key_count "$R_RUN" 0000000000000a00)" "runner: full rerun creates nothing"
eq 4 "$(jf d.skipped.length < "$TEST_TMP/r0b.out")" "runner: full rerun skips all 4 steps"
eq "1,1" "$(out_rels "$R_RUN" "$RID")" "runner: full rerun adds no op"

fault_case() { # fault_case <point> <key> <plan fn>
  local point="$1" key="$2" fn="$3"
  "$fn" "$TEST_TMP/f-$key.json" "$key"
  PROJECT_RECORD_FAULT="$point" node "$DRV" execute "$R_RUN" "$TEST_TMP/f-$key.json" >/dev/null 2>&1
  eq 70 "$?" "fault $point: process exits 70"
  node "$DRV" execute "$R_RUN" "$TEST_TMP/f-$key.json" > "$TEST_TMP/f-$key.out" 2>/dev/null
  eq 0 "$?" "fault $point: rerun exits 0"
  eq 1 "$(key_count "$R_RUN" "$key")" "fault $point: exactly one root after the rerun"
}
fault_case after-create 0000000000000b01 plan_links
eq "1,1" "$(out_rels "$R_RUN" "$(key_id "$R_RUN" 0000000000000b01)")" "fault after-create: exactly the two edges, no duplicate op"
eq done "$(H "$R_RUN" show "$(key_id "$R_RUN" 0000000000000b01)" | jf d.data.record.status)" "fault after-create: closed"
fault_case after-first-link 0000000000000b02 plan_links
eq "1,1" "$(out_rels "$R_RUN" "$(key_id "$R_RUN" 0000000000000b02)")" "fault after-first-link: exactly the two edges, no duplicate op"
eq done "$(H "$R_RUN" show "$(key_id "$R_RUN" 0000000000000b02)" | jf d.data.record.status)" "fault after-first-link: closed"
fault_case after-first-child 0000000000000b03 plan_children
eq 1 "$(key_count "$R_RUN" 0000000000000b03.1)" "fault after-first-child: exactly one child after the rerun"
eq "1" "$(out_rels "$R_RUN" "$(key_id "$R_RUN" 0000000000000b03.1)")" "fault after-first-child: exactly one child->note edge"

# before-spool-remove: replay done, entry not yet removed -> a second flush leaves exactly one record and no entry
R_BR="$(hs_mkrepo beforeremove store)"
mkplan "$TEST_TMP/br1.json" fffffffffffffff1 br1
HIPPO_BIN=/nonexistent/hippo node "$DRV" spool "$R_BR" "$TEST_TMP/br1.json" backlog-new >/dev/null
PROJECT_RECORD_FAULT=before-spool-remove node "$LIB" flush --target "$R_BR" >/dev/null 2>&1; eq 70 "$?" "fault before-spool-remove: process exits 70"
eq 1 "$(spool_count "$R_BR")" "fault before-spool-remove: entry still there"
node "$LIB" flush --target "$R_BR" 2>/dev/null; eq 0 "$?" "fault before-spool-remove: rerun flush exits 0"
eq 1 "$(key_count "$R_BR" fffffffffffffff1)" "fault before-spool-remove: exactly one record"
eq 0 "$(spool_count "$R_BR")" "fault before-spool-remove: entry removed by the rerun"

# --- leak_ok link refused by the leak guard: warn and continue
hs_leak_guard
cat > "$TEST_TMP/leak.json" <<JSON
{"key":"0000000000000c01","steps":[
 {"op":"create","ref":"root","kind":"issue","argv":["--title","leaky","--status","open"],"body":"b","key":"0000000000000c01"},
 {"op":"link","from":"root","rel":"reported_by","to":"fleet:ns/hostx-pm1/member#01ARZ3NDEKTSV4RRFFQ69G5FAV","leak_ok":true},
 {"op":"close","id":"root","status":"done"}]}
JSON
node "$DRV" execute "$R_RUN" "$TEST_TMP/leak.json" > "$TEST_TMP/leak.out" 2>"$TEST_TMP/leak.err"; eq 0 "$?" "leak_ok: leak refusal does not stop the run"
eq 1 "$(jf d.warnings.length < "$TEST_TMP/leak.out")" "leak_ok: one warning recorded"
assert_contains "$(cat "$TEST_TMP/leak.err")" "WARNING" "leak_ok: warning printed"
eq done "$(H "$R_RUN" show "$(key_id "$R_RUN" 0000000000000c01)" | jf d.data.record.status)" "leak_ok: later close step still ran"
sed 's/"leak_ok":true/"leak_ok":false/; s/c01/c02/g' "$TEST_TMP/leak.json" > "$TEST_TMP/leak2.json"
node "$DRV" execute "$R_RUN" "$TEST_TMP/leak2.json" > "$TEST_TMP/leak2.out" 2>/dev/null; eq 3 "$?" "leak refusal with leak_ok false stops with exit 3"
eq 1 "$(jf d.failed_step.index < "$TEST_TMP/leak2.out")" "leak_ok false: failed step is the link"

# --- non-leak refusal (dangling ULID, exit 3) stops even with leak_ok true; created ids are reported; nothing deleted
cat > "$TEST_TMP/ref.json" <<JSON
{"key":"0000000000000d01","steps":[
 {"op":"create","ref":"root","kind":"issue","argv":["--title","refused","--status","open"],"body":"b","key":"0000000000000d01"},
 {"op":"link","from":"root","rel":"relates_to","to":"01ARZ3NDEKTSV4RRFFQ69G5FAV","leak_ok":true},
 {"op":"close","id":"root","status":"done"}]}
JSON
node "$DRV" execute "$R_RUN" "$TEST_TMP/ref.json" > "$TEST_TMP/ref.out" 2>"$TEST_TMP/ref.err"; eq 3 "$?" "refusal: non-leak exit 3 stops the run with hippo's code"
eq false "$(jf d.ok < "$TEST_TMP/ref.out")" "refusal: result not ok"
eq 1 "$(jf d.failed_step.index < "$TEST_TMP/ref.out")" "refusal: failed step index"
eq dangling "$(jf d.failed_step.error.rule < "$TEST_TMP/ref.out")" "refusal: rule reported"
eq open "$(H "$R_RUN" show "$(key_id "$R_RUN" 0000000000000d01)" | jf d.data.record.status)" "refusal: later close step did not run"
assert_contains "$(cat "$TEST_TMP/ref.err")" "step 1" "refusal: failed step printed"

# --- missing binary mid-run is the distinct spool result
HIPPO_BIN=/nonexistent/hippo node "$DRV" execute "$R_RUN" "$TEST_TMP/r0.json" > "$TEST_TMP/nb.out" 2>/dev/null; eq 5 "$?" "mid-run: missing binary -> exit 5"
eq true "$(jf d.spool < "$TEST_TMP/nb.out")" "mid-run: missing binary -> spool:true"

# --- flush in state files with a non-empty spool: exit 2, never creates repo.toml
R_GONE="$(hs_mkrepo gone)"
mkplan "$TEST_TMP/g1.json" 9999999999999991 gone1
node "$DRV" spool "$R_GONE" "$TEST_TMP/g1.json" backlog-new >/dev/null
node "$LIB" flush --target "$R_GONE" 2>"$TEST_TMP/gone.err"; eq 2 "$?" "flush in files state with a spool -> exit 2"
assert_contains "$(cat "$TEST_TMP/gone.err")" "1 spooled write(s) target a hippo store that no longer exists; see the rollback note" "files-state flush names the count"
assert_file_absent "$R_GONE/.hippo/repo.toml" "files-state flush creates no repo.toml"
eq 1 "$(spool_count "$R_GONE")" "files-state flush keeps the entry"
R_EMPTY="$(hs_mkrepo emptyfiles)"
node "$LIB" flush --target "$R_EMPTY" 2>/dev/null; eq 0 "$?" "flush in files state with an empty spool -> exit 0"

hs_exit_check
finalize_test
