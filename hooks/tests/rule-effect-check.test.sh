#!/usr/bin/env bash
# rule-effect-check.test.sh — acceptance + negative-control suite for scripts/rule-effect-check.js.
# RED before scripts/rule-effect-check.js exists: node fails with MODULE_NOT_FOUND (rc != 0).

TEST_NAME="rule-effect-check"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
# This sandbox injects GIT_CONFIG_COUNT protocol.file.allow=never, which blocks the
# file:// remotes the suite builds. Count 0 drops that injection; local repo config remains.
export GIT_CONFIG_COUNT=0
unset GIT_ALLOW_PROTOCOL

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

# Timestamps relative to setup reflogs (wall-clock) and SHA_RULE (1700001000s = 2023-11-14T22:30:00Z)
NOW_SEC="$(date +%s)"
PULLED_PRESENT_SEC="$(git -C "$CLONE_PULLED" reflog show --date=unix --format='%gd' -n 1 HEAD | sed -n 's/.*@{\([0-9]*\)}.*/\1/p')"
assert_neq "$PULLED_PRESENT_SEC" "" "CLONE_PULLED reflog timestamp extracted"
ISO_AFTER="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) * 1000).toISOString())' "$((NOW_SEC + 3600))")"
ISO_BEFORE="2023-11-14T22:25:00Z"
MS_AFTER="$(( (NOW_SEC + 7200) * 1000 ))"
MS_AT_PRESENT="$(( PULLED_PRESENT_SEC * 1000 ))"

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
  s0.present_since, s0.present_since_source, s0.loaded_at,
  s1.seat, s1.verdict, JSON.stringify(s1.failed),
  sum.effective, sum.stale, sum.unknown, sum.total
].join("|"));
')"
assert_eq "$PARSED_EFF" "seat-iso|effective|[]|null|${SHA_RULE}|1700001000|${PULLED_PRESENT_SEC}|reflog|${ISO_AFTER}|seat-ms-probe|effective|[]|2|0|0|2" "JSONL seat fields and summary match contract"

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

# ── Case 4: rules loaded before (or at) present_since -> stale, failed includes loaded ──
INV_START="$TEST_TMP/inv-old-session.json"
node - "$INV_START" "$LOCAL_HOST" "$CLONE_PULLED" "$ISO_BEFORE" "$MS_AT_PRESENT" <<'NODE'
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
assert_exit_code "$RC" 1 "loaded before present_since -> exit 1"
START_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.seats.map((s) => `${s.seat}:${s.verdict}:${s.failed.join(",")}`).join(";"));
')"
assert_eq "$START_CHECK" "seat-before:stale:loaded;seat-exact-same-sec:stale:loaded" "loaded before/equal present_since -> failed=[loaded]"

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
assert_eq "$PROBE_CHECK" "seat-probe-fail:stale:probe;seat-multi-fail:stale:head,loaded,probe" "probe failure and multi-failure list all failed checks"

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
assert_eq "$UNK_CHECK" "seat-ok:effective:-:0;seat-missing-repo:unknown:missing_repo:0;seat-null-start:unknown:no_load_time:0;seat-other-host:unknown:other_host:0;seat-unresolved-sha:unknown:unresolved_commit:0;sum=1/0/4/5" "unknown reasons and summary counts match"

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
sed_mutant "$SRC" "$MUT_START" 's#!(loadedAtMs > presentSinceSec . 1000)#false#'
run_check_bin "$MUT_START" --inventory "$INV_START" --commit "$SHA_RULE"
assert_exit_code "$RC" 0 "negative control: disabling loaded comparison lets stale load pass"
run_check --inventory "$INV_START" --commit "$SHA_RULE"
assert_exit_code "$RC" 1 "real checker blocks stale load"

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

# ── Case 10: host matching (<prefix>-<seat.host>, exact, first DNS label, no substring) + --host ──
INV_HOST="$TEST_TMP/inv-host.json"
node - "$INV_HOST" "$CLONE_PULLED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, repo, started] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-short', host: 'node701', repo, session_started_at: started },
    { seat: 'seat-exact', host: 'owner-node701', repo, session_started_at: started },
    { seat: 'seat-substr', host: 'de701', repo, session_started_at: started },
  ],
}));
NODE

run_check --inventory "$INV_HOST" --commit "$SHA_RULE" --host owner-node701 --json
assert_exit_code "$RC" 2 "short + exact matched, substring de701 stays other_host -> exit 2"
HOST_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.seats.map((s) => `${s.seat}:${s.verdict}:${s.reason || "-"}`).join(";"));
')"
assert_eq "$HOST_CHECK" "seat-short:effective:-;seat-exact:effective:-;seat-substr:unknown:other_host" "host matching handles <prefix>- stripping and exact without substring match"

INV_DNS="$TEST_TMP/inv-dns.json"
node - "$INV_DNS" "$CLONE_PULLED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, repo, started] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-dns', host: 'owner-node701', repo, session_started_at: started }],
}));
NODE
run_check --inventory "$INV_DNS" --commit "$SHA_RULE" --host owner-node701.corp.example.net --json
assert_exit_code "$RC" 0 "first DNS label matches seat.host -> exit 0"

# Negative control: revert <prefix>- branch -> short host turns unknown/other_host (red)
INV_SHORT_ONLY="$TEST_TMP/inv-short-only.json"
node - "$INV_SHORT_ONLY" "$CLONE_PULLED" "$ISO_AFTER" <<'NODE'
const fs = require('fs');
const [out, repo, started] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-short', host: 'node701', repo, session_started_at: started }],
}));
NODE
MUT_HOST="$TEST_TMP/mut-host.js"
sed_mutant "$SRC" "$MUT_HOST" 's#if (localHostname.endsWith(`-\${seatHost}`)) return true;#if (false) return true;#'
run_check_bin "$MUT_HOST" --inventory "$INV_SHORT_ONLY" --commit "$SHA_RULE" --host owner-node701
assert_exit_code "$RC" 2 "negative control: reverting prefix-strip host branch rejects short seat.host as unknown/other_host"
run_check --inventory "$INV_SHORT_ONLY" --commit "$SHA_RULE" --host owner-node701
assert_exit_code "$RC" 0 "real checker accepts short seat.host via prefix strip"

# ── Case 11: loaded check (last_compact_at, present_since reflog vs commit_time, --transcript) ──
BARE_L="$TEST_TMP/remote-loaded.git"
AUTHOR_L="$TEST_TMP/author-loaded"
CLONE_L="$TEST_TMP/clone-loaded"
git init --bare -q "$BARE_L"
git -C "$BARE_L" symbolic-ref HEAD refs/heads/main
git init -q "$AUTHOR_L"
git -C "$AUTHOR_L" checkout -q -b main
git -C "$AUTHOR_L" config protocol.file.allow always
git -C "$AUTHOR_L" remote add origin "$BARE_L"

T_BASE_L=$((NOW_SEC - 7200))
printf '# rules base\n' > "$AUTHOR_L/CLAUDE.md"
git -C "$AUTHOR_L" add CLAUDE.md
GIT_AUTHOR_DATE="@$T_BASE_L" GIT_COMMITTER_DATE="@$T_BASE_L" \
  git -C "$AUTHOR_L" commit -q -m "chore: base"
git -C "$AUTHOR_L" -c protocol.file.allow=always push -q -u origin main
git -c protocol.file.allow=always clone -q "$BARE_L" "$CLONE_L"
git -C "$CLONE_L" config protocol.file.allow always

# Commit C at t0 = NOW_SEC - 3600; CLONE_L pulls C later at t2 (~NOW_SEC)
T0_SEC=$((NOW_SEC - 3600))
printf '# rules v2\n' > "$AUTHOR_L/CLAUDE.md"
git -C "$AUTHOR_L" add CLAUDE.md
GIT_AUTHOR_DATE="@$T0_SEC" GIT_COMMITTER_DATE="@$T0_SEC" \
  git -C "$AUTHOR_L" commit -q -m "docs: v2 rule"
SHA_L="$(git -C "$AUTHOR_L" rev-parse HEAD)"
git -C "$AUTHOR_L" -c protocol.file.allow=always push -q origin main

git -C "$CLONE_L" -c protocol.file.allow=always pull -q --ff-only origin main
T2_SEC="$(git -C "$CLONE_L" reflog show --date=unix --format='%gd' -n 1 HEAD | sed -n 's/.*@{\([0-9]*\)}.*/\1/p')"
assert_neq "$T2_SEC" "" "CLONE_L reflog timestamp t2 extracted"

T1_ISO="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) * 1000).toISOString())' "$((T0_SEC - 1800))")"
T_MID_ISO="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) * 1000).toISOString())' "$((NOW_SEC - 1800))")"
T_AFTER_ISO="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) * 1000).toISOString())' "$((T2_SEC + 600))")"

# 11a) 04:57 case: session_started_at < t0 and last_compact_at between t0 and t2 -> stale; > t2 -> effective
INV_0457="$TEST_TMP/inv-0457.json"
node - "$INV_0457" "$LOCAL_HOST" "$CLONE_L" "$T1_ISO" "$T_MID_ISO" <<'NODE'
const fs = require('fs');
const [out, host, repo, t1, tMid] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-0457', host, repo, session_started_at: t1, last_compact_at: tMid }],
}));
NODE
run_check --inventory "$INV_0457" --commit "$SHA_L" --json
assert_exit_code "$RC" 1 "compact between commit_time and present_since -> stale (exit 1)"
CHECK_0457="$(printf '%s' "$OUT" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8")).seats[0];
process.stdout.write(`${s.verdict}|${s.failed.join(",")}|${s.present_since}|${s.present_since_source}|${s.loaded_at}`);
')"
assert_eq "$CHECK_0457" "stale|loaded|${T2_SEC}|reflog|${T_MID_ISO}" "04:57 case records loaded failure and reflog present_since"

INV_AFTER_COMPACT="$TEST_TMP/inv-after-compact.json"
node - "$INV_AFTER_COMPACT" "$LOCAL_HOST" "$CLONE_L" "$T1_ISO" "$T_AFTER_ISO" <<'NODE'
const fs = require('fs');
const [out, host, repo, t1, tAfter] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-compacted-after', host, repo, session_started_at: t1, last_compact_at: tAfter }],
}));
NODE
run_check --inventory "$INV_AFTER_COMPACT" --commit "$SHA_L" --json
assert_exit_code "$RC" 0 "last_compact_at > present_since -> effective (exit 0)"

# 11b) Multi-entry reflog: newer commit D on top of C at t3 > t2; compact at t2+1 (< t3) stays effective because oldest consecutive entry is t2
sleep 2
printf 'note\n' > "$CLONE_L/NOTE.md"
git -C "$CLONE_L" add NOTE.md
git -C "$CLONE_L" commit -q -m "chore: unrelated follow-up"
git -C "$CLONE_L" -c protocol.file.allow=always push -q origin main
MS_BETWEEN_T2_T3="$(( (T2_SEC + 1) * 1000 ))"
INV_MULTI_REFLOG="$TEST_TMP/inv-multi-reflog.json"
node - "$INV_MULTI_REFLOG" "$LOCAL_HOST" "$CLONE_L" "$T1_ISO" "$MS_BETWEEN_T2_T3" <<'NODE'
const fs = require('fs');
const [out, host, repo, t1, msBetween] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-multi-reflog', host, repo, session_started_at: t1, last_compact_at: Number(msBetween) }],
}));
NODE
run_check --inventory "$INV_MULTI_REFLOG" --commit "$SHA_L" --json
assert_exit_code "$RC" 0 "present_since picks oldest consecutive reflog entry t2 rather than newest t3"
MULTI_REFLOG_CHECK="$(printf '%s' "$OUT" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8")).seats[0];
process.stdout.write(`${s.present_since}|${s.present_since_source}`);
')"
assert_eq "$MULTI_REFLOG_CHECK" "${T2_SEC}|reflog" "multi-entry reflog reports t2 with source reflog"

# 11c) --transcript with two compact_boundary lines uses newest and applies only to --seat
TRANSCRIPT_FILE="$TEST_TMP/transcript.jsonl"
cat > "$TRANSCRIPT_FILE" <<EOF
{"type":"user","timestamp":"$T1_ISO","message":"hi"}
{malformed-trailing-or-partial-line
{"type":"system","subtype":"compact_boundary","timestamp":"$T_MID_ISO","compactMetadata":{"trigger":"auto"}}
{"type":"assistant","timestamp":"$T_AFTER_ISO","message":"ok"}
{"type":"system","subtype":"compact_boundary","timestamp":"$T_AFTER_ISO","compactMetadata":{"trigger":"auto"}}
EOF

INV_TRANSCRIPT="$TEST_TMP/inv-transcript.json"
node - "$INV_TRANSCRIPT" "$LOCAL_HOST" "$CLONE_L" "$T1_ISO" <<'NODE'
const fs = require('fs');
const [out, host, repo, t1] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [
    { seat: 'seat-tr-target', host, repo, session_started_at: t1 },
    { seat: 'seat-tr-other', host, repo, session_started_at: t1 },
  ],
}));
NODE
run_check --inventory "$INV_TRANSCRIPT" --commit "$SHA_L" --transcript "$TRANSCRIPT_FILE" --seat seat-tr-target --json
assert_exit_code "$RC" 1 "transcript applies only to named --seat; other seat stays stale"
TR_CHECK="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.seats.map((s) => `${s.seat}:${s.verdict}:${s.loaded_at}`).join(";"));
')"
T1_NORM="$(node -e 'process.stdout.write(new Date(process.argv[1]).toISOString())' "$T1_ISO")"
assert_eq "$TR_CHECK" "seat-tr-target:effective:${T_AFTER_ISO};seat-tr-other:stale:${T1_NORM}" "--transcript picks newest compact_boundary and scopes strictly to --seat"

run_check --inventory "$INV_TRANSCRIPT" --commit "$SHA_L" --transcript "$TRANSCRIPT_FILE"
assert_exit_code "$RC" 3 "--transcript without --seat exits 3"

# 11d) No reflog entry -> falls back to commit time, present_since_source = commit_time
BARE_NR="$TEST_TMP/remote-noreflog.git"
REPO_NOREFLOG="$TEST_TMP/repo-noreflog"
git init --bare -q "$BARE_NR"
git -C "$BARE_NR" symbolic-ref HEAD refs/heads/main
git init -q "$REPO_NOREFLOG"
git -C "$REPO_NOREFLOG" checkout -q -b main
git -C "$REPO_NOREFLOG" config protocol.file.allow always
git -C "$REPO_NOREFLOG" remote add origin "$BARE_NR"
printf '# noreflog rule\n' > "$REPO_NOREFLOG/CLAUDE.md"
git -C "$REPO_NOREFLOG" add CLAUDE.md
GIT_AUTHOR_DATE="@1700001000" GIT_COMMITTER_DATE="@1700001000" \
  git -C "$REPO_NOREFLOG" commit -q -m "docs: rule"
SHA_NR="$(git -C "$REPO_NOREFLOG" rev-parse HEAD)"
git -C "$REPO_NOREFLOG" -c protocol.file.allow=always push -q -u origin main
git -C "$REPO_NOREFLOG" reflog expire --expire-unreachable=all --expire=all --all

INV_NOREFLOG="$TEST_TMP/inv-noreflog.json"
node - "$INV_NOREFLOG" "$LOCAL_HOST" "$REPO_NOREFLOG" <<'NODE'
const fs = require('fs');
const [out, host, repo] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema: 'autopilot.rule-effect-inventory/1',
  seats: [{ seat: 'seat-noreflog', host, repo, last_compact_at: 1700001100000 }],
}));
NODE
run_check --inventory "$INV_NOREFLOG" --commit "$SHA_NR" --json
assert_exit_code "$RC" 0 "expired reflog falls back to commit_time -> effective (exit 0)"
NR_CHECK="$(printf '%s' "$OUT" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8")).seats[0];
process.stdout.write(`${s.verdict}|${s.present_since}|${s.present_since_source}`);
')"
assert_eq "$NR_CHECK" "effective|1700001000|commit_time" "no reflog entry falls back to commit_time with source=commit_time"

# 11e) Negative control: compare loaded_at against commitTimeSec instead of presentSinceSec -> 04:57 case turns wrongly effective
MUT_CT="$TEST_TMP/mut-commit-time.js"
sed_mutant "$SRC" "$MUT_CT" 's#!(loadedAtMs > presentSinceSec . 1000)#!(loadedAtMs > commitTimeSec * 1000)#'
run_check_bin "$MUT_CT" --inventory "$INV_0457" --commit "$SHA_L"
assert_exit_code "$RC" 0 "negative control: comparing against commit_time makes 04:57 case wrongly effective"
run_check --inventory "$INV_0457" --commit "$SHA_L"
assert_exit_code "$RC" 1 "real checker blocks 04:57 case using present_since"

# ── --seats mode (hangar builds no inventory JSON) ───────────────────────────
SEATS_BARE="$TEST_TMP/seats-remote.git"
SEATS_REPO="$TEST_TMP/seats-rule-repo"
git init --bare -q "$SEATS_BARE"
git -C "$SEATS_BARE" symbolic-ref HEAD refs/heads/develop
git init -q "$SEATS_REPO"
git -C "$SEATS_REPO" checkout -q -b develop
git -C "$SEATS_REPO" config protocol.file.allow always
git -C "$SEATS_REPO" remote add origin "$SEATS_BARE"
printf '# seats rule\n' > "$SEATS_REPO/CLAUDE.md"
git -C "$SEATS_REPO" add CLAUDE.md
GIT_AUTHOR_DATE="@1700003000" GIT_COMMITTER_DATE="@1700003000" \
  git -C "$SEATS_REPO" commit -q -m "docs: seats claude rule"
SHA_SEATS_CLAUDE="$(git -C "$SEATS_REPO" rev-parse HEAD)"
printf 'not a rule\n' > "$SEATS_REPO/OTHER.txt"
git -C "$SEATS_REPO" add OTHER.txt
GIT_AUTHOR_DATE="@1700004000" GIT_COMMITTER_DATE="@1700004000" \
  git -C "$SEATS_REPO" commit -q -m "chore: later non-claude"
SHA_SEATS_LATER="$(git -C "$SEATS_REPO" rev-parse HEAD)"
git -C "$SEATS_REPO" -c protocol.file.allow=always push -q -u origin develop
SEATS_REPO_ABS="$(cd "$SEATS_REPO" && pwd)"

SEATS_PROJECTS="$TEST_TMP/fake-projects"
mkdir -p "$SEATS_PROJECTS/proj-a"
SECRET_MARKER="super-secret-token-9f3a"
SEATS_NOW="$(date +%s)"
SEATS_AFTER_ISO="$(node -e 'process.stdout.write(new Date((Number(process.argv[1]) + 7200) * 1000).toISOString())' "$SEATS_NOW")"
SEATS_OLD_ISO="2020-01-01T00:00:00.000Z"
cat > "$SEATS_PROJECTS/proj-a/sid-eff.jsonl" <<EOF
{"type":"user","timestamp":"2024-01-01T00:00:00.000Z","message":{"content":"$SECRET_MARKER"}}
{"type":"system","subtype":"compact_boundary","timestamp":"$SEATS_AFTER_ISO","message":{"content":"$SECRET_MARKER"}}
EOF
cat > "$SEATS_PROJECTS/proj-a/sid-stale.jsonl" <<EOF
{"type":"user","timestamp":"$SEATS_OLD_ISO","message":"x"}
{"type":"system","subtype":"compact_boundary","timestamp":"$SEATS_OLD_ISO"}
EOF

# seat-decl.tsv row: seat host os_account harness project_dir model pool profile perm operator_only auto_compact overlay sid lead
seat_row() { printf '%s\t%s\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t%s\t-\n' "$1" "$2" "$3"; }
SEATS_OK="$TEST_TMP/seats-ok.tsv"
{ printf '# skipped\n\n'; seat_row local-eff "$LOCAL_HOST" sid-eff; seat_row foreign-seat "$OTHER_HOST" sid-foreign; } > "$SEATS_OK"

run_check --seats "$SEATS_OK" --rule-repo "$SEATS_REPO" --rule-ref origin/develop \
  --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 0 "seats: compact after rule commit -> exit 0"
SEATS_EFF="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const s = d.seats[0];
process.stdout.write([
  d.seats.length, s.seat, s.verdict, s.rule_commit, s.rule_repo, s.time_source,
  d.summary.effective, d.summary.stale, d.summary.unknown, d.summary.total,
  d.seats.some((x) => x.seat === "foreign-seat") ? "present" : "absent"
].join("|"));
')"
assert_eq "$SEATS_EFF" "1|local-eff|effective|${SHA_SEATS_CLAUDE}|${SEATS_REPO_ABS}|transcript|1|0|0|1|absent" \
  "seats: effective uses newest CLAUDE.md commit; foreign host omitted from output and total"
assert_not_contains "$OUT" "$SECRET_MARKER" "seats: secret message field absent from stdout"
assert_not_contains "$ERR" "$SECRET_MARKER" "seats: secret message field absent from stderr"
assert_neq "$SHA_SEATS_CLAUDE" "$SHA_SEATS_LATER" "fixture: later non-CLAUDE.md commit differs"

SEATS_STALE="$TEST_TMP/seats-stale.tsv"
seat_row local-stale "$LOCAL_HOST" sid-stale > "$SEATS_STALE"
run_check --seats "$SEATS_STALE" --rule-repo "$SEATS_REPO" --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST"
assert_exit_code "$RC" 1 "seats: transcript older than rule commit -> exit 1"
STALE_V="$(printf '%s\n' "$OUT" | node -e '
const lines = require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
process.stdout.write(lines[0].verdict + "|" + lines[0].time_source);
')"
assert_eq "$STALE_V" "stale|transcript" "seats: older transcript is stale with time_source transcript"

SEATS_MISS="$TEST_TMP/seats-miss.tsv"
{ seat_row local-miss "$LOCAL_HOST" sid-missing; seat_row foreign-seat "$OTHER_HOST" sid-foreign; } > "$SEATS_MISS"
run_check --seats "$SEATS_MISS" --rule-repo "$SEATS_REPO" --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 2 "seats: missing transcript -> exit 2"
MISS_V="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const s = d.seats[0];
process.stdout.write([s.verdict, s.reason, s.time_source, d.seats.length, d.summary.unknown, d.summary.total].join("|"));
')"
assert_eq "$MISS_V" "unknown|transcript_missing|missing|1|1|1" "seats: transcript_missing, foreign row not counted"

SEATS_BAD="$TEST_TMP/seats-bad.tsv"
printf '# c\n\n# d\na\tb\n' > "$SEATS_BAD"
run_check --seats "$SEATS_BAD" --rule-repo "$SEATS_REPO" --host "$LOCAL_HOST"
assert_exit_code "$RC" 3 "seats: bad column count -> exit 3"
assert_contains "$ERR" ":4: expected 14" "seats: bad column count names the line number"

SEATS_OLD3="$TEST_TMP/seats-old3.tsv"
printf 'local-eff\t%s\tsid-eff\n' "$LOCAL_HOST" > "$SEATS_OLD3"
run_check --seats "$SEATS_OLD3" --rule-repo "$SEATS_REPO" --host "$LOCAL_HOST"
assert_exit_code "$RC" 3 "seats: the retired 3-column seat file is refused"

SEATS_OLD3="$TEST_TMP/seats-old3.tsv"
printf 'local-eff\t%s\tsid-eff\n' "$LOCAL_HOST" > "$SEATS_OLD3"
run_check --seats "$SEATS_OLD3" --rule-repo "$SEATS_REPO" --host "$LOCAL_HOST"
assert_exit_code "$RC" 3 "seats: the retired 3-column seat file is refused"

run_check --seats "$SEATS_OK" --inventory "$INV_EFF" --host "$LOCAL_HOST"
assert_exit_code "$RC" 3 "seats: --seats with --inventory -> exit 3"

# a) only other-host rows is not a green empty report
SEATS_FOREIGN="$TEST_TMP/seats-foreign-only.tsv"
seat_row foreign-seat "$OTHER_HOST" sid-foreign > "$SEATS_FOREIGN"
run_check --seats "$SEATS_FOREIGN" --rule-repo "$SEATS_REPO" --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 2 "seats: only other-host rows -> exit 2"
assert_contains "$ERR" "rule-effect-check: no seat in $SEATS_FOREIGN is on host $LOCAL_HOST" \
  "seats: zero local rows names the tsv and host on stderr"
FOREIGN_JSON="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write([d.no_local_seats === true, d.summary.total, d.seats.length].join("|"));
')"
assert_eq "$FOREIGN_JSON" "true|0|0" "seats: only other-host rows sets no_local_seats and total 0"

# b) session start before the rule commit, compact_boundary after it -> effective
#    (kills "compact detection returns null": start alone would be stale)
SEATS_COMPACT_BEFORE="$TEST_TMP/seats-compact-before.tsv"
cat > "$SEATS_PROJECTS/proj-a/sid-compact-before.jsonl" <<EOF
{"type":"user","timestamp":"2023-01-01T00:00:00.000Z","message":"early"}
{"type":"system","subtype":"compact_boundary","timestamp":"$SEATS_AFTER_ISO"}
EOF
seat_row local-compact-before "$LOCAL_HOST" sid-compact-before > "$SEATS_COMPACT_BEFORE"
run_check --seats "$SEATS_COMPACT_BEFORE" --rule-repo "$SEATS_REPO" --rule-ref origin/develop \
  --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 0 "seats: start before rule commit but compact after -> exit 0"
COMPACT_BEFORE_V="$(printf '%s' "$OUT" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8")).seats[0];
process.stdout.write(s.verdict + "|" + s.time_source);
')"
assert_eq "$COMPACT_BEFORE_V" "effective|transcript" \
  "seats: compact_boundary after the rule commit makes an early session effective"

# c) start before the rule commit, later non-compact timestamps after it -> stale
#    (kills "latest timestamp instead of earliest")
SEATS_EARLY="$TEST_TMP/seats-earliest.tsv"
cat > "$SEATS_PROJECTS/proj-a/sid-earliest.jsonl" <<EOF
{"type":"user","timestamp":"2023-01-01T00:00:00.000Z","message":"early"}
{"type":"assistant","timestamp":"$SEATS_AFTER_ISO","message":"later"}
EOF
seat_row local-earliest "$LOCAL_HOST" sid-earliest > "$SEATS_EARLY"
run_check --seats "$SEATS_EARLY" --rule-repo "$SEATS_REPO" --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 1 "seats: later non-compact lines do not refresh an early session -> exit 1"
EARLY_V="$(printf '%s' "$OUT" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8")).seats[0];
process.stdout.write(s.verdict + "|" + s.time_source);
')"
assert_eq "$EARLY_V" "stale|transcript" "seats: earliest timestamp, not the latest line, decides stale"

# d) omitted --rule-ref uses origin/develop, not HEAD, when their CLAUDE.md history differs
git -C "$SEATS_REPO" checkout -q -b seats-local-head
printf '# seats rule local head\n' > "$SEATS_REPO/CLAUDE.md"
git -C "$SEATS_REPO" add CLAUDE.md
GIT_AUTHOR_DATE="@1700005000" GIT_COMMITTER_DATE="@1700005000" \
  git -C "$SEATS_REPO" commit -q -m "docs: local head claude rule"
SHA_SEATS_HEAD_CLAUDE="$(git -C "$SEATS_REPO" rev-parse HEAD)"
assert_neq "$SHA_SEATS_HEAD_CLAUDE" "$SHA_SEATS_CLAUDE" "fixture: HEAD CLAUDE.md commit differs from origin/develop"
run_check --seats "$SEATS_OK" --rule-repo "$SEATS_REPO" --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 0 "seats: omitted --rule-ref still checks origin/develop -> exit 0"
RULE_REF_V="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const s = d.seats[0];
process.stdout.write([d.rule_ref, s.rule_ref, s.rule_commit].join("|"));
')"
assert_eq "$RULE_REF_V" "origin/develop|origin/develop|${SHA_SEATS_CLAUDE}" \
  "seats: omitted --rule-ref records origin/develop and that ref's CLAUDE.md commit, not HEAD"

# e) trailing space on sid still finds the transcript
SEATS_PAD="$TEST_TMP/seats-pad.tsv"
seat_row local-eff "$LOCAL_HOST" "sid-eff " > "$SEATS_PAD"
run_check --seats "$SEATS_PAD" --rule-repo "$SEATS_REPO" --rule-ref origin/develop \
  --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 0 "seats: sid trailing space still finds the transcript -> exit 0"
PAD_V="$(printf '%s' "$OUT" | node -e '
const s = JSON.parse(require("fs").readFileSync(0, "utf8")).seats[0];
process.stdout.write(s.verdict + "|" + s.reason);
')"
assert_eq "$PAD_V" "effective|null" "seats: trimmed sid is effective, not transcript_missing"

# f) --seats auto: the fleet directory (FLEET_BIN stub) replaces the TSV.
#    Live claude seats only; host = courier, sid = sub/generation. The stub
#    reuses the sid-eff transcript so the expected verdict matches case (a).
FLEET_STUB="$TEST_TMP/fleet-stub.js"
cat > "$FLEET_STUB" <<STUB
#!/usr/bin/env node
process.stdout.write(JSON.stringify({ members: [
  { member: 'seat-auto-member', namespace: 'ns', courier: '$LOCAL_HOST', state: 'live', harness: 'claude', sub: 'sid-eff' },
  { member: 'offline-seat', namespace: 'ns', courier: 'other-courier-box', state: 'offline', harness: 'claude', sub: 'sid-off' },
  { member: 'nonclaude-seat', namespace: 'ns', courier: '$LOCAL_HOST', state: 'live', harness: 'cursor', sub: 'sid-glm' }
]}));
STUB
chmod +x "$FLEET_STUB"
FLEET_BIN="$FLEET_STUB" run_check --seats auto --rule-repo "$SEATS_REPO" --rule-ref origin/develop \
  --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 0 "seats auto: live claude seat from the directory is checked -> exit 0"
AUTO_V="$(printf '%s' "$OUT" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(d.seats.length + "|" + d.seats[0].seat + "|" + d.seats[0].verdict);
')"
assert_eq "$AUTO_V" "1|ns/$LOCAL_HOST/seat-auto-member|effective" \
  "seats auto: filters to the one live claude seat and derives seat/host/sid like the TSV"

# g) --seats auto with an unreadable fleet directory -> hard usage error
#    (this script's usage/CLI errors exit 3, per Case 8; never an empty list)
FAIL_STUB="$TEST_TMP/fleet-stub-fail.js"
printf '#!/usr/bin/env node\nprocess.stderr.write("peers: hub unreachable\\n");\nprocess.exit(1);\n' > "$FAIL_STUB"
chmod +x "$FAIL_STUB"
FLEET_BIN="$FAIL_STUB" run_check --seats auto --rule-repo "$SEATS_REPO" --rule-ref origin/develop \
  --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 3 "seats auto: fleet directory failure -> usage error exit 3"
assert_contains "$ERR" "fleet directory unavailable" "seats auto: directory failure names the cause"

# h) legacy TSV path still works after the auto addition
run_check --seats "$SEATS_OK" --rule-repo "$SEATS_REPO" --rule-ref origin/develop \
  --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_exit_code "$RC" 0 "seats: legacy TSV file still usable alongside --seats auto"

# negative control: a copy without the auto branch must go red on --seats auto
# (the TSV loader treats "auto" as a file path and refuses).
MUTANT="$TEST_TMP/rule-effect-check.noauto.js"
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1], "utf8");
const needle = "opts.seats === \x27auto\x27 ? loadSeatsAuto() : loadSeatsTsv(opts.seats)";
if (!src.includes(needle)) process.exit(3);
fs.writeFileSync(process.argv[2], src.replace(needle, "loadSeatsTsv(opts.seats)"));
' "$SRC" "$MUTANT" || fail "negative control: auto branch anchor not found in rule-effect-check.js"
FLEET_BIN="$FLEET_STUB" run_check_bin "$MUTANT" --seats auto --rule-repo "$SEATS_REPO" --rule-ref origin/develop \
  --projects-dir "$SEATS_PROJECTS" --host "$LOCAL_HOST" --json
assert_neq "$RC" 0 "negative control: without the auto branch the auto case goes red"

finalize_test
