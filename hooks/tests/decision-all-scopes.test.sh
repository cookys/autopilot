#!/usr/bin/env bash
# A session's root can change mid-way (compaction, /reload-plugins): its open cards then sit in several scope files
# (old root, unbound, new root). `open-decision.js show` / `close --id` and the watcher's decision input (the pane's data)
# must see and close the cards of EVERY scope file of the project, not only the current one.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base

ID_OLD="$(node "$OD" open --not-authorized irreversible --free-text --cwd "$R" --root-run-id root-old --question "Q-OLD?")"
ID_UNB="$(node "$OD" open --not-authorized irreversible --free-text --cwd "$R" --question "Q-UNBOUND?")"
ID_NEW="$(node "$OD" open --not-authorized irreversible --free-text --cwd "$R" --root-run-id root-new --question "Q-NEW?")"
D="$R/.git/autopilot/decisions"
assert_eq "3" "$(ls "$D" | grep -c '\.json$')" "three scope files exist"

# show (current scope = root-new) lists all three
SHOW="$(node "$OD" show --cwd "$R" --root-run-id root-new)"
for q in Q-OLD Q-UNBOUND Q-NEW; do assert_contains "$SHOW" "$q" "show lists $q"; done

# the pane's data source: readDecision sees all three, from any watcher scope
OUT="$(R="$R" REPO_ROOT="$REPO_ROOT" node -e '
const { scopeFromCwd } = require(process.env.REPO_ROOT + "/src/status/project-key");
const { commonDirOf } = require(process.env.REPO_ROOT + "/src/status/scope-key");
const { readDecision } = require(process.env.REPO_ROOT + "/src/status/decision-input");
const sc = scopeFromCwd(process.env.R);
for (const root of ["root-new", null]) {
  const r = readDecision({ commonDir: commonDirOf(sc.repo_identity), key: sc.project_key, root, identity: sc.repo_identity, nowMs: Date.now(), liveBase: null });
  console.log(String(root) + ":" + (r ? r.value.map((d) => d.question).sort().join(",") : "none"));
}')"
assert_contains "$OUT" "root-new:Q-NEW?,Q-OLD?,Q-UNBOUND?" "readDecision (root-new scope) sees all three"
assert_contains "$OUT" "null:Q-NEW?,Q-OLD?,Q-UNBOUND?" "readDecision (unbound scope) sees all three"

# files that must NOT count: (a) another project's / repo's content under this project's name, (b) a file name whose root disagrees
# with the root inside, (c) corrupt JSON. Each carries a card (or none) that must stay invisible and unclosable.
KEY="$(R="$R" REPO_ROOT="$REPO_ROOT" node -e 'console.log(require(process.env.REPO_ROOT+"/src/status/project-key").scopeFromCwd(process.env.R).project_key)')"
IDENT="$(R="$R" REPO_ROOT="$REPO_ROOT" node -e 'console.log(require(process.env.REPO_ROOT+"/src/status/project-key").scopeFromCwd(process.env.R).repo_identity)')"
card() { printf '{"id":"%s","question":"%s","opened_at":"%s"}' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; }
seed() { printf '{"schema":"autopilot.decision/2","root_run_id":%s,"repo_identity":"%s","project_key":"%s","decisions":[%s]}\n' "$2" "$3" "$4" "$(card "$5" "$6")" > "$D/$1"; }
seed "$KEY--evil.json" '"evil"' "git-common-dir:/elsewhere" "other-project" d-evil1111 "Q-FOREIGN?"
seed "$KEY--named.json" '"other"' "$IDENT" "$KEY" d-mism2222 "Q-MISMATCH?"
printf '{ nope' > "$D/$KEY--x.json"
SHOW="$(node "$OD" show --cwd "$R" --root-run-id root-new)"
for q in Q-FOREIGN Q-MISMATCH; do assert_not_contains "$SHOW" "$q" "show hides $q"; done
assert_eq "0" "$(node "$OD" show --cwd "$R" --root-run-id root-new >/dev/null 2>&1; echo $?)" "show survives a corrupt scope file"
PANE="$(R="$R" REPO_ROOT="$REPO_ROOT" node -e '
const { scopeFromCwd } = require(process.env.REPO_ROOT + "/src/status/project-key");
const { commonDirOf } = require(process.env.REPO_ROOT + "/src/status/scope-key");
const { readDecision } = require(process.env.REPO_ROOT + "/src/status/decision-input");
const sc = scopeFromCwd(process.env.R);
const r = readDecision({ commonDir: commonDirOf(sc.repo_identity), key: sc.project_key, root: "root-new", identity: sc.repo_identity, nowMs: Date.now(), liveBase: null });
console.log(r.value.map((d) => d.question).sort().join(","));')"
assert_eq "Q-NEW?,Q-OLD?,Q-UNBOUND?" "$PANE" "pane data excludes foreign, mismatched and corrupt files"
for xid in d-evil1111 d-mism2222; do
  if node "$OD" close --cwd "$R" --id "$xid" | grep -q 'not open'; then :; else fail "close reached a card in an excluded file: $xid"; fi
done
assert_contains "$(cat "$D/$KEY--evil.json")" "d-evil1111" "foreign file untouched by close"
assert_contains "$(cat "$D/$KEY--named.json")" "d-mism2222" "mismatched file untouched by close"
rm -f "$D/$KEY--evil.json" "$D/$KEY--named.json" "$D/$KEY--x.json"

# positive control: the SAME hand-written card shape, in a correctly named and consistent file, IS accepted (so the
# counter-examples above are hidden because their FILE is excluded, not because the card shape is unfit)
seed "$KEY--okroot.json" '"okroot"' "$IDENT" "$KEY" d-good3333 "Q-SEEDED-OK?"
assert_contains "$(node "$OD" show --cwd "$R" --root-run-id root-new)" "Q-SEEDED-OK" "seed-shaped card in a valid scope file shows"
PANE2="$(R="$R" REPO_ROOT="$REPO_ROOT" node -e '
const { scopeFromCwd } = require(process.env.REPO_ROOT + "/src/status/project-key");
const { commonDirOf } = require(process.env.REPO_ROOT + "/src/status/scope-key");
const { readDecision } = require(process.env.REPO_ROOT + "/src/status/decision-input");
const sc = scopeFromCwd(process.env.R);
const r = readDecision({ commonDir: commonDirOf(sc.repo_identity), key: sc.project_key, root: null, identity: sc.repo_identity, nowMs: Date.now(), liveBase: null });
console.log(r.value.map((d) => d.question).sort().join(","));')"
assert_contains "$PANE2" "Q-SEEDED-OK?" "seed-shaped card in a valid scope file reaches the pane data"
if node "$OD" close --cwd "$R" --id d-good3333 | grep -q '^closed'; then :; else fail "seed-shaped card could not be closed"; fi
assert_file_absent "$D/$KEY--okroot.json" "closing its last card removes the file"

# a root with unsafe characters (library callers such as hooks pass raw roots; the CLI flag refuses them): open -> show -> close
UID_="$(R="$R" REPO_ROOT="$REPO_ROOT" node -e 'const r=require(process.env.REPO_ROOT+"/scripts/open-decision.js").openDecision({cwd:process.env.R,root:"a b/c",session:null,question:"Q-UNSAFE-ROOT?"});console.log(r.status==="ok"?r.id:"ERR "+r.message)')"
case "$UID_" in d-*) : ;; *) fail "open with an unsafe root failed: $UID_" ;; esac
assert_contains "$(node "$OD" show --cwd "$R")" "Q-UNSAFE-ROOT" "unsafe-root card shows"
if node "$OD" close --cwd "$R" --id "$UID_" | grep -q '^closed'; then :; else fail "unsafe-root card could not be closed"; fi
node "$OD" show --cwd "$R" | grep -q 'Q-UNSAFE-ROOT' && fail "unsafe-root card still listed after close"
# close --id finds a card of another scope
node "$OD" close --cwd "$R" --root-run-id root-new --id "$ID_OLD" >/dev/null
SHOW="$(node "$OD" show --cwd "$R" --root-run-id root-new)"
assert_not_contains "$SHOW" "Q-OLD" "closed card of another scope is gone"
node "$OD" close --cwd "$R" --id "$ID_NEW" >/dev/null
node "$OD" close --cwd "$R" --root-run-id root-old --id "$ID_UNB" >/dev/null
node "$OD" show --cwd "$R" >/dev/null 2>&1; assert_eq "1" "$?" "nothing open after closing all three"
finalize_test
