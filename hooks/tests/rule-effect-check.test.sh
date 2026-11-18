#!/usr/bin/env bash
# rule-effect-check.test.sh — acceptance + negative-control suite for scripts/rule-effect-check.js.
# RED before scripts/rule-effect-check.js exists: node fails with MODULE_NOT_FOUND (rc != 0).

TEST_NAME="rule-effect-check"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID

SRC="$REPO_ROOT/scripts/rule-effect-check.js"
assert_file_exists "$SRC" "scripts/rule-effect-check.js exists"

LOCAL_HOST="$(node -e 'process.stdout.write(require("os").hostname())' < /dev/null)"
OTHER_HOST="remote-seat-box-99"

run_check() {
  RC=0
  OUT="$(node "$SRC" "$@" < /dev/null 2>"$TEST_TMP/stderr.txt")" || RC=$?
  ERR="$(cat "$TEST_TMP/stderr.txt")"
}

run_check_bin() {
  local bin="$1"
  shift
  RC=0
  OUT="$(node "$bin" "$@" < /dev/null 2>"$TEST_TMP/stderr.txt")" || RC=$?
  ERR="$(cat "$TEST_TMP/stderr.txt")"
}

# ── Build temp git repos (bare remotes + clones) under TEST_TMP ──────────────
BARE_A="$TEST_TMP/remote-a.git"
AUTHOR_A="$TEST_TMP/author-a"
git init --bare -q "$BARE_A"
git -C "$BARE_A" symbolic-ref HEAD refs/heads/main

git init -q "$AUTHOR_A"
git -C "$AUTHOR_A" checkout -q -b main
git -C "$AUTHOR_A" config protocol.file.allow always
git -C "$AUTHOR_A" remote add origin "$BARE_A"

printf '# rules v0\n' > "$AUTHOR_A/CLAUDE.md"
git -C "$AUTHOR_A" add CLAUDE.md
GIT_AUTHOR_DATE="@1700000000" GIT_COMMITTER_DATE="@1700000000" \
  git -C "$AUTHOR_A" commit -q -m "chore: initial rules"
SHA_BASE="$(git -C "$AUTHOR_A" rev-parse HEAD)"
git -C "$AUTHOR_A" -c protocol.file.allow=always push -q -u origin main

# Clone seats at SHA_BASE before the rule commit lands
CLONE_PULLED="$TEST_TMP/repoA"
CLONE_UNPULLED="$TEST_TMP/clone-unpulled"
CLONE_UNFETCHED="$TEST_TMP/clone-unfetched"
CLONE_UNPUSHED="$TEST_TMP/clone-unpushed"

for dir in "$CLONE_PULLED" "$CLONE_UNPULLED" "$CLONE_UNFETCHED" "$CLONE_UNPUSHED"; do
  git -c protocol.file.allow=always clone -q "$BARE_A" "$dir"
  git -C "$dir" config protocol.file.allow always
done

# Push rule commit SHA_RULE (committer time 1700001000 = 2023-11-14T22:30:00Z) to BARE_A
printf '# rules v1 (new rule)\n' > "$AUTHOR_A/CLAUDE.md"
git -C "$AUTHOR_A" add CLAUDE.md
GIT_AUTHOR_DATE="@1700001000" GIT_COMMITTER_DATE="@1700001000" \
  git -C "$AUTHOR_A" commit -q -m "docs: tighten lane rule"
SHA_RULE="$(git -C "$AUTHOR_A" rev-parse HEAD)"
git -C "$AUTHOR_A" -c protocol.file.allow=always push -q origin main

# 1) CLONE_PULLED pulls SHA_RULE (both origin/main and HEAD contain SHA_RULE)
git -C "$CLONE_PULLED" -c protocol.file.allow=always pull -q --ff-only origin main

# 2) CLONE_UNPULLED fetches origin (origin/main has SHA_RULE, HEAD stays at SHA_BASE)
git -C "$CLONE_UNPULLED" -c protocol.file.allow=always fetch -q origin

# 3) CLONE_UNPUSHED creates a local-only rule commit pushed nowhere (HEAD has it, origin/main lacks it)
printf '# local unpushed rule\n' > "$CLONE_UNPUSHED/CLAUDE.md"
git -C "$CLONE_UNPUSHED" add CLAUDE.md
GIT_AUTHOR_DATE="@1700001000" GIT_COMMITTER_DATE="@1700001000" \
  git -C "$CLONE_UNPUSHED" commit -q -m "docs: unpushed local rule"
SHA_UNPUSHED="$(git -C "$CLONE_UNPUSHED" rev-parse HEAD)"

# Standalone repo with no remote at all ("pushed nowhere" without origin/main ref)
REPO_NOREMOTE="$TEST_TMP/repo-noremote"
git init -q "$REPO_NOREMOTE"
git -C "$REPO_NOREMOTE" checkout -q -b main
printf '# standalone rule\n' > "$REPO_NOREMOTE/CLAUDE.md"
git -C "$REPO_NOREMOTE" add CLAUDE.md
GIT_AUTHOR_DATE="@1700001000" GIT_COMMITTER_DATE="@1700001000" \
  git -C "$REPO_NOREMOTE" commit -q -m "docs: standalone rule"
SHA_NOREMOTE="$(git -C "$REPO_NOREMOTE" rev-parse HEAD)"

# Second repo family (origin/develop) for --commit repoA=<sha> per-repo mapping
BARE_B="$TEST_TMP/remote-b.git"
AUTHOR_B="$TEST_TMP/author-b"
CLONE_B="$TEST_TMP/repoB"
git init --bare -q "$BARE_B"
git -C "$BARE_B" symbolic-ref HEAD refs/heads/develop
git init -q "$AUTHOR_B"
git -C "$AUTHOR_B" checkout -q -b develop
git -C "$AUTHOR_B" config protocol.file.allow always
git -C "$AUTHOR_B" remote add origin "$BARE_B"
printf '# repoB rule\n' > "$AUTHOR_B/CLAUDE.md"
git -C "$AUTHOR_B" add CLAUDE.md
GIT_AUTHOR_DATE="@1700002000" GIT_COMMITTER_DATE="@1700002000" \
  git -C "$AUTHOR_B" commit -q -m "docs: repoB rule"
SHA_REPO_B="$(git -C "$AUTHOR_B" rev-parse HEAD)"
git -C "$AUTHOR_B" -c protocol.file.allow=always push -q -u origin develop
git -c protocol.file.allow=always clone -q -b develop "$BARE_B" "$CLONE_B"

# Timestamps relative to SHA_RULE (1700001000s = 2023-11-14T22:30:00Z)
ISO_AFTER="2023-11-14T22:35:00Z"
ISO_BEFORE="2023-11-14T22:25:00Z"
MS_AFTER=1700002500000
MS_AT_COMMIT=1700001000000

# ── Case 1: seat whose clone pulled the commit and started after it -> effective, exit 0 ──
INV_EFF="$TEST_TMP/inv-effective.json"
node - "$INV_EFF" "$LOCAL_HOST" "$CLONE_PULLED" "$ISO_AFTER" "$MS_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, repo, isoAfter, msAfter] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-iso', host, repo, session_started_at: isoAfter },
    { seat: 'seat-ms-probe', host, repo, remote_ref: 'origin/main', session_started_at: Number(msAfter), probe: { ok: true, evidence: 'followed new rule' } },
  ],
}, null, 2));
NODE

run_check --inventory "$INV_EFF" --commit "$SHA_RULE"
assert_exit_code "$RC" 0 "pulled + started after -> exit 0"
LINE_COUNT="$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')"
assert_eq "$LINE_COUNT" "3" "JSONL emits 2 seat lines + 1 summary line"

PARSED_EFF="$(printf '%s\n' "$OUT" | node -e '
const fs = require("fs");
const lines = fs.readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const s0 = lines[0];
const s1 = lines[1];
const sum = lines[2].summary;
process.stdout.write([
  s0.seat, s0.verdict, JSON.stringify(s0.failed), String(s0.reason), s0.head, s0.commit_time,
  s1.seat, s1.verdict, JSON.stringify(s1.failed),
  sum.effective, sum.stale, sum.unknown, sum.total
].join("|"));
')"
assert_eq "$PARSED_EFF" "seat-iso|effective|[]|null|${SHA_RULE}|1700001000|seat-ms-probe|effective|[]|2|0|0|2" "JSONL seat fields and summary match contract"

# --json single document mode
run_check --inventory "$INV_EFF" --commit "$SHA_RULE" --json
assert_exit_code "$RC" 0 "--json effective -> exit 0"
JSON_SCHEMA="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(`${d.schema}|${d.seats.length}|${d.summary.effective}|${d.summary.total}`);
')"
assert_eq "$JSON_SCHEMA" "autopilot.rule-effect/1|2|2|2" "--json emits autopilot.rule-effect/1 document"

# ── Case 2: clone not pulled (HEAD lacks commit) -> stale, failed includes head ──
INV_HEAD="$TEST_TMP/inv-unpulled.json"
node - "$INV_HEAD" "$LOCAL_HOST" "$CLONE_UNPULLED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, repo, started] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-unpulled', host, repo, session_started_at: started }],
}));
NODE

run_check --inventory "$INV_HEAD" --commit "$SHA_RULE" --json
assert_exit_code "$RC" 1 "unpulled clone -> exit 1"
HEAD_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const s = d.seats[0];
process.stdout.write(`${s.verdict}|${s.failed.join(",")}|${s.head}|${d.summary.stale}`);
')"
assert_eq "$HEAD_CHECK" "stale|head|${SHA_BASE}|1" "unpulled clone -> verdict stale, failed=[head]"

# ── Case 3: remote lacks commit (pushed nowhere) -> stale, failed includes remote ──
INV_REMOTE="$TEST_TMP/inv-unpushed.json"
node - "$INV_REMOTE" "$LOCAL_HOST" "$CLONE_UNPUSHED" "$REPO_NOREMOTE" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, repo1, repo2, started] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-ahead-of-origin', host, repo: repo1, session_started_at: started },
    { seat: 'seat-no-origin-ref', host, repo: repo2, session_started_at: started },
  ],
}));
NODE

run_check --inventory "$INV_REMOTE" --commit "${CLONE_UNPUSHED}=${SHA_UNPUSHED}" --commit "${REPO_NOREMOTE}=${SHA_NOREMOTE}" --json
assert_exit_code "$RC" 1 "pushed nowhere -> exit 1"
REMOTE_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.seats.map((s) => `${s.seat}:${s.verdict}:${s.failed.join(",")}`).join(";"));
')"
assert_eq "$REMOTE_CHECK" "seat-ahead-of-origin:stale:remote;seat-no-origin-ref:stale:remote" "both unpushed and no-remote-ref report stale with failed=[remote]"

# ── Case 4: session started before (or at) commit time -> stale, failed includes session_start ──
INV_START="$TEST_TMP/inv-old-session.json"
node - "$INV_START" "$LOCAL_HOST" "$CLONE_PULLED" "$ISO_BEFORE" "$MS_AT_COMMIT" <<'NODE'
const fs = require('fs');
const [out, host, repo, isoBefore, msAt] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-before', host, repo, session_started_at: isoBefore },
    { seat: 'seat-exact-same-sec', host, repo, session_started_at: Number(msAt) },
  ],
}));
NODE

run_check --inventory "$INV_START" --commit "$SHA_RULE" --json
assert_exit_code "$RC" 1 "session started before commit -> exit 1"
START_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.seats.map((s) => `${s.seat}:${s.verdict}:${s.failed.join(",")}`).join(";"));
')"
assert_eq "$START_CHECK" "seat-before:stale:session_start;seat-exact-same-sec:stale:session_start" "session before/equal commit_time -> failed=[session_start]"

# ── Case 5: probe ok:false -> stale, failed includes probe (+ multi-failure accumulation) ──
INV_PROBE="$TEST_TMP/inv-probe.json"
node - "$INV_PROBE" "$LOCAL_HOST" "$CLONE_PULLED" "$CLONE_UNPULLED" "$ISO_AFTER" "$ISO_BEFORE" <<'NODE'
const fs = require('fs');
const [out, host, repoOk, repoUnpulled, isoAfter, isoBefore] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-probe-fail', host, repo: repoOk, session_started_at: isoAfter, probe: { ok: false, evidence: 'violated rule' } },
    { seat: 'seat-multi-fail', host, repo: repoUnpulled, session_started_at: isoBefore, probe: { ok: false, evidence: 'also old' } },
  ],
}));
NODE

run_check --inventory "$INV_PROBE" --commit "$SHA_RULE" --json
assert_exit_code "$RC" 1 "probe ok:false -> exit 1"
PROBE_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.seats.map((s) => `${s.seat}:${s.verdict}:${s.failed.join(",")}`).join(";"));
')"
assert_eq "$PROBE_CHECK" "seat-probe-fail:stale:probe;seat-multi-fail:stale:head,session_start,probe" "probe failure and multi-failure list all failed checks"

# ── Case 6: missing repo path / null start / other host / unresolved sha -> unknown with reason, exit 2 ──
INV_UNK="$TEST_TMP/inv-unknown.json"
MISSING_PATH="$TEST_TMP/does-not-exist-repo"
node - "$INV_UNK" "$LOCAL_HOST" "$OTHER_HOST" "$CLONE_PULLED" "$MISSING_PATH" "$CLONE_UNFETCHED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, otherHost, repoOk, missingPath, unfetchedRepo, isoAfter] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-ok', host, repo: repoOk, session_started_at: isoAfter },
    { seat: 'seat-missing-repo', host, repo: missingPath, session_started_at: isoAfter },
    { seat: 'seat-null-start', host, repo: repoOk, session_started_at: null },
    { seat: 'seat-other-host', host: otherHost, repo: repoOk, session_started_at: isoAfter },
    { seat: 'seat-unresolved-sha', host, repo: unfetchedRepo, session_started_at: isoAfter },
  ],
}));
NODE

run_check --inventory "$INV_UNK" --commit "$SHA_RULE" --json
assert_exit_code "$RC" 2 "no stale + some unknown -> exit 2"
UNK_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const parts = d.seats.map((s) => `${s.seat}:${s.verdict}:${s.reason || "-"}:${s.failed.length}`);
parts.push(`sum=${d.summary.effective}/${d.summary.stale}/${d.summary.unknown}/${d.summary.total}`);
process.stdout.write(parts.join(";"));
')"
assert_eq "$UNK_CHECK" "seat-ok:effective:-:0;seat-missing-repo:unknown:missing_repo:0;seat-null-start:unknown:missing_session_started_at:0;seat-other-host:unknown:other_host:0;seat-unresolved-sha:unknown:unresolved_commit:0;sum=1/0/4/5" "unknown reasons and summary counts match"

# Verify read-only default: CLONE_UNFETCHED was NOT fetched by the check above
UNFETCHED_REMOTE_TIP="$(git -C "$CLONE_UNFETCHED" rev-parse origin/main)"
assert_eq "$UNFETCHED_REMOTE_TIP" "$SHA_BASE" "default check never runs git fetch"

# --all-hosts inspects seat-other-host locally instead of reporting other_host
INV_ALLHOSTS="$TEST_TMP/inv-all-hosts.json"
node - "$INV_ALLHOSTS" "$OTHER_HOST" "$CLONE_PULLED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, otherHost, repoOk, isoAfter] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-foreign', host: otherHost, repo: repoOk, session_started_at: isoAfter }],
}));
NODE

run_check --inventory "$INV_ALLHOSTS" --commit "$SHA_RULE" --all-hosts --json
assert_exit_code "$RC" 0 "--all-hosts checks foreign host path locally -> exit 0"

# --fetch opt-in fetches origin on CLONE_UNFETCHED so SHA_RULE resolves on origin/main while HEAD stays stale
INV_FETCH="$TEST_TMP/inv-fetch.json"
node - "$INV_FETCH" "$LOCAL_HOST" "$CLONE_UNFETCHED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, repo, isoAfter] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-fetched', host, repo, session_started_at: isoAfter }],
}));
NODE

run_check --inventory "$INV_FETCH" --commit "$SHA_RULE" --fetch --json
assert_exit_code "$RC" 1 "--fetch brings remote ref up to date and catches unpulled HEAD -> exit 1"
FETCH_CHECK="$(printf '%s' "$OUT" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8")).seats[0];
process.stdout.write(`${s.verdict}:${s.failed.join(",")}`);
')"
assert_eq "$FETCH_CHECK" "stale:head" "--fetch leaves HEAD untouched and flags failed=[head]"

# ── Case 7: --commit repoA=<sha> mapping picks the right sha per repo (basename + path + origin/develop) ──
INV_MAP="$TEST_TMP/inv-map.json"
node - "$INV_MAP" "$LOCAL_HOST" "$CLONE_PULLED" "$CLONE_B" "$MS_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, repoA, repoB, msAfter] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-a', host, repo: repoA, remote_ref: 'origin/main', session_started_at: Number(msAfter) },
    { seat: 'seat-b', host, repo: repoB, remote_ref: 'origin/develop', session_started_at: Number(msAfter) },
  ],
}));
NODE

# 7a) Basename mapping: --commit repoA=<shaA> --commit repoB=<shaB>
run_check --inventory "$INV_MAP" --commit "repoA=${SHA_RULE}" --commit "repoB=${SHA_REPO_B}" --json
assert_exit_code "$RC" 0 "--commit repoA=<sha> --commit repoB=<sha> both effective -> exit 0"

# 7b) Full-path mapping: --commit /abs/repoA=<shaA> --commit /abs/repoB=<shaB>
run_check --inventory "$INV_MAP" --commit "${CLONE_PULLED}=${SHA_RULE}" --commit "${CLONE_B}=${SHA_REPO_B}" --json
assert_exit_code "$RC" 0 "--commit <abs-path>=<sha> mapping -> exit 0"

# 7c) Swapping the shas proves each repo got its own mapped sha (not a broadcast)
run_check --inventory "$INV_MAP" --commit "repoA=${SHA_REPO_B}" --commit "repoB=${SHA_RULE}" --json
assert_exit_code "$RC" 2 "swapped repo shas do not resolve in the other repo -> exit 2 (unresolved_commit)"

# ── Case 8: CLI / schema errors exit 3 (never masquerade as 0/1/2) ──
BAD_SCHEMA="$TEST_TMP/bad-schema.json"
printf '{"schema":"wrong/9","seats":[{"seat":"s","host":"h","repo":"/nonexistent","session_started_at":null}]}\n' > "$BAD_SCHEMA"
run_check --inventory "$BAD_SCHEMA" --commit "$SHA_RULE"
assert_exit_code "$RC" 3 "wrong inventory schema -> exit 3"

run_check --inventory "$INV_EFF"
assert_exit_code "$RC" 3 "missing --commit -> exit 3"

# ── Case 9: Negative controls (evidence-discipline §58 — each guard shown red when disabled) ──
MUT_REMOTE="$TEST_TMP/mut-remote.js"
sed_mutant "$SRC" "$MUT_REMOTE" 's#if (remoteAnc.status !== 0) {#if (false) {#'
INV_ONE_UNPUSHED="$TEST_TMP/inv-one-unpushed.json"
node - "$INV_ONE_UNPUSHED" "$LOCAL_HOST" "$CLONE_UNPUSHED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, repo, started] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 's', host, repo, session_started_at: started }],
}));
NODE
run_check_bin "$MUT_REMOTE" --inventory "$INV_ONE_UNPUSHED" --commit "$SHA_UNPUSHED"
assert_exit_code "$RC" 0 "negative control: disabling remote ancestry check lets unpushed commit pass"
run_check --inventory "$INV_ONE_UNPUSHED" --commit "$SHA_UNPUSHED"
assert_exit_code "$RC" 1 "real checker blocks unpushed commit"

MUT_HEAD="$TEST_TMP/mut-head.js"
sed_mutant "$SRC" "$MUT_HEAD" 's#if (headAnc.status !== 0) {#if (false) {#'
run_check_bin "$MUT_HEAD" --inventory "$INV_HEAD" --commit "$SHA_RULE"
assert_exit_code "$RC" 0 "negative control: disabling HEAD ancestry check lets unpulled clone pass"
run_check --inventory "$INV_HEAD" --commit "$SHA_RULE"
assert_exit_code "$RC" 1 "real checker blocks unpulled clone"

MUT_START="$TEST_TMP/mut-start.js"
sed_mutant "$SRC" "$MUT_START" 's#!(parsedStart.ms > commitTimeSec . 1000)#false#'
run_check_bin "$MUT_START" --inventory "$INV_START" --commit "$SHA_RULE"
assert_exit_code "$RC" 0 "negative control: disabling session_start comparison lets pre-commit session pass"
run_check --inventory "$INV_START" --commit "$SHA_RULE"
assert_exit_code "$RC" 1 "real checker blocks pre-commit session"

MUT_PROBE="$TEST_TMP/mut-probe.js"
sed_mutant "$SRC" "$MUT_PROBE" 's#if (seat.probe.ok !== true) {#if (false) {#'
INV_ONE_PROBE="$TEST_TMP/inv-one-probe.json"
node - "$INV_ONE_PROBE" "$LOCAL_HOST" "$CLONE_PULLED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, host, repo, started] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 's', host, repo, session_started_at: started, probe: { ok: false, evidence: 'bad' } }],
}));
NODE
run_check_bin "$MUT_PROBE" --inventory "$INV_ONE_PROBE" --commit "$SHA_RULE"
assert_exit_code "$RC" 0 "negative control: disabling probe check lets failed probe pass"
run_check --inventory "$INV_ONE_PROBE" --commit "$SHA_RULE"
assert_exit_code "$RC" 1 "real checker blocks failed probe"

finalize_test
