#!/usr/bin/env bash
# BL cardtrail: a CLOSED card stays in the scope file as a record. Every reader that lists cards must go by the status, not by "the entry is in the
# file", or a closed card comes back onto the panel. This test seeds one open, one awaiting_operator_action and one closed card and asks every reader.
# Negative control (NC-R): a copy of decision-input.js with the closed-card check removed is run through the same assertion and must FAIL it, i.e. the
# test sees a reader that was not updated.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
printf '#!/bin/sh\nexit 0\n' > "$TEST_TMP/fleet"; chmod +x "$TEST_TMP/fleet"; export AUTOPILOT_FLEET_BIN="$TEST_TMP/fleet"
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
mkrepo() { rm -rf "$1" 2>/dev/null; mkdir -p "$1"; $GIT -C "$1" init -q; $GIT -C "$1" commit -q --allow-empty -m base; }
R="$TEST_TMP/repo"; mkrepo "$R"
mk() { node "$OD" open --cwd "$R" --root-run-id rr --question "$1" --free-text --not-authorized irreversible; }
OPEN="$(mk "Q-OPEN?")"; AWAIT="$(mk "Q-AWAIT?")"; CLOSED="$(mk "Q-CLOSED?")"
node "$OD" close --cwd "$R" --root-run-id rr --id "$AWAIT" --answer "a" --awaiting-operator "run it" >/dev/null
node "$OD" close --cwd "$R" --root-run-id rr --id "$CLOSED" --answer "c" >/dev/null
export R REPO_ROOT OPEN AWAIT CLOSED

# one script asks every reader; prints "name:ids" lines. SRC = where src/status comes from (the sabotaged copy in NC-R).
cat > "$TEST_TMP/ask.js" <<'JS'
const path = require('path');
const src = process.env.SRC || path.join(process.env.REPO_ROOT, 'src', 'status');
const { scopeFromCwd } = require(path.join(process.env.REPO_ROOT, 'src/status/project-key'));
const sc = scopeFromCwd(process.env.R);
const scope = require(path.join(src, 'scope-key'));
const common = scope.commonDirOf(sc.repo_identity);
const out = [];
const di = require(path.join(src, 'decision-input'));
const rd = di.readDecision({ commonDir: common, key: sc.project_key, identity: sc.repo_identity, nowMs: Date.now(), liveBase: null });
out.push('decision-input:' + (rd ? rd.value.map((d) => d.id + '=' + d.status).sort().join(',') : 'none'));
const od = require(path.join(process.env.REPO_ROOT, 'scripts/open-decision.js'));
out.push('readEntries:' + od.projectScopeFiles(process.env.R).flatMap((f) => od.readEntries(f)).map((e) => e.id).sort().join(','));
out.push('unboundCards:' + od.unboundCardsOf(process.env.R, 'nosuch').length);
const ss = require(path.join(process.env.REPO_ROOT, 'src/hooks/handlers/session-start.js'));
out.push('session-start:' + ss.openDecisionEntries(process.env.R).map((e) => e.id).sort().join(','));
const rw = require(path.join(process.env.REPO_ROOT, 'src/status/runs-watch.js'));
out.push('runs-watch-count:' + rw.openDecisionCount(sc.repo_identity, sc.project_key));
const rr = require(path.join(process.env.REPO_ROOT, 'scripts/render-review-page.js'));
const m = rr.buildJobModel({ runs: [], root: 'rr', job: 'J', date: '2026-11-06', project: 'abcdef0123456789', now: Date.now(), commit: null, sources: [], decisions: rd ? rd.value : null });
out.push('review-model:' + m.decisions.map((d) => d.id).join(',') + '|needs=' + m.needs_decision + '|awaiting=' + m.awaiting_operator.map((d) => d.id).join(','));
process.stdout.write(out.join('\n') + '\n');
JS
ASK="$(node "$TEST_TMP/ask.js")"
srt() { printf '%s\n' "$@" | LC_ALL=C sort | paste -sd, -; }
IDS="$(srt "$OPEN" "$AWAIT")"; DI="$(srt "$AWAIT=awaiting_operator_action" "$OPEN=open")"
assert_contains "$ASK" "decision-input:$DI" "decision-input lists open + awaiting, not the closed card"
assert_not_contains "$ASK" "$CLOSED=" "decision-input does not list the closed card"
assert_contains "$ASK" "readEntries:$IDS" "open-decision readEntries skips the closed card (advisory-relay, permission-block, ask-decision)"
assert_contains "$ASK" "session-start:$IDS" "session-start card line skips the closed card"
assert_contains "$ASK" "runs-watch-count:2" "runs-watch counts 2 live cards (not the closed one)"
assert_contains "$ASK" "review-model:$OPEN|needs=true|awaiting=$AWAIT" "review job model: question list = open only; awaiting kept apart"

# a project whose cards are ALL closed: nothing is open for the autostart rule / the watcher / the file-exists root check
node "$OD" close --cwd "$R" --root-run-id rr --id "$OPEN" >/dev/null; node "$OD" done --cwd "$R" --root-run-id rr --id "$AWAIT" >/dev/null
ASK2="$(node "$TEST_TMP/ask.js")"
assert_contains "$ASK2" "decision-input:none" "all closed: decision-input reports none"
assert_contains "$ASK2" "runs-watch-count:0" "all closed: runs-watch count 0"
assert_contains "$ASK2" "session-start:"$'\n' "all closed: session-start line empty"
HAS="$(node -e 'const p=require("path"),r=process.env.REPO_ROOT;const {scopeFromCwd}=require(p.join(r,"src/status/project-key"));const sc=scopeFromCwd(process.env.R);const di=require(p.join(r,"src/status/decision-input"));const s=require(p.join(r,"src/status/scope-key"));const f=require("fs").readdirSync(p.join(s.commonDirOf(sc.repo_identity),"autopilot","decisions")).filter(n=>n.endsWith(".json"));process.stdout.write([di.hasOpenDecision({identity:sc.repo_identity,key:sc.project_key}),f.length,s.scopeFileHasLive(p.join(s.commonDirOf(sc.repo_identity),"autopilot","decisions",f[0]))].join(","))')"
assert_eq "$HAS" "false,1,false" "all closed: hasOpenDecision false, the scope file is still there (the record), scopeFileHasLive false"

# NC-R: a reader that was not updated shows the closed card again, and this test sees it
mkrepo "$R"; OPEN="$(mk "Q-OPEN?")"; CLOSED="$(mk "Q-CLOSED?")"; node "$OD" close --cwd "$R" --root-run-id rr --id "$CLOSED" --answer c >/dev/null; export OPEN CLOSED
mkdir -p "$TEST_TMP/sabotaged"; cp "$REPO_ROOT"/src/status/scope-key.js "$REPO_ROOT"/src/status/decision-input.js "$TEST_TMP/sabotaged/"
sed -i '/if (isClosedEntry(e)) return null;/d' "$TEST_TMP/sabotaged/decision-input.js"
grep -q "isClosedEntry(e)) return null" "$TEST_TMP/sabotaged/decision-input.js" && fail "sabotage did not apply"
BAD="$(SRC="$TEST_TMP/sabotaged" node "$TEST_TMP/ask.js" | grep '^decision-input:')"
assert_contains "$BAD" "$CLOSED=" "NC-R: the un-updated reader lists the closed card again (the assertion above would FAIL on it)"
GOOD="$(node "$TEST_TMP/ask.js" | grep '^decision-input:')"
assert_not_contains "$GOOD" "$CLOSED=" "NC-R: the real reader does not"
finalize_test
