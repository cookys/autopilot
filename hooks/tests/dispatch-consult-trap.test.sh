#!/usr/bin/env bash
# KR3 (docs/plans/2026-10-12-tmp-residue-containment.md): dispatch-consult.sh owns one scratch dir
# for every temp file it writes and removes it on EVERY exit path, including SIGTERM mid-transport.
# Negative control: the same scenario against a copy of the script with its traps stripped MUST
# leave the dir behind (otherwise this test could not fail).
. "$(dirname "$0")/lib.sh"
unset REVIEW_LOOP_CONFIG_OVERRIDE AUTOPILOT_QUALIFICATION_OVERRIDE

SCRIPT="$REPO_ROOT/scripts/dispatch-consult.sh"
Q="$TEST_TMP/question.txt"; printf 'which file?\n' > "$Q"
ART="$TEST_TMP/artifact.diff"; printf 'diff --git a/x b/x\n+line\n' > "$ART"
ON_CFG="$TEST_TMP/on.md"
printf -- '- consult_engine: gpt-5.6\n- consult_runner: codex\n- consult_effort: high\n- consult_dispatch: on\n' > "$ON_CFG"
OVR="$TEST_TMP/override.json"
cat > "$OVR" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"gpt-5.6","runner":"codex","role":"consult","reason":"dispatch-consult-trap.test.sh fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON

# Hanging transport: records that the scratch dir (and its prompt) existed, then blocks.
HANG_MARK="$TEST_TMP/hang-started"
HANG_BIN="$TEST_TMP/hang-author.sh"
cat > "$HANG_BIN" <<EOF
#!/usr/bin/env bash
pf=""
while [ \$# -gt 0 ]; do [ "\$1" = "--prompt-file" ] && pf="\$2"; shift; done
[ -s "\$pf" ] && echo "\$pf" > "$HANG_MARK"
exec sleep 300
EOF
chmod +x "$HANG_BIN"

count_residue() { find "$1" -maxdepth 1 -name 'dispatch-consult-*' 2>/dev/null | wc -l | tr -d ' '; }

# term_case <script> <tmpdir>: run in its own session, wait for the transport to be mid-flight,
# SIGTERM the whole group, return once the script is gone.
term_case() {
  local script="$1" tdir="$2"
  mkdir -p "$tdir"; rm -f "$HANG_MARK"
  TMPDIR="$tdir" REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" \
    setsid "$script" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$HANG_BIN" \
    >"$tdir.out" 2>"$tdir.err" &
  local pid=$! i
  for i in $(seq 1 100); do [ -s "$HANG_MARK" ] && break; sleep 0.1; done
  TERM_SEEN_PROMPT="$(cat "$HANG_MARK" 2>/dev/null || true)"
  TERM_DIR_DURING="$(count_residue "$tdir")"
  kill -TERM -- "-$pid" 2>/dev/null
  for i in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  wait "$pid" 2>/dev/null; TERM_RC=$?
  sleep 0.3
}

# --- real script: SIGTERM mid-transport leaves 0 dispatch-consult-* ---
term_case "$SCRIPT" "$TEST_TMP/term-real"
assert_neq "" "$TERM_SEEN_PROMPT" "transport started with a readable prompt (non-vacuous)"
assert_eq "1" "$TERM_DIR_DURING" "exactly one scratch dir existed while the transport ran"
assert_eq "143" "$TERM_RC" "SIGTERM exits 143 through the trap"
assert_eq "0" "$(count_residue "$TEST_TMP/term-real")" "SIGTERM mid-run leaves 0 dispatch-consult-* entries"

# --- success path and refusal path also leave 0 ---
GOOD_RESP="$TEST_TMP/good.json"
printf '%s\n' '{ "answer": { "label": "insufficient_evidence", "artifact_ref": null }, "aside": [], "authority": { "refused": true, "reference": "qc@depth-0" } }' > "$GOOD_RESP"
GOOD_BIN="$TEST_TMP/good-author.sh"
cat > "$GOOD_BIN" <<EOF
#!/usr/bin/env bash
printf '{ "runner": "codex", "model": "gpt-5.6", "status": "authored", "raw_log": "$GOOD_RESP", "error": null }\n'
EOF
chmod +x "$GOOD_BIN"
mkdir -p "$TEST_TMP/ok-tmp"
TMPDIR="$TEST_TMP/ok-tmp" REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" \
  "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$GOOD_BIN" >"$TEST_TMP/ok.out" 2>&1
assert_eq "0" "$?" "advised path exits 0"
assert_eq "0" "$(count_residue "$TEST_TMP/ok-tmp")" "advised path leaves 0 dispatch-consult-* entries"
mkdir -p "$TEST_TMP/off-tmp"; printf -- '- consult_dispatch: off\n' > "$TEST_TMP/off.md"
TMPDIR="$TEST_TMP/off-tmp" REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/off.md" \
  "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$GOOD_BIN" >/dev/null 2>&1
assert_eq "2" "$?" "switch-off refusal exits 2"
assert_eq "0" "$(count_residue "$TEST_TMP/off-tmp")" "refusal path leaves 0 dispatch-consult-* entries"

# --- owner file shape (read by the age-based prune) ---
mkdir -p "$TEST_TMP/own-tmp"
OWN_BIN="$TEST_TMP/own-author.sh"
cat > "$OWN_BIN" <<EOF
#!/usr/bin/env bash
pf=""
while [ \$# -gt 0 ]; do [ "\$1" = "--prompt-file" ] && pf="\$2"; shift; done
cp "\$(dirname "\$pf")/.autopilot-owner" "$TEST_TMP/owner.copy"
printf '{ "runner": "codex", "model": "gpt-5.6", "status": "authored", "raw_log": "$GOOD_RESP", "error": null }\n'
EOF
chmod +x "$OWN_BIN"
TMPDIR="$TEST_TMP/own-tmp" REVIEW_LOOP_CONFIG_OVERRIDE="$ON_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" \
  "$SCRIPT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$OWN_BIN" >/dev/null 2>&1
OWNER_OK="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(Number.isInteger(j.pid)&&Number.isInteger(j.start_time)?"yes":"no")' "$TEST_TMP/owner.copy" 2>/dev/null)"
assert_eq "yes" "$OWNER_OK" ".autopilot-owner carries integer pid + start_time"

# --- negative control: strip the traps => the same SIGTERM scenario leaves the dir ---
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"
for f in "$REPO_ROOT"/scripts/*; do ln -s "$f" "$MUT/$(basename "$f")"; done
rm "$MUT/dispatch-consult.sh"
grep -v '^trap ' "$SCRIPT" > "$MUT/dispatch-consult.sh"; chmod +x "$MUT/dispatch-consult.sh"
assert_eq "0" "$(grep -c '^trap ' "$MUT/dispatch-consult.sh")" "mutant has no trap lines"
term_case "$MUT/dispatch-consult.sh" "$TEST_TMP/term-mut"
assert_neq "" "$TERM_SEEN_PROMPT" "mutant run reached the transport (control is not vacuous)"
MUT_LEFT="$(count_residue "$TEST_TMP/term-mut")"
assert_neq "0" "$MUT_LEFT" "negative control: without the trap SIGTERM leaves dispatch-consult-* behind (got $MUT_LEFT)"
finalize_test
