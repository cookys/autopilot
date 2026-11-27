#!/usr/bin/env bash
# resolve-dispatch --data-class transcript: allowlist anthropic/openai/google/xai.
# Denied names, unknown, and endpoints (including local qwen) exit 3.
# RED before the gate: --data-class was an unknown argument (exit 2) and
# scripts/lib/data-class-policy.js did not exist.
# Item ⑤: no AR_ pipeline runner exists yet. assertDataClass is the helper that
# runner will call. A test that a runner bypass fails is deferred until the runner exists.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-dispatch.sh"
POLICY="$REPO_ROOT/scripts/lib/data-class-policy.js"
OVERRIDE_FILE="${OVERRIDE_FILE:-/dev/null/nonexistent}"

run_dc() {
  local stdout_file="$TEST_TMP/dc.out" stderr_file="$TEST_TMP/dc.err"
  local ec=0
  MODEL_ROUTING_CONFIG_OVERRIDE="${OVERRIDE_FILE:-/dev/null/nonexistent}" \
    bash "$SCRIPT" "$@" >"$stdout_file" 2>"$stderr_file" || ec=$?
  DC_OUT="$(cat "$stdout_file")"
  DC_ERR="$(cat "$stderr_file")"
  DC_EC="$ec"
}

# ── role resolves to haiku, the first seat, and the class is generic ────────
OVERRIDE_FILE="/dev/null/nonexistent"
run_dc --role ar-analyst
assert_exit_code "$DC_EC" "0" "ar-analyst resolves"
assert_contains "$DC_OUT" '"model":"haiku"' "ar-analyst model is haiku (first seat)"
assert_not_contains "$DC_OUT" '"table"' "ar-analyst is a legacy role"

run_dc --role ar-analyst --data-class transcript
assert_exit_code "$DC_EC" "0" "haiku transcript allowed"
assert_contains "$DC_OUT" '"model":"haiku"' "allowed resolution still prints haiku"

run_dc --role planner --data-class transcript
assert_exit_code "$DC_EC" "0" "data-class flag works for an existing role"
assert_contains "$DC_OUT" '"model":"sonnet"' "planner resolution unchanged"

# ── ① denied names, including case and prefix aliases, exit 3 ───────────────
deny_one() {
  local name="$1" family="$2"
  run_dc --role ar-analyst --data-class transcript --model "$name"
  assert_exit_code "$DC_EC" "3" "denied $name exit 3"
  assert_contains "$DC_ERR" "data-class transcript: refused" "denied $name names the class"
  assert_contains "$DC_ERR" "family=$family" "denied $name family=$family"
  assert_not_contains "$DC_OUT" '"model"' "denied $name prints no resolution"
}

deny_one "glm-5.3" "zhipu"
deny_one "GLM-5.3" "zhipu"
deny_one "zhipu/glm-5.3" "zhipu"
deny_one "kimi-k2" "moonshot"
deny_one "Kimi-K2" "moonshot"
deny_one "moonshot/kimi-k2" "moonshot"
deny_one "MiniMax-M3" "minimax"
deny_one "MINIMAX-M3" "minimax"
deny_one "abab/MiniMax-M3" "minimax"
deny_one "qwen3-local" "alibaba"
deny_one "QWEN3-LOCAL" "alibaba"
deny_one "Qwen/qwen3-local" "alibaba"
deny_one "deepseek-v4" "deepseek"
deny_one "DeepSeek-V4" "deepseek"
deny_one "vendor/deepseek-v4" "deepseek"
deny_one "qoder-x" "qoder"
deny_one "Qoder-X" "qoder"
deny_one "Qoder/qoder-x" "qoder"

# ── ② unknown exit 3 ─────────────────────────────────────────────────────────
deny_one "unknown" "unknown"
deny_one "mystery-engine" "unknown"

# ── ③ allowed names exit 0 ───────────────────────────────────────────────────
for ok_name in haiku sonnet gpt-6-astra gemini-4-carbon-high grok-4.7 gemini-4-hydrogen-high; do
  run_dc --role ar-analyst --data-class transcript --model "$ok_name"
  assert_exit_code "$DC_EC" "0" "allowed $ok_name"
  assert_not_contains "$DC_ERR" "refused" "allowed $ok_name is not refused"
done

# ── endpoint → model name → family, including local qwen and the example file
run_dc --role ar-analyst --data-class transcript --endpoint qwen_local
assert_exit_code "$DC_EC" "3" "local qwen endpoint exit 3"
assert_contains "$DC_ERR" "endpoint qwen_local" "local qwen names the endpoint"
assert_contains "$DC_ERR" "model=qwen" "local qwen maps to model qwen"
assert_contains "$DC_ERR" "family=alibaba" "local qwen family alibaba"

run_dc --role ar-analyst --data-class transcript --endpoint glm
assert_exit_code "$DC_EC" "3" "glm endpoint exit 3"
assert_contains "$DC_ERR" "family=zhipu" "glm endpoint family zhipu"

run_dc --role ar-analyst --data-class transcript --endpoint QWEN38
assert_exit_code "$DC_EC" "3" "QWEN38 from endpoints.env.example exit 3"
assert_contains "$DC_ERR" "family=alibaba" "QWEN38 family alibaba"

# ── project override cannot send transcript to a denied family ───────────────
OVERRIDE_FILE="$TEST_TMP/routing.md"
printf '%s\n' '| ar-analyst | glm-5.3 | default |' >"$OVERRIDE_FILE"
run_dc --role ar-analyst --data-class transcript
assert_exit_code "$DC_EC" "3" "routing override to glm is still refused"
assert_contains "$DC_ERR" "family=zhipu" "override refusal names zhipu"
OVERRIDE_FILE="/dev/null/nonexistent"

# ── a flag or env knob does not override the deny list ───────────────────────
run_dc --role ar-analyst --data-class transcript --model glm-5.3 --allow-denied
assert_exit_code "$DC_EC" "2" "--allow-denied is not a bypass"
ec=0
MODEL_ROUTING_CONFIG_OVERRIDE="/dev/null/nonexistent" AUTOPILOT_DATA_CLASS_OFF=1 \
  bash "$SCRIPT" --role ar-analyst --data-class transcript --model glm-5.3 \
  >"$TEST_TMP/off.out" 2>"$TEST_TMP/off.err" || ec=$?
assert_exit_code "$ec" "3" "AUTOPILOT_DATA_CLASS_OFF does not allow glm"

# ── policy shape, seat order, and the double lock ────────────────────────────
SHAPE="$(node -e '
const { loadPolicy } = require(process.argv[1]);
const p = loadPolicy();
process.stdout.write([
  p.transcript.mode,
  p.transcript.families.join(","),
  p.deny_families.join(","),
  p.seat_preference.join(","),
].join("|"));
' "$POLICY")"
assert_eq "$SHAPE" "allow|anthropic,openai,google,xai|zhipu,moonshot,minimax,alibaba,deepseek,meituan,qoder|glm-5.3,haiku,sonnet,grok-4.7,gemini-4-carbon-high,gemini-4-neon-high,gemini-4-hydrogen-high,gpt-6-astra" "policy allowlist, deny_families, seat preference"

# ④ Negative control. Dropping qwen from deny_names AND adding alibaba to the
# allowlist makes qwen3-local allowed, so the exit-3 assertion goes red.
# Either edit alone stays refused (both locks are load-bearing).
NC="$(node -e '
const { verdict, loadPolicy } = require(process.argv[1]);
const base = loadPolicy();
const clone = (p) => JSON.parse(JSON.stringify(p));
const dropQwen = (p) => { p.deny_names = p.deny_names.filter((n) => n !== "qwen"); return p; };
const addAli = (p) => { p.transcript.families = p.transcript.families.concat(["alibaba"]); return p; };
const both = verdict("qwen3-local", "", "transcript", addAli(dropQwen(clone(base))));
const onlyQ = verdict("qwen3-local", "", "transcript", dropQwen(clone(base)));
const onlyA = verdict("qwen3-local", "", "transcript", addAli(clone(base)));
if (!both.ok) { console.error("both locks open but still refused: " + both.reason); process.exit(1); }
if (onlyQ.ok) { console.error("removing qwen alone allowed qwen"); process.exit(1); }
if (onlyA.ok) { console.error("allowlisting alibaba alone allowed qwen"); process.exit(1); }
process.stdout.write("red");
' "$POLICY" 2>"$TEST_TMP/nc.err")" || NC="fail:$NC"
assert_eq "$NC" "red" "negative control: qwen denial goes red only when qwen leaves deny and alibaba is allowlisted"

# ⑤ helper the later runner calls. Bypass-fails is deferred (no runner yet).
H="$(node -e '
const { assertDataClass } = require(process.argv[1]);
let refused = false;
try { assertDataClass("qoder-x", "", "transcript"); }
catch (e) { refused = e.code === 3 && /family=qoder/.test(e.message); }
if (!refused) process.exit(1);
const ok = assertDataClass("grok-4.7", "", "transcript");
if (!ok.ok || ok.family !== "xai") process.exit(2);
let local = false;
try { assertDataClass("haiku", "qwen_local", "transcript"); }
catch (e) { local = /endpoint qwen_local/.test(e.message) && /model=qwen/.test(e.message) && /family=alibaba/.test(e.message); }
if (!local) process.exit(3);
process.stdout.write("ok");
' "$POLICY")"
assert_eq "$H" "ok" "assertDataClass refuses qoder and local qwen, allows grok"

finalize_test
