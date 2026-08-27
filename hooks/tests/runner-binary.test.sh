#!/usr/bin/env bash
# hooks/tests/runner-binary.test.sh — scripts/lib/runner-binary.js coverage.
#
# THE REGRESSION THIS EXISTS FOR (2026-08-27): a runner whose version probe emits an
# ERROR STRING must be REFUSED, not recorded. `scripts/qualification-sweep.sh` derived the
# version binary from the runner NAME, so `runner: cursor` ran the Cursor IDE launcher
# (`cursor`) instead of the CLI (`cursor-agent`); its stderr error sentence was folded in
# by `2>&1`, character-sanitized, and passed to a real paid administration as the
# `--runner-version` deployment identity. Every assertion below is either the map that
# stops that, or the guard that refuses the sentence.
#
# Spends nothing: the live-binary assertions use PATH stubs in the per-test sandbox.
. "$(dirname "$0")/lib.sh"

LIB="$REPO_ROOT/scripts/lib/runner-binary.js"
CASES="$REPO_ROOT/hooks/tests/fixtures/runner-binary-cases.js"

# =====================================================================
# 1. THE MAP — one owner, and it knows cursor -> cursor-agent.
# =====================================================================
assert_eq "$(node "$LIB" binary --runner cursor)" "cursor-agent" \
  "cursor maps to cursor-agent, NOT cursor (the IDE launcher) - the incident's root cause"
assert_eq "$(node "$LIB" binary --runner cc-shim)" "claude" "cc-shim maps to claude"
assert_eq "$(node "$LIB" binary --runner claude-native)" "claude" "claude-native maps to claude"
assert_eq "$(node "$LIB" binary --runner codex)" "codex" "codex maps to codex"
assert_eq "$(node "$LIB" binary --runner grok)" "grok" "grok maps to grok"
assert_eq "$(node "$LIB" binary --runner agy)" "agy" "agy maps to agy"
assert_eq "$(node "$LIB" binary --runner pi)" "pi" "pi maps to pi"
assert_eq "$(node "$LIB" binary --runner qoderclicn)" "qoderclicn" "qoderclicn maps to qoderclicn"
assert_eq "$(node "$LIB" binary --runner kimi)" "kimi" "kimi maps to kimi"

# FAIL CLOSED on an unknown runner: no name-derived fallthrough. That fallthrough IS the
# bug class - it turns "runner I have never heard of" into "run whatever shares its name".
UNKNOWN_OUT="$(node "$LIB" binary --runner totally-unknown-runner 2>&1)"
assert_exit_code "$?" "3" "an unknown runner is REFUSED (exit 3), never name-derived"
assert_not_contains "$UNKNOWN_OUT" "totally-unknown-runner
" "the unknown runner name is not echoed back as a binary"
assert_contains "$UNKNOWN_OUT" "refusing to guess" "the refusal says it will not guess a binary"

# Usage tooth.
node "$LIB" > /dev/null 2>&1
assert_exit_code "$?" "2" "no subcommand exits 2 (usage)"
node "$LIB" version --bogus-flag > /dev/null 2>&1
assert_exit_code "$?" "2" "unknown flag exits 2 (usage)"

# =====================================================================
# 2. THE VERSION GUARD — accept/refuse table over real and hostile lines.
#    Cases live in a fixture module because several carry raw ANSI bytes.
# =====================================================================
GUARD_OUT="$(node -e '
  const m = require(process.argv[1]);
  const cases = require(process.argv[2]);
  let bad = 0;
  for (const [label, line, want] of cases) {
    const reason = m.versionLineRefusalReason(line);
    const got = reason === null ? "accept" : "refuse";
    if (got !== want) { bad += 1; console.log("MISMATCH " + label + " wanted=" + want + " got=" + got + " reason=" + reason); }
  }
  console.log(bad === 0 ? "GUARD_TABLE_OK" : "GUARD_TABLE_BAD=" + bad);
' "$LIB" "$CASES" 2>&1)"
assert_contains "$GUARD_OUT" "GUARD_TABLE_OK" "every version line accepts/refuses as specified: $GUARD_OUT"

# The incident string specifically, named so a regression reads unambiguously.
INCIDENT_OUT="$(node -e '
  const m = require(process.argv[1]);
  const line = "Error: No Cursor IDE installation found. Use \x27cursor agent\x27 or \x27agent\x27 to run the agent.";
  const reason = m.versionLineRefusalReason(line);
  console.log(reason === null ? "ACCEPTED_token=" + m.sanitizeVersionToken(line) : "REFUSED_" + reason);
' "$LIB" 2>&1)"
assert_contains "$INCIDENT_OUT" "REFUSED_" \
  "the exact cursor-IDE error sentence that became a paid --runner-version token is REFUSED"
assert_not_contains "$INCIDENT_OUT" "ACCEPTED_" \
  "that sentence is never sanitized into an identity token"

# =====================================================================
# 3. LIVE SURFACE via PATH stubs — a runner whose --version emits an ERROR
#    STRING is refused, not recorded. This is the oracle that would have
#    saved the 2026-08-27 run.
# =====================================================================
STUB_DIR="$TEST_TMP/bin"
mkdir -p "$STUB_DIR"

# `codex` is a mapped identity runner, so stubbing it exercises the real resolution path.
make_version_stub() { # <stream: out|err> <exit> <payload>
  cat > "$STUB_DIR/codex" <<STUB
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then
  if [ "$1" = "err" ]; then printf '%s\n' "$3" >&2; else printf '%s\n' "$3"; fi
  exit $2
fi
exit 0
STUB
  chmod +x "$STUB_DIR/codex"
}

# 3a. A well-behaved version -> token on stdout, exit 0.
make_version_stub out 0 "codex-cli 9.9.9"
GOOD="$(PATH="$STUB_DIR:$PATH" node "$LIB" version --runner codex 2>&1)"
assert_exit_code "$?" "0" "a well-formed --version yields a token (exit 0)"
assert_eq "$GOOD" "codex-cli-9.9.9" "the token is the sanitized version line"

# 3b. THE ORACLE: --version emits an error string on stderr, exit 1 (the cursor shape).
make_version_stub err 1 "Error: No Cursor IDE installation found. Use 'cursor agent' or 'agent' to run the agent."
ERR_OUT="$(PATH="$STUB_DIR:$PATH" node "$LIB" version --runner codex 2>&1)"
ERR_EXIT=$?
assert_exit_code "$ERR_EXIT" "3" "a runner whose version probe emits an error string is REFUSED (exit 3)"
assert_contains "$ERR_OUT" "REFUSED" "the refusal is explicit"
assert_not_contains "$ERR_OUT" "No-Cursor-IDE-installation-found" \
  "the error sentence never becomes a sanitized identity token"

# 3c. An error string on stderr with exit 0 (a CLI that misreports success) is STILL
#     refused: stdout is empty, and stdout is the only stream the token may come from.
make_version_stub err 0 "Error: No Cursor IDE installation found."
ERR0_OUT="$(PATH="$STUB_DIR:$PATH" node "$LIB" version --runner codex 2>&1)"
assert_exit_code "$?" "3" "stderr-only output is refused even when --version exits 0 (no 2>&1 fold)"
assert_contains "$ERR0_OUT" "version_empty" "stdout was empty; the stderr text is not read as a version"

# 3d. Exit 0 with garbage on stdout -> refused (the sanitizer-only guard's blind spot).
make_version_stub out 0 "unknown"
GARBAGE_OUT="$(PATH="$STUB_DIR:$PATH" node "$LIB" version --runner codex 2>&1)"
assert_exit_code "$?" "3" "a non-version-shaped stdout line is refused"
assert_contains "$GARBAGE_OUT" "version_not_version_shaped" "the refusal names the shape failure"

# 3e. Empty stdout, exit 0 -> refused.
make_version_stub out 0 ""
EMPTY_OUT="$(PATH="$STUB_DIR:$PATH" node "$LIB" version --runner codex 2>&1)"
assert_exit_code "$?" "3" "an empty --version is refused"
assert_contains "$EMPTY_OUT" "version_empty" "the refusal names the empty version"

# 3f. Missing binary -> refused with missing_binary (not a fabricated token).
# An isolated PATH holding ONLY node, so no runner binary can be found. (A bare
# PATH="$STUB_DIR" would lose node itself and exit 127, which proves nothing.)
NODE_ONLY_DIR="$TEST_TMP/node-only"
mkdir -p "$NODE_ONLY_DIR"
ln -sf "$(command -v node)" "$NODE_ONLY_DIR/node"
MISSING_OUT="$(PATH="$NODE_ONLY_DIR" node "$LIB" version --runner grok 2>&1)"
assert_exit_code "$?" "3" "a missing binary is refused"
assert_contains "$MISSING_OUT" "missing_binary" "the refusal names the missing binary"

# 3g. --json always emits a machine-readable object, refusal included (the sweep parses it).
make_version_stub out 0 "unknown"
JSON_OUT="$(PATH="$STUB_DIR:$PATH" node "$LIB" version --runner codex --json 2>/dev/null)"
JSON_EXIT=$?
assert_exit_code "$JSON_EXIT" "3" "--json still exits 3 on refusal"
assert_contains "$JSON_OUT" '"ok":false' "--json reports ok:false on refusal"
assert_contains "$JSON_OUT" '"binary":"codex"' "--json names the resolved binary"

# =====================================================================
# 4. receiptSafe — the probe receipt now carries REAL CLI output in `bin` /
#    `bin_version` (it used to carry `command -v $runner` and a tr-stripped
#    string). A quote, a backslash or a newline in that output must not be able
#    to forge a JSON field in probe-receipts.jsonl, nor an extra shell line in
#    qualification-sweep.sh's `read -r` block.
# =====================================================================
SAFE_OUT="$(node -e '
  const { receiptSafe } = require(process.argv[1]);
  const hostile = [
    ["quote", "1.2.3\", \"instrument_charged\": true, \"x\": \"" ],
    ["backslash", "1.2.3\\\\"],
    ["newline", "1.2.3\nRESOLVED_VERSION_TOKEN=forged"],
    ["carriage return", "1.2.3\rforged"],
    ["null byte", "1.2.3 forged"],
  ];
  let bad = 0;
  for (const [label, raw] of hostile) {
    const safe = receiptSafe(raw);
    if (/["\\\\\n\r ]/.test(safe)) { bad += 1; console.log("LEAK " + label + " -> " + JSON.stringify(safe)); }
    // and the result must still be a valid JSON string value
    try { JSON.parse("\"" + safe + "\""); } catch (e) { bad += 1; console.log("INVALID_JSON " + label); }
  }
  console.log(bad === 0 ? "RECEIPT_SAFE_OK" : "RECEIPT_SAFE_BAD=" + bad);
' "$LIB" 2>&1)"
assert_contains "$SAFE_OUT" "RECEIPT_SAFE_OK" \
  "no quote/backslash/newline/NUL in a version line can forge a receipt field or a shell line: $SAFE_OUT"

# =====================================================================
# 5. CONTROL-BYTE CLASSES through receiptSafe (depth-0 QC panel, 2026-08-27).
#    The earlier form leaned on \s+ and so stripped only TAB/LF/VT/FF/CR;
#    BEL, SOH, BS, SO, SUB, US, NUL, DEL and C1 survived, and six of those
#    are not legal JSON string content — one such byte in a version banner
#    wrote a permanently unparseable line into an append-only evidence file.
#    Section 4's hostile set missed this: it covered quote/backslash/newline/
#    CR/NUL only, i.e. no non-whitespace control byte.
# =====================================================================
CLASSES_OUT="$(node -e '
  const { receiptSafe } = require(process.argv[1]);
  // One representative per control class that can appear in real CLI output.
  const codes = [0,1,7,8,9,10,11,12,13,14,26,27,31,127,133,155];
  let bad = 0;
  for (const code of codes) {
    const safe = receiptSafe("1.2.3" + String.fromCharCode(code) + "forged");
    const survives = [...safe].some((ch) => {
      const c = ch.charCodeAt(0);
      return (c <= 0x1f) || (c >= 0x7f && c <= 0x9f);
    });
    if (survives) { bad += 1; console.log("CONTROL_SURVIVES code=" + code + " -> " + JSON.stringify(safe)); }
    try { JSON.parse("\"" + safe + "\""); }
    catch (e) { bad += 1; console.log("INVALID_JSON code=" + code); }
  }
  console.log(bad === 0 ? "CONTROL_CLASSES_OK" : "CONTROL_CLASSES_BAD=" + bad);
' "$LIB" 2>&1)"
assert_contains "$CLASSES_OUT" "CONTROL_CLASSES_OK" \
  "every C0/C1 control class is stripped and the result is valid JSON string content: $CLASSES_OUT"

# And the receipt line the sweep writes must still parse with such a byte in the version.
RECEIPT_OUT="$(node -e '
  const { receiptSafe } = require(process.argv[1]);
  const raw = "1.2.3" + String.fromCharCode(7) + "forged";
  const line = "{\"bin\":\"/x/y\",\"bin_version\":\"" + receiptSafe(raw) + "\"}";
  JSON.parse(line);
  console.log("RECEIPT_LINE_PARSES " + line);
' "$LIB" 2>&1)"
assert_contains "$RECEIPT_OUT" "RECEIPT_LINE_PARSES" \
  "a BEL in the version line still yields a parseable receipt line: $RECEIPT_OUT"

# =====================================================================
# 6. STDOUT TAIL + STDERR POLICY (depth-0 QC panel, 2026-08-27).
#    Only the first stdout line used to be validated, so a version line
#    followed by an error still minted a token for a paid run.
#
#    The stderr decision is deliberate and is asserted here so it cannot be
#    changed silently: a non-empty stderr with exit 0 does NOT refuse. The
#    incident was caused by READING stderr as the version; refusing to read
#    it closes that. Every roster runner is an npm-installed CLI that emits
#    benign notices there on a healthy run.
# =====================================================================
SHAPES_OUT="$(node -e '
  const m = require(process.argv[1]);
  const spawn = (out, err, status) => () => ({ stdout: out, stderr: err, status, error: null });
  const cases = [
    ["error on a later stdout line", "tool 1.2.3\nError: something failed", "", 0, "refuse"],
    ["requirement on a later line",  "tool 1.2.3\nrequires Node 18.0",      "", 0, "refuse"],
    ["stack frame on a later line",  "tool 1.2.3\nat /x/y.js:1:2",          "", 0, "refuse"],
    ["benign provenance line",       "tool 1.2.3\nbuilt from abc123",       "", 0, "accept"],
    ["benign copyright line",        "tool 1.2.3\n(c) 2026 Example Corp",   "", 0, "accept"],
    ["stderr warns, exit 0",         "tool 1.2.3", "WARNING: config not found", 0, "accept"],
    ["stderr silent, exit 0",        "tool 1.2.3", "",                          0, "accept"],
  ];
  let bad = 0;
  for (const [label, out, err, status, want] of cases) {
    const r = m.resolveRunnerVersion("codex", { spawn: spawn(out, err, status) });
    const got = r.ok ? "accept" : "refuse";
    if (got !== want) { bad += 1; console.log("MISMATCH " + label + " wanted=" + want + " got=" + got + " reason=" + r.reason); }
  }
  console.log(bad === 0 ? "SHAPES_OK" : "SHAPES_BAD=" + bad);
' "$LIB" 2>&1)"
assert_contains "$SHAPES_OUT" "SHAPES_OK" \
  "stdout tail refuses failure announcements, allows provenance, and stderr alone never refuses: $SHAPES_OUT"

# The stderr decision is REPORTED even though it does not refuse, so a later reader
# can see stderr was non-empty on an accepted seat.
STDERR_FLAG="$(node -e '
  const m = require(process.argv[1]);
  const spawn = (out, err) => () => ({ stdout: out, stderr: err, status: 0, error: null });
  const warned = m.resolveRunnerVersion("codex", { spawn: spawn("tool 1.2.3", "WARNING: x") });
  const quiet  = m.resolveRunnerVersion("codex", { spawn: spawn("tool 1.2.3", "") });
  console.log("warned=" + warned.stderr_nonempty + " quiet=" + quiet.stderr_nonempty + " text=" + JSON.stringify(warned.stderr));
' "$LIB" 2>&1)"
assert_contains "$STDERR_FLAG" "warned=true quiet=false" \
  "a non-empty stderr is recorded on the result even though it does not refuse: $STDERR_FLAG"
assert_contains "$STDERR_FLAG" "WARNING: x" "the stderr text itself is retained for the receipt"

finalize_test
