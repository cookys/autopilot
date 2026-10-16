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

ID_OLD="$(node "$OD" open --cwd "$R" --root-run-id root-old --question "Q-OLD?")"
ID_UNB="$(node "$OD" open --cwd "$R" --question "Q-UNBOUND?")"
ID_NEW="$(node "$OD" open --cwd "$R" --root-run-id root-new --question "Q-NEW?")"
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

# a foreign project's file (key sharing the prefix) and a mis-bound file stay out
echo '{ nope' > "$D/zzz.json"
# close --id finds a card of another scope
node "$OD" close --cwd "$R" --root-run-id root-new --id "$ID_OLD" >/dev/null
SHOW="$(node "$OD" show --cwd "$R" --root-run-id root-new)"
assert_not_contains "$SHOW" "Q-OLD" "closed card of another scope is gone"
node "$OD" close --cwd "$R" --id "$ID_NEW" >/dev/null
node "$OD" close --cwd "$R" --root-run-id root-old --id "$ID_UNB" >/dev/null
node "$OD" show --cwd "$R" >/dev/null 2>&1; assert_eq "1" "$?" "nothing open after closing all three"
finalize_test
