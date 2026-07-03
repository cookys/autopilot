#!/usr/bin/env bash
# Tests for scripts/load-endpoints-env.sh (bash) + scripts/lib/load-endpoints-env.js (node
# twin): the canonical ~/.autopilot/endpoints.env safe-loader. Covers the safety gate
# (symlink / group-other-writable / group-other-readable), the line-parser allowlist,
# NO-code-execution, existing-env precedence, quote-strip, and missing-file no-op.
. "$(dirname "$0")/lib.sh"

SH="$REPO_ROOT/scripts/load-endpoints-env.sh"
JS="$REPO_ROOT/scripts/lib/load-endpoints-env.js"
DR="$REPO_ROOT/scripts/dispatch-review.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# run_sh <envfile> [extra env assignments...] — source the loader against <envfile> in an
# isolated env and print a NON-SECRET-safe (fake values) dump of the resulting env + LOADED
# list. stderr (warnings) is merged so assertions can see them.
run_sh() {
  local envfile="$1"; shift
  env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$envfile" "$@" \
    bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; rc=$?;
      echo "RC=$rc";
      echo "LOADED=[$AUTOPILOT_ENDPOINTS_LOADED]";
      echo "GLM_URL=[${AUTOPILOT_ENDPOINT_GLM_URL:-}]";
      echo "GLM_TOKEN=[${AUTOPILOT_ENDPOINT_GLM_TOKEN:-}]";
      echo "MINIMAX=[${MINIMAX_API_KEY:-}]";
      echo "EVIL=[${EVIL:-}]";
      echo "BASEURL=[${ANTHROPIC_BASE_URL:-}]"' 2>&1
}

# ── 1. happy-path line-parse + allowlist ────────────────────────────
f="$WORK/ok.env"
cat >"$f" <<'EOF'
# a comment
AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example/anthropic

export AUTOPILOT_ENDPOINT_GLM_TOKEN=gtok123
MINIMAX_API_KEY=mmkey
EVIL=should-be-ignored
random junk line without equals
EOF
chmod 600 "$f"
out="$(run_sh "$f")"
assert_contains "$out" 'RC=0' "happy path returns 0"
assert_contains "$out" 'GLM_URL=[https://glm.example/anthropic]' "namespaced URL loaded"
assert_contains "$out" 'GLM_TOKEN=[gtok123]' "namespaced TOKEN loaded (export stripped)"
assert_contains "$out" 'MINIMAX=[mmkey]' "MINIMAX_API_KEY allowlisted"
assert_contains "$out" 'EVIL=[]' "non-allowlisted var ignored"
assert_contains "$out" 'LOADED=[AUTOPILOT_ENDPOINT_GLM_URL AUTOPILOT_ENDPOINT_GLM_TOKEN MINIMAX_API_KEY]' "LOADED lists only allowlisted names"

# ── 2. NO code execution (line-parser, never source) ────────────────
f="$WORK/evil.env"
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=$(touch %s/PWNED)\n' "$WORK" >"$f"
chmod 600 "$f"
out="$(run_sh "$f")"
assert_file_absent "$WORK/PWNED" "command substitution in value is NOT executed"
assert_contains "$out" 'GLM_TOKEN=[$(touch' "value stored literally, not evaluated"

# ── 3. symlink refused (never followed) ─────────────────────────────
real="$WORK/real.env"; printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=viasym\n' >"$real"; chmod 600 "$real"
link="$WORK/link.env"; ln -s "$real" "$link"
out="$(run_sh "$link")"
assert_contains "$out" 'RC=1' "symlink rejected returns 1"
assert_contains "$out" 'refusing symlink' "symlink warning emitted"
assert_contains "$out" 'GLM_TOKEN=[]' "symlink loaded nothing"

# ── 4. group/other-writable refused (injection vector) ──────────────
f="$WORK/writable.env"; printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=wtok\n' >"$f"; chmod 0666 "$f"
out="$(run_sh "$f")"
assert_contains "$out" 'RC=1' "world-writable rejected returns 1"
assert_contains "$out" 'group/other-writable' "writable warning emitted"
assert_contains "$out" 'GLM_TOKEN=[]' "writable loaded nothing"

# ── 5. group/other-readable warns but still loads ───────────────────
f="$WORK/readable.env"; printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=rtok\n' >"$f"; chmod 0644 "$f"
out="$(run_sh "$f")"
assert_contains "$out" 'RC=0' "group-readable still returns 0"
assert_contains "$out" 'group/other-readable' "readable WARNING emitted"
assert_contains "$out" 'GLM_TOKEN=[rtok]' "readable still loads the value"

# ── 6. existing env WINS (file fills gaps only) ─────────────────────
f="$WORK/precedence.env"; printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=fromfile\n' >"$f"; chmod 600 "$f"
out="$(run_sh "$f" AUTOPILOT_ENDPOINT_GLM_TOKEN=fromenv)"
assert_contains "$out" 'GLM_TOKEN=[fromenv]' "pre-set env var not overwritten"
assert_contains "$out" 'LOADED=[]' "overridden var not in LOADED list"

# ── 7. quote strip (one layer) ──────────────────────────────────────
f="$WORK/quoted.env"
cat >"$f" <<'EOF'
AUTOPILOT_ENDPOINT_GLM_URL="https://q.example"
AUTOPILOT_ENDPOINT_GLM_TOKEN='sq-tok'
EOF
chmod 600 "$f"
out="$(run_sh "$f")"
assert_contains "$out" 'GLM_URL=[https://q.example]' "double quotes stripped"
assert_contains "$out" 'GLM_TOKEN=[sq-tok]' "single quotes stripped"

# ── 8. missing file is a silent no-op success ───────────────────────
out="$(run_sh "$WORK/does-not-exist.env")"
assert_contains "$out" 'RC=0' "missing file returns 0"
assert_contains "$out" 'LOADED=[]' "missing file loads nothing"
assert_not_contains "$out" 'refusing' "missing file emits no warning"

# ── 9. executed directly: --help exits 0 ────────────────────────────
out="$(env -i HOME="$WORK/home" PATH="$PATH" bash "$SH" --help)"; ec=$?
assert_exit_code "$ec" 0 "--help exits 0"
assert_contains "$out" 'load-endpoints-env' "--help prints doc"

# ── 10. node twin parity: allowlist + no-exec + precedence ──────────
f="$WORK/js.env"
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=jstok\nEVIL=nope\nMINIMAX_API_KEY=$(touch %s/JSPWNED)\n' "$WORK" >"$f"
chmod 600 "$f"
jsout="$(node -e '
  const { loadEndpointsEnv } = require(process.argv[1]);
  const env = { AUTOPILOT_ENDPOINT_GLM_URL: "preset" };
  const r = loadEndpointsEnv({ path: process.argv[2], env, warn: () => {} });
  console.log(JSON.stringify({ loaded: r.loaded, rej: r.rejected,
    tok: env.AUTOPILOT_ENDPOINT_GLM_TOKEN||"", url: env.AUTOPILOT_ENDPOINT_GLM_URL||"",
    evil: env.EVIL||"", mm: env.MINIMAX_API_KEY||"" }));
' "$JS" "$f")"
assert_file_absent "$WORK/JSPWNED" "js twin does not execute value command-substitution"
assert_contains "$jsout" '"tok":"jstok"' "js twin loads allowlisted token"
assert_contains "$jsout" '"url":"preset"' "js twin honors existing-env precedence"
assert_contains "$jsout" '"evil":""' "js twin ignores non-allowlisted var"
assert_contains "$jsout" '"mm":"$(touch' "js twin stores value literally"

# ── 11. node twin: symlink rejected ─────────────────────────────────
jsout="$(node -e '
  const { loadEndpointsEnv } = require(process.argv[1]);
  const r = loadEndpointsEnv({ path: process.argv[2], env: {}, warn: () => {} });
  console.log(JSON.stringify(r));
' "$JS" "$link")"
assert_contains "$jsout" '"rejected":true' "js twin rejects symlink"

# ── 12. integration: dispatch-review cc-shim reads creds from the file ──
# A token present ONLY in endpoints.env (unset in the shell) must satisfy the cc-shim
# ANTHROPIC_BASE_URL/AUTH_TOKEN precondition — proving the dispatcher loads the file.
f="$WORK/ccshim.env"
cat >"$f" <<'EOF'
ANTHROPIC_BASE_URL=https://compat.example/anthropic
ANTHROPIC_AUTH_TOKEN=shimtok
EOF
chmod 600 "$f"
printf 'diff --git a/x b/x\n' >"$WORK/d.diff"
out="$(env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$f" \
  bash "$DR" --runner cc-shim --model test --diff-file "$WORK/d.diff" --bin /nonexistent/claude 2>&1)"; ec=$?
assert_not_contains "$out" 'requires ANTHROPIC_BASE_URL' "loader populated base-url from file (precondition passed)"
assert_not_contains "$out" 'requires ANTHROPIC_AUTH_TOKEN' "loader populated token from file (precondition passed)"

# ── 13. set -u + unset HOME must not crash (env -i regression) ──────
# A dispatcher runs under `set -uo pipefail`; with HOME unset the loader must no-op cleanly,
# not abort the whole script on an unbound-variable fatal.
out="$(env -i PATH="$PATH" bash -c 'set -uo pipefail; . "'"$SH"'" && autopilot_load_endpoints_env; echo "RC=$?"' 2>&1)"
assert_contains "$out" 'RC=0' "set -u + unset HOME → clean no-op (no unbound-variable crash)"
assert_not_contains "$out" 'unbound variable' "no unbound-variable error under set -u"

echo "load-endpoints-env: all assertions passed"
