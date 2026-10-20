#!/usr/bin/env bash
# Headless --seat-file derives runner-version, family, semantic fingerprint,
# and the pinned harness/containment/scope fields. The live rail is replaced
# by a no-op dispatch stub the way the headless suite replaces the panel.
# RED at 87d71706a: FAIL headless implementer with only a seat file finishes a failed exam (exit 1): expected exit 1, got 2. Direct repro: engine-qualify: --runner-version is required; stdout 0 bytes; exit 2. No record emitted.
# RED at d687f0b04: case (g) exits 1 before any pair is compared. TypeError: familyForHeadlessModel is not a function (scripts/lib/headless-seat-derive.js exports only deriveHeadlessSeat, which calls familyOfEngine). Direct repro on this head: familyOfEngine("MiniMax-M3.1-Flash") === "google"; familyOfEngine("MiniMax-M3.1-Flash-Preview") === "google"; official administration.family for both is "minimax". gemini-3.7-flash-high stays "google".
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
export ENGINE_SCORECARD_DIR="$TEST_TMP/engine-scorecard"
mkdir -p "$ENGINE_CAPABILITY_DIR" "$ENGINE_SCORECARD_DIR"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"

EQJS="$REPO_ROOT/scripts/engine-qualify.js"
SWEEP="$REPO_ROOT/scripts/qualification-sweep.sh"
PINS="$REPO_ROOT/references/qualification-headless-pins.json"
NODE_BIN="$(command -v node)"

BIN="$TEST_TMP/bin"
mkdir -p "$BIN"
cat >"$BIN/claude" <<'EOF'
#!/bin/sh
printf '%s\n' '1.2.3'
EOF
chmod +x "$BIN/claude"
export PATH="$BIN:$PATH"

STUB="$TEST_TMP/dispatch-stub.sh"
cat >"$STUB" <<'EOF'
#!/bin/sh
printf '%s\n' '{"status":"no_op"}'
exit 0
EOF
chmod +x "$STUB"

CORPUS_VERSION="$("$NODE_BIN" -e '
const g = require(process.argv[1]);
process.stdout.write(`${g.CORPUS.corpus_version}.${g.GENERATOR_VERSION}`);
' "$REPO_ROOT/evals/impl-eval-generator.js")"
PROMPT_HASH="16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a"
SEM_HASH="d8af529058764fa0276f57633d26eb8a7e61089b441982a7cf29ed3913029d0a"

SEAT="$TEST_TMP/seat.json"
cat >"$SEAT" <<EOF
{
  "engine": "MiniMax-M3.1-Flash",
  "model": "MiniMax-M3.1-Flash",
  "model_version": "MiniMax-M3.1-Flash",
  "runner": "cc-shim",
  "role": "implementer",
  "effort": "high",
  "prompt_config_hash": "$PROMPT_HASH",
  "corpus_version": "$CORPUS_VERSION"
}
EOF

run_q() {
  local out_file="$1"
  shift
  set +e
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    "$NODE_BIN" "$EQJS" "$@" >"$out_file" 2>"$TEST_TMP/err.txt"
  RUN_RC=$?
  set -e
}

dir_snapshot() {
  python3 - "$1" <<'PY'
import hashlib, os, sys
root = sys.argv[1]
if not os.path.exists(root):
    sys.exit(0)
for dirpath, dirnames, filenames in os.walk(root):
    dirnames.sort()
    for name in sorted(filenames):
        path = os.path.join(dirpath, name)
        if os.path.islink(path):
            continue
        digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
        print(f"{path}\t{digest}")
PY
}

# --- (a) seat file alone, plus store/raw/emit-record, emits a record ---
STORE_A="$TEST_TMP/store-a"
RAW_A="$TEST_TMP/raw-a"
OUT_A="$TEST_TMP/a.out"
run_q "$OUT_A" implementer --seat-file "$SEAT" \
  --store "$STORE_A" --raw-dir "$RAW_A" --emit-record \
  --dispatch-bin "$STUB"
assert_exit_code "$RUN_RC" "1" "headless implementer with only a seat file finishes a failed exam (exit 1)"
"$NODE_BIN" -e '
const fs = require("fs");
const q = require(process.argv[1]);
const raw = fs.readFileSync(process.argv[2], "utf8").trim();
const lines = raw.split("\n").filter((l) => l.length);
if (lines.length !== 1) { console.error("stdout lines " + lines.length); process.exit(1); }
const rec = JSON.parse(lines[0]);
const v = q.validateRecord(lines[0] + "\n", { semantic: true });
if (v.errors.length) { console.error(JSON.stringify(v.errors)); process.exit(1); }
if (rec.raw.runner_version !== "1.2.3") { console.error("runner " + rec.raw.runner_version); process.exit(1); }
if (rec.raw.family !== "minimax") { console.error("family " + rec.raw.family); process.exit(1); }
' "$REPO_ROOT/scripts/lib/qualification-metrics.js" "$OUT_A"
assert_eq "$?" "0" "emit-record is a valid record with derived runner_version and family"

# --- (b) pins + constants match the sweep plan for the event-331 corpus ---
ROSTER_SRC="$REPO_ROOT/docs/plans/evidence/2026-10-20-minimax-m31-flash-ga-qualify/roster-m31.json"
ROSTER="$TEST_TMP/roster-m31.json"
"$NODE_BIN" -e '
const fs = require("fs");
const src = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const pins = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const impl = pins.roles.implementer;
if (impl.harness_version !== src.corpus.harness_version) process.exit(2);
if (impl.containment_fingerprint !== src.corpus.containment_fingerprint) process.exit(3);
if (impl.task_class.join(",") !== "bounded_implementation") process.exit(4);
if (impl.domain.join(",") !== "repository") process.exit(5);
if (impl.language.join(",") !== "en") process.exit(6);
if (impl.tool.join(",") !== "git_commit") process.exit(7);
fs.writeFileSync(process.argv[3], JSON.stringify(src));
' "$ROSTER_SRC" "$PINS" "$ROSTER"
assert_eq "$?" "0" "pins file matches the event-331 roster corpus and implementer scope"
PLAN="$TEST_TMP/plan.txt"
"$SWEEP" --roster "$ROSTER" --plan >"$PLAN"
assert_contains "$(cat "$PLAN")" "--family minimax" "sweep plan prints the roster family token"
assert_contains "$(cat "$PLAN")" "--harness-version dispatch-hetero:7481ead3" "sweep plan harness"
assert_contains "$(cat "$PLAN")" "--prompt-config-hash $PROMPT_HASH" "sweep plan prompt hash"
assert_contains "$(cat "$PLAN")" "--semantic-fingerprint $SEM_HASH" "sweep plan semantic hash"
assert_contains "$(cat "$PLAN")" "--containment-fingerprint 2c1042fc7187841565fa4c9fafa2f25fa7efda49f0ed911cd0363300e21738fd" "sweep plan containment"
assert_contains "$(cat "$PLAN")" "--task-class bounded_implementation --domain repository --language en --tool git_commit" "sweep plan scope"
grep -q "EXPECTED_IMPL_CORPUS_HASH = '$SEM_HASH'" "$EQJS"
assert_eq "$?" "0" "semantic fingerprint is the implementer constant, not a second literal in the pins file"
grep -q "EXPECTED_IMPL_GENERATOR_HASH = '$PROMPT_HASH'" "$EQJS"
assert_eq "$?" "0" "prompt hash constant matches the event-331 corpus"
PRE_B="$TEST_TMP/preview-b.json"
run_q "$PRE_B" seat-preview --seat-file "$SEAT"
assert_exit_code "$RUN_RC" "0" "seat-preview of the event-331 seat"
"$NODE_BIN" -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const a = doc.argv;
if (a["runner-version"] !== "1.2.3") process.exit(2);
if (a.family !== "minimax") process.exit(3);
if (a["harness-version"] !== "dispatch-hetero:7481ead3") process.exit(4);
if (a["semantic-fingerprint"] !== process.argv[2]) process.exit(5);
if (a["containment-fingerprint"] !== "2c1042fc7187841565fa4c9fafa2f25fa7efda49f0ed911cd0363300e21738fd") process.exit(6);
if (a["task-class"].join(",") !== "bounded_implementation") process.exit(7);
if (a.domain.join(",") !== "repository" || a.language.join(",") !== "en" || a.tool.join(",") !== "git_commit") process.exit(8);
if (a["prompt-config-hash"] !== process.argv[3]) process.exit(9);
' "$PRE_B" "$SEM_HASH" "$PROMPT_HASH"
assert_eq "$?" "0" "derived preview matches the sweep plan flags and the stub version token"

# --- (c) runner resolution failure writes nothing ---
STORE_C="$TEST_TMP/store-c"
RAW_C="$TEST_TMP/raw-c"
mkdir -p "$STORE_C" "$RAW_C"
printf 'kept\n' >"$STORE_C/marker"
printf 'kept\n' >"$RAW_C/marker"
BEFORE_C_S="$(dir_snapshot "$STORE_C")"
BEFORE_C_R="$(dir_snapshot "$RAW_C")"
SEAT_C="$TEST_TMP/seat-codex.json"
"$NODE_BIN" -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.runner="codex"; fs.writeFileSync(process.argv[2], JSON.stringify(s));' "$SEAT" "$SEAT_C"
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID PATH="/usr/bin:/bin" \
  "$NODE_BIN" "$EQJS" implementer --seat-file "$SEAT_C" \
  --store "$STORE_C" --raw-dir "$RAW_C" --emit-record \
  >"$TEST_TMP/c.out" 2>"$TEST_TMP/c.err"
RC_C=$?
set -e
assert_exit_code "$RC_C" "2" "missing runner binary exits 2"
assert_contains "$(cat "$TEST_TMP/c.err")" "runner-version" "failure names runner-version"
assert_eq "$(dir_snapshot "$STORE_C")" "$BEFORE_C_S" "runner failure leaves --store unchanged"
assert_eq "$(dir_snapshot "$RAW_C")" "$BEFORE_C_R" "runner failure leaves --raw-dir unchanged"
assert_eq "$(wc -c <"$TEST_TMP/c.out" | tr -d ' ')" "0" "runner failure prints nothing"

# --- (d) flag precedence ---
PRE_D="$TEST_TMP/preview-d.json"
run_q "$PRE_D" seat-preview --seat-file "$SEAT" \
  --runner-version 9.9.9 --family openai --harness-version dispatch-hetero:override
assert_exit_code "$RUN_RC" "0" "seat-preview with overriding flags"
"$NODE_BIN" -e '
const doc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const a = doc.argv, s = doc.sources;
if (a["runner-version"] !== "9.9.9" || s["runner-version"] !== "flag") process.exit(2);
if (a.family !== "openai" || s.family !== "flag") process.exit(3);
if (a["harness-version"] !== "dispatch-hetero:override" || s["harness-version"] !== "flag") process.exit(4);
if (s["semantic-fingerprint"] !== "derived") process.exit(5);
if (s["containment-fingerprint"] !== "pinned") process.exit(6);
if (s.engine !== "seat" || s.model !== "seat" || s.effort !== "seat") process.exit(7);
' "$PRE_D"
assert_eq "$?" "0" "explicit flags win and are sourced as flag"

# A repeated scope flag overrides the pinned value and is sourced as flag.
PRE_DOM="$TEST_TMP/preview-domain.json"
run_q "$PRE_DOM" seat-preview --seat-file "$SEAT" --domain custom-domain
assert_exit_code "$RUN_RC" "0" "seat-preview with --domain override"
"$NODE_BIN" -e '
const doc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (doc.argv.domain.join(",") !== "custom-domain") process.exit(2);
if (doc.sources.domain !== "flag") process.exit(3);
if (doc.sources["task-class"] !== "pinned") process.exit(4);
' "$PRE_DOM"
assert_eq "$?" "0" "repeated --domain overrides the pins value and source is flag"

# --- (e) seat-preview schema, identity, exits, no writes ---
PRE_E="$TEST_TMP/preview-e.json"
PRE_EJ="$TEST_TMP/preview-e-json.json"
run_q "$PRE_E" seat-preview --seat-file "$SEAT"
run_q "$PRE_EJ" seat-preview --seat-file "$SEAT" --json
cmp -s "$PRE_E" "$PRE_EJ"
assert_eq "$?" "0" "default seat-preview and --json are byte-identical"
"$NODE_BIN" -e '
const doc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const keys = ["engine","model","model-version","runner","runner-version","family","harness-version","effort","prompt-config-hash","semantic-fingerprint","containment-fingerprint","task-class","domain","language","tool"];
for (const k of keys) {
  if (!(k in doc.argv) || !(k in doc.sources)) { console.error("missing " + k); process.exit(1); }
}
for (const k of ["task-class","domain","language","tool"]) {
  if (!Array.isArray(doc.argv[k])) { console.error(k + " not array"); process.exit(1); }
}
const s = doc.sources;
if (s.runner !== "seat" || s["prompt-config-hash"] !== "seat") process.exit(2);
if (s["runner-version"] !== "derived" || s.family !== "derived" || s["semantic-fingerprint"] !== "derived") process.exit(3);
if (s["harness-version"] !== "pinned" || s["containment-fingerprint"] !== "pinned") process.exit(4);
if (s["task-class"] !== "pinned" || s.domain !== "pinned" || s.language !== "pinned" || s.tool !== "pinned") process.exit(5);
if (doc.role !== "implementer") process.exit(6);
' "$PRE_E"
assert_eq "$?" "0" "seat-preview schema keys and sources"
EMPTY="$TEST_TMP/preview-empty"
mkdir -p "$EMPTY"
BEFORE_E="$(dir_snapshot "$EMPTY")"
run_q "$TEST_TMP/missing-preview.out" seat-preview --seat-file "$TEST_TMP/no-such-seat.json"
assert_exit_code "$RUN_RC" "4" "missing seat file on seat-preview exits 4"
printf '{}\n' >"$TEST_TMP/bad-seat.json"
run_q "$TEST_TMP/bad-preview.out" seat-preview --seat-file "$TEST_TMP/bad-seat.json"
assert_exit_code "$RUN_RC" "4" "schema-invalid seat file on seat-preview exits 4"
REV="$TEST_TMP/seat-reviewer.json"
"$NODE_BIN" -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); s.role="reviewer"; s.engine="eng-review"; s.model="eng-review"; fs.writeFileSync(process.argv[2], JSON.stringify(s));' "$SEAT" "$REV"
run_q "$TEST_TMP/role-preview.out" seat-preview --seat-file "$REV"
assert_exit_code "$RUN_RC" "2" "unknown role on seat-preview exits 2"
assert_contains "$(cat "$TEST_TMP/err.txt")" "implementer" "unknown role names the implementer pin"
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID PATH="/usr/bin:/bin" \
  "$NODE_BIN" "$EQJS" seat-preview --seat-file "$SEAT_C" \
  >"$TEST_TMP/derive-preview.out" 2>"$TEST_TMP/err.txt"
RUN_RC=$?
set -e
assert_exit_code "$RUN_RC" "2" "failed derivation on seat-preview exits 2"
assert_contains "$(cat "$TEST_TMP/err.txt")" "runner-version" "seat-preview derivation failure names runner-version"
assert_eq "$(dir_snapshot "$EMPTY")" "$BEFORE_E" "seat-preview writes nothing under a watched directory"
assert_file_absent "$TEST_TMP/no-write-store" "seat-preview does not create a store"

# --- (f) preview equals the administration that just ran ---
"$NODE_BIN" -e '
const fs = require("fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
const pre = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const a = pre.argv;
const id = rec.raw.evidence.identity;
const scope = rec.raw.evidence.scope;
const checks = [
  [rec.raw.runner_version, a["runner-version"], "runner_version"],
  [rec.raw.family, a.family, "family"],
  [rec.raw.harness_version, a["harness-version"], "harness_version"],
  [id.semantic_fingerprint, a["semantic-fingerprint"], "semantic"],
  [id.containment_fingerprint, a["containment-fingerprint"], "containment"],
  [scope.task_classes.join(","), a["task-class"].join(","), "task-class"],
  [scope.domains.join(","), a.domain.join(","), "domain"],
  [scope.languages.join(","), a.language.join(","), "language"],
  [scope.tool_surface.join(","), a.tool.join(","), "tool"],
];
for (const [got, exp, name] of checks) {
  if (got !== exp) { console.error(name + " record=" + got + " preview=" + exp); process.exit(1); }
}
' "$OUT_A" "$PRE_E"
assert_eq "$?" "0" "seat-preview parameters equal the administered record"

# --- (g) vendor tokens beat the generic "flash" class ---
# Named assertion: MiniMax-M3.1-Flash derives minimax (the roster family),
# not google. Every implementer administration.model / administration.family
# pair in references/official-qualification-defaults.json is checked.
# EXIT2_EXCEPTIONS lists pairs headless cannot derive (caller must pass
# --family). An empty list means every implementer row is expected to derive.
# A pair is never skipped silently: it is either an exact match or a named
# exception whose derived result is unknown.
FAMILY_OUT="$TEST_TMP/family-pairs.out"
"$NODE_BIN" -e '
const fs = require("fs");
const { familyOfEngine } = require(process.argv[1]);
const doc = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const EXIT2_EXCEPTIONS = [
  // { model: "<id>", family: "<official family>", reason: "<why --family is required>" },
];
const seen = new Set();
const failures = [];
let compared = 0;
for (const row of doc.defaults) {
  if (!row || row.role !== "implementer" || !row.administration) continue;
  const model = row.administration.model;
  const family = row.administration.family;
  const key = model + "\t" + family;
  if (seen.has(key)) continue;
  seen.add(key);
  compared += 1;
  const derived = familyOfEngine(model);
  const exception = EXIT2_EXCEPTIONS.find((item) => item.model === model && item.family === family);
  if (exception) {
    if (derived !== "unknown") {
      failures.push(model + " is a documented exit-2 exception but derived " + derived);
    } else {
      process.stderr.write("exit-2 exception " + model + " -> pass --family (" + exception.reason + ")\n");
    }
    continue;
  }
  if (derived !== family) {
    failures.push(model + " official=" + family + " derived=" + derived);
  }
}
const named = familyOfEngine("MiniMax-M3.1-Flash");
if (named !== "minimax") {
  failures.push("named MiniMax-M3.1-Flash -> " + named + " (want minimax)");
}
if (compared < 1) failures.push("no implementer rows");
if (failures.length) {
  for (const line of failures) process.stderr.write(line + "\n");
  process.exit(1);
}
process.stdout.write("compared " + compared + " implementer model/family pairs\n");
' "$REPO_ROOT/scripts/lib/stage-write.js" \
  "$REPO_ROOT/references/official-qualification-defaults.json" \
  >"$FAMILY_OUT"
assert_eq "$?" "0" "MiniMax-M3.1-Flash derives minimax and every implementer official pair matches"
assert_contains "$(cat "$FAMILY_OUT")" "compared " "official-pair comparison ran"

# --- missing scope flag is the one named, not always --task-class ---
run_q "$TEST_TMP/scope-flag.out" seat-preview --seat-file "$REV" \
  --family openai --task-class bounded_implementation
assert_exit_code "$RUN_RC" "2" "non-implementer with a missing scope field exits 2"
SCOPE_LINE="$(head -n 1 "$TEST_TMP/err.txt")"
assert_contains "$SCOPE_LINE" "--domain" "first missing scope flag is --domain"
assert_not_contains "$SCOPE_LINE" "--task-class" "the error does not name a scope flag that was passed"

# --- pins file errors name the pins file and the reason, not harness-version ---
"$NODE_BIN" -e '
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPins } = require(process.argv[1]);
function check(label, dir, prepare, needle) {
  prepare(dir);
  let error;
  try { loadPins(dir); } catch (e) { error = e; }
  if (!error) { console.error(label + " did not throw"); process.exit(1); }
  const reason = String(error.reason || error.message);
  const file = path.join(dir, "references", "qualification-headless-pins.json");
  if (!reason.includes(file)) { console.error(label + " reason missing file: " + reason); process.exit(2); }
  if (!reason.includes(needle)) { console.error(label + " reason missing " + needle + ": " + reason); process.exit(3); }
  if (reason.includes("harness-version") || error.field === "harness-version") {
    console.error(label + " names harness-version: " + reason + " field=" + error.field);
    process.exit(4);
  }
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pins-err-"));
const missing = path.join(root, "missing");
fs.mkdirSync(missing);
check("unreadable", missing, () => {}, "missing or unreadable");
const bad = path.join(root, "bad");
fs.mkdirSync(path.join(bad, "references"), { recursive: true });
check("malformed", bad, (dir) => {
  fs.writeFileSync(path.join(dir, "references", "qualification-headless-pins.json"), "{");
}, "not JSON");
const extra = path.join(root, "extra");
fs.mkdirSync(path.join(extra, "references"), { recursive: true });
check("unknown-key", extra, (dir) => {
  fs.writeFileSync(path.join(dir, "references", "qualification-headless-pins.json"),
    JSON.stringify({ note: "n", roles: {}, extra: true }));
}, "unknown key extra");
' "$REPO_ROOT/scripts/lib/headless-seat-derive.js"
assert_eq "$?" "0" "unreadable, malformed, and unknown-key pins errors name the pins file"

finalize_test
