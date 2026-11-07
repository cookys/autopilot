#!/usr/bin/env bash
# BL cardtrail: a CLOSED card stays in the scope file as a record. Every reader that lists cards must go by the status, not by "the entry is in the
# file", or a closed card comes back onto the panel. This test seeds one open, one awaiting_operator_action, one pending_dispatch and one closed card and
# asks every reader. Only the OPEN one is a pending question (待決): awaiting and pending_dispatch are counted and drawn apart, never as 待決.
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
OPEN="$(mk "Q-OPEN?")"; AWAIT="$(mk "Q-AWAIT?")"; CLOSED="$(mk "Q-CLOSED?")"; PEND="$(mk "Q-PEND?")"
node "$OD" close --cwd "$R" --root-run-id rr --id "$PEND" --answer "p" --executor ns/cc/exec--claude >/dev/null
node "$OD" close --cwd "$R" --root-run-id rr --id "$AWAIT" --answer "a" --awaiting-operator "run it" >/dev/null
node "$OD" close --cwd "$R" --root-run-id rr --id "$CLOSED" --answer "c" >/dev/null
export R REPO_ROOT OPEN AWAIT CLOSED PEND

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
out.push('session-start-line:' + JSON.stringify(ss.openDecisionCardLine(process.env.R)));
const rw = require(path.join(process.env.REPO_ROOT, 'src/status/runs-watch.js'));
out.push('runs-watch-count:' + rw.openDecisionCount(sc.repo_identity, sc.project_key));
const rr = require(path.join(process.env.REPO_ROOT, 'scripts/render-review-page.js'));
const m = rr.buildJobModel({ runs: [], root: 'rr', job: 'J', date: '2026-11-06', project: 'abcdef0123456789', now: Date.now(), commit: null, sources: [], decisions: rd ? rd.value : null });
out.push('review-model:' + m.decisions.map((d) => d.id).join(',') + '|needs=' + m.needs_decision + '|awaiting=' + m.awaiting_operator.map((d) => d.id).join(',') + '|pending=' + m.pending_dispatch.map((d) => d.id).join(','));
process.stdout.write(out.join('\n') + '\n');
JS
ASK="$(node "$TEST_TMP/ask.js")"
srt() { printf '%s\n' "$@" | LC_ALL=C sort | paste -sd, -; }
IDS="$OPEN"; DI="$(srt "$AWAIT=awaiting_operator_action" "$OPEN=open" "$PEND=pending_dispatch")"
assert_contains "$ASK" "decision-input:$DI" "decision-input lists open + awaiting + pending_dispatch with their statuses, not the closed card"
assert_not_contains "$ASK" "$CLOSED=" "decision-input does not list the closed card"
assert_contains "$ASK" "readEntries:$IDS" "open-decision readEntries returns the OPEN card only (advisory-relay, permission-block, ask-decision, owner-question-guard)"
assert_contains "$ASK" "session-start:$IDS" "session-start open-card list: open only"
assert_contains "$ASK" "Open decision cards (1): $OPEN" "session-start line counts the open card only"
assert_contains "$ASK" "$AWAIT" "session-start line still names the awaiting card, apart"
assert_not_contains "$ASK" "Open decision cards (2)" "session-start does not count awaiting/pending as open"
assert_contains "$ASK" "runs-watch-count:1" "runs-watch counts 1 open question (awaiting and pending_dispatch are not an owner deciding)"
assert_contains "$ASK" "review-model:$OPEN|needs=true|awaiting=$AWAIT|pending=$PEND" "review job model: question list = open only; awaiting and pending_dispatch kept apart"
# Count parity (PM, ctfix): the panel, the band and SessionStart must report the SAME number of pending questions for one store holding an open, a closed,
# a pending_dispatch and an awaiting_operator_action card. panel = decision-input open rows and runs-watch count; band = the job model the band reads
# (mods/live/model.ts readJobModel parses this buildJobModel output; model.ts is TS under the mod runtime and cannot be required from node, so its
# source is asserted: needs_decision + the decisions list); SessionStart = the cardState bucket. All must be 1.
n_di="$(printf '%s\n' "$ASK" | sed -n 's/^decision-input://p' | tr ',' '\n' | grep -c '=open$')"
n_rw="$(printf '%s\n' "$ASK" | sed -n 's/^runs-watch-count://p')"
n_band="$(printf '%s\n' "$ASK" | sed -n 's/^review-model:\([^|]*\)|.*/\1/p' | tr ',' '\n' | grep -c .)"
n_ss="$(printf '%s\n' "$ASK" | sed -n 's/^session-start://p' | tr ',' '\n' | grep -c .)"
assert_eq "$n_di,$n_rw,$n_band,$n_ss" "1,1,1,1" "count parity: panel (decision-input, runs-watch), band (job model decisions) and SessionStart all count 1 pending question"
# C1: a page whose only card is an awaiting one must show its step, and must not look like "nothing to do"
cat > "$TEST_TMP/page.js" <<'JS'
const rr = require(require('path').join(process.env.REPO_ROOT, 'scripts/render-review-page.js'));
const mk = (cards) => rr.renderJobHtml(rr.buildJobModel({ runs: [], root: 'rr', job: 'J', date: '2026-11-06', project: 'abcdef0123456789', now: Date.now(), commit: null, sources: [], decisions: cards }));
const base = { question: 'Q-PG?', opened_at: '2026-11-06T00:00:00.000Z', stale: false, age_s: 5, options: null };
const out = {};
out.awaiting = mk([{ ...base, id: 'd-aw', status: 'awaiting_operator_action', awaiting_operator: 'STEP-ONLY-OPERATOR-CAN-DO', answer: 'a' }]);
out.pending = mk([{ ...base, id: 'd-pd', status: 'pending_dispatch', executor: 'ns/cc/exec--claude', answer: 'a' }]);
out.closedOnly = mk([{ ...base, id: 'd-cl', status: 'closed' }]);
process.stdout.write(JSON.stringify(out));
JS
PG="$(node "$TEST_TMP/page.js")"
pgf() { printf '%s' "$PG" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(j[process.argv[1]])' "$1"; }
assert_contains "$(pgf awaiting)" "STEP-ONLY-OPERATOR-CAN-DO" "review page: an awaiting-only card shows its step"
assert_contains "$(pgf awaiting)" "待你動手" "review page: awaiting is labelled 待你動手"
assert_contains "$(pgf pending)" "答案已出、待派工" "review page: a pending_dispatch card is labelled 答案已出、待派工"
assert_contains "$(pgf pending)" "d-pd" "review page: the pending_dispatch card id is shown"
assert_not_contains "$(pgf closedOnly)" "待你動手" "review page: a closed card shows no awaiting block"
assert_not_contains "$(pgf closedOnly)" "待派工" "review page: a closed card shows no pending block"

# a project whose cards are ALL closed: nothing is open for the autostart rule / the watcher / the file-exists root check
node "$OD" close --cwd "$R" --root-run-id rr --id "$OPEN" >/dev/null; node "$OD" done --cwd "$R" --root-run-id rr --id "$AWAIT" >/dev/null; node "$OD" close --cwd "$R" --root-run-id rr --id "$PEND" --dispatched t-1 >/dev/null
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
