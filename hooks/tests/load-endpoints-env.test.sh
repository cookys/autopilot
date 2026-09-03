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
# Chain lib.sh's cleanup: a bare trap here REPLACES the EXIT trap lib.sh set,
# which silently leaked one TEST_TMP dir per run into the host tmp namespace.
trap 'rm -rf "$WORK"; cleanup_test_tmp' EXIT

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

# ── 14. --init scaffolds a mode-600 stub; idempotent; stub loads nothing ────
initf="$WORK/init/endpoints.env"
out="$(env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$initf" bash "$SH" --init 2>&1)"; ec=$?
assert_exit_code "$ec" 0 "--init exits 0"
assert_file_exists "$initf" "--init created the stub file"
assert_contains "$out" 'created' "--init reports creation"
mode="$(stat -c '%a' "$initf" 2>/dev/null || stat -f '%Lp' "$initf" 2>/dev/null)"
assert_eq "600" "$mode" "--init stub is mode 600"
# idempotent: second --init must NOT clobber and must exit 0
printf '\n# user edit marker\n' >> "$initf"
out2="$(env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$initf" bash "$SH" --init 2>&1)"; ec2=$?
assert_exit_code "$ec2" 0 "--init idempotent exits 0"
assert_contains "$out2" 'already exists' "--init does not clobber an existing file"
assert_contains "$(cat "$initf")" 'user edit marker' "--init preserved the user edit"
# the all-commented stub loads nothing
loadout="$(run_sh "$initf")"
assert_contains "$loadout" 'LOADED=[]' "commented stub loads no vars"

# ── 15. --init copies the tracked canonical template verbatim (single source of truth) ──
TEMPLATE="$REPO_ROOT/scripts/endpoints.env.example"
assert_file_exists "$TEMPLATE" "canonical template scripts/endpoints.env.example exists"
freshf="$WORK/verbatim/endpoints.env"
env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$freshf" bash "$SH" --init >/dev/null 2>&1
if diff -q "$TEMPLATE" "$freshf" >/dev/null 2>&1; then assert_eq ok ok "--init copies the template verbatim"; else fail "--init output differs from the canonical template"; fi
# the tracked template is itself valid: all-commented → loads nothing (copy to 600 so the
# repo file's own perms don't affect the perms gate)
tmplcopy="$WORK/tmpl.env"; cp "$TEMPLATE" "$tmplcopy"; chmod 600 "$tmplcopy"
tmplout="$(run_sh "$tmplcopy")"
assert_contains "$tmplout" 'LOADED=[]' "canonical template loads no vars (all commented)"
assert_contains "$tmplout" 'RC=0' "canonical template parses cleanly"

# ── 16. opt-in per-repo overlay: overlay overrides base (env > overlay > base) ──
OV_REPO="$WORK/ovrepo"; mkdir -p "$OV_REPO"
git -C "$OV_REPO" init -q >/dev/null 2>&1
git -C "$OV_REPO" remote add origin https://example.com/acme.git
OVKEY="$(cd "$OV_REPO" && bash "$SH" --repo-key)"
assert_neq "" "$OVKEY" "repo-key resolves in a git repo with a remote"
mkdir -p "$WORK/ovcreds/endpoints.d"
OVBASE="$WORK/ovcreds/endpoints.env"
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=basetok\nAUTOPILOT_ENDPOINT_MINIMAX_TOKEN=mmbase\n' > "$OVBASE"; chmod 600 "$OVBASE"
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=overlaytok\n' > "$WORK/ovcreds/endpoints.d/$OVKEY.env"; chmod 600 "$WORK/ovcreds/endpoints.d/$OVKEY.env"
ovout="$(cd "$OV_REPO" && env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$OVBASE" bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; echo "GLM=[${AUTOPILOT_ENDPOINT_GLM_TOKEN:-}]"; echo "MM=[${AUTOPILOT_ENDPOINT_MINIMAX_TOKEN:-}]"' 2>&1)"
assert_contains "$ovout" 'GLM=[overlaytok]' "overlay overrides base for the repo's key"
assert_contains "$ovout" 'MM=[mmbase]' "base fills gaps the overlay does not set"

# ── 17. no endpoints.d/ dir ⇒ overlay is a pure no-op (base only, zero behaviour change) ──
mkdir -p "$WORK/noovl"; OVBASE2="$WORK/noovl/endpoints.env"
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=basetok\n' > "$OVBASE2"; chmod 600 "$OVBASE2"
noovlout="$(cd "$OV_REPO" && env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$OVBASE2" bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; echo "GLM=[${AUTOPILOT_ENDPOINT_GLM_TOKEN:-}]"' 2>&1)"
assert_contains "$noovlout" 'GLM=[basetok]' "no endpoints.d dir → overlay no-op (base only)"

# ── 18. a rejected overlay (world-writable) warns but falls through to base; base still loads ──
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=overlaytok\n' > "$WORK/ovcreds/endpoints.d/$OVKEY.env"; chmod 0666 "$WORK/ovcreds/endpoints.d/$OVKEY.env"
ovbad="$(cd "$OV_REPO" && env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$OVBASE" bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; echo "RC=$?"; echo "GLM=[${AUTOPILOT_ENDPOINT_GLM_TOKEN:-}]"' 2>&1)"
assert_contains "$ovbad" 'group/other-writable' "world-writable overlay is refused"
assert_contains "$ovbad" 'GLM=[basetok]' "refused overlay falls through to base"
assert_contains "$ovbad" 'RC=0' "overlay rejection does not fail the base load"

# ── 19. JS twin: repoKey parity with bash + overlay merge ──
JSKEY="$(cd "$OV_REPO" && node -e 'const {repoKey}=require(process.argv[1]);process.stdout.write(String(repoKey(process.cwd())||""))' "$JS")"
assert_eq "$OVKEY" "$JSKEY" "js repoKey() matches bash --repo-key (single source of truth)"
# reset overlay to a valid (600) file for the merge check
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=overlaytok\n' > "$WORK/ovcreds/endpoints.d/$OVKEY.env"; chmod 600 "$WORK/ovcreds/endpoints.d/$OVKEY.env"
jsov="$(cd "$OV_REPO" && node -e '
  const {loadEndpointsEnv}=require(process.argv[1]);
  const env={};
  loadEndpointsEnv({path:process.argv[2], env, cwd:process.cwd(), warn:()=>{}});
  console.log(JSON.stringify({glm:env.AUTOPILOT_ENDPOINT_GLM_TOKEN||"", mm:env.AUTOPILOT_ENDPOINT_MINIMAX_TOKEN||""}));
' "$JS" "$OVBASE")"
assert_contains "$jsov" '"glm":"overlaytok"' "js twin overlay overrides base"
assert_contains "$jsov" '"mm":"mmbase"' "js twin base fills gaps"

# ── 20. FAIL-CLOSED (panel): a rejected base loads NOTHING — not even a valid overlay ──
printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=overlaytok\n' > "$WORK/ovcreds/endpoints.d/$OVKEY.env"; chmod 600 "$WORK/ovcreds/endpoints.d/$OVKEY.env"
chmod 0666 "$OVBASE"   # base becomes world-writable → must be rejected
fc="$(cd "$OV_REPO" && env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$OVBASE" bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; echo "RC=$?"; echo "GLM=[${AUTOPILOT_ENDPOINT_GLM_TOKEN:-}]"' 2>&1)"
assert_contains "$fc" 'RC=1' "rejected base returns rc=1"
assert_contains "$fc" 'GLM=[]' "rejected base loads NOTHING — not even the valid overlay (fail-closed)"
chmod 600 "$OVBASE"

# ── 21. init creates the credential dir mode 700 (panel: not world/group-listable) ──
env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$WORK/initdir/endpoints.env" bash "$SH" --init >/dev/null 2>&1
dmode="$(stat -c '%a' "$WORK/initdir" 2>/dev/null || stat -f '%Lp' "$WORK/initdir" 2>/dev/null)"
assert_eq "700" "$dmode" "init creates the credential dir mode 700"

# ── 22. js twin fails closed when it cannot verify perms (no getuid) — parity with shell ──
f2="$WORK/f2.env"; printf 'AUTOPILOT_ENDPOINT_GLM_TOKEN=x\n' > "$f2"; chmod 600 "$f2"
f2out="$(node -e 'const m=require(process.argv[1]); process.getuid=undefined; const r=m.parseEndpointsFile(process.argv[2],{warn:()=>{}}); console.log(JSON.stringify({rejected:r.rejected,reason:r.reason}))' "$JS" "$f2")"
assert_contains "$f2out" '"rejected":true' "js twin refuses when getuid is unavailable (fail-closed parity)"
# …but an ABSENT base is still a no-op even on no-getuid (absent short-circuits before the perms
# check) — locks in the verified behavior (a re-review misread this as "absent rejects").
f2abs="$(node -e 'const m=require(process.argv[1]); process.getuid=undefined; const r=m.loadEndpointsEnv({path:"/nonexistent/xyz.env",env:{},cwd:"/tmp",warn:()=>{}}); console.log(JSON.stringify(r))' "$JS")"
assert_contains "$f2abs" '"rejected":false' "absent base is a no-op even on no-getuid (not rejected)"

# ── 12. _TRANSPORT is allowlisted (non-secret opt-in) in both twins ──
f="$WORK/transport.env"
printf 'AUTOPILOT_ENDPOINT_Q_URL=http://10.0.0.2\nAUTOPILOT_ENDPOINT_Q_TOKEN=t\nAUTOPILOT_ENDPOINT_Q_TRANSPORT=plaintext-private\nAUTOPILOT_ENDPOINT_Q_TRANSPORTX=nope\n' >"$f"
chmod 600 "$f"
out="$(env -i HOME="$WORK/home" PATH="$PATH" AUTOPILOT_ENDPOINTS_ENV="$f" bash -c '. "'"$SH"'" && autopilot_load_endpoints_env; echo "LOADED=[$AUTOPILOT_ENDPOINTS_LOADED]"; echo "TR=[${AUTOPILOT_ENDPOINT_Q_TRANSPORT:-}]"; echo "TRX=[${AUTOPILOT_ENDPOINT_Q_TRANSPORTX:-}]"' 2>&1)"
assert_contains "$out" 'TR=[plaintext-private]' "bash loader allowlists _TRANSPORT"
assert_contains "$out" 'TRX=[]' "bash loader still rejects near-miss suffixes"
assert_contains "$out" 'LOADED=[AUTOPILOT_ENDPOINT_Q_URL AUTOPILOT_ENDPOINT_Q_TOKEN AUTOPILOT_ENDPOINT_Q_TRANSPORT]' "bash loader LOADED lists _TRANSPORT"
jsout="$(node -e '
  const { loadEndpointsEnv } = require(process.argv[1]);
  const env = {};
  const r = loadEndpointsEnv({ path: process.argv[2], env, warn: () => {} });
  console.log(JSON.stringify({ tr: env.AUTOPILOT_ENDPOINT_Q_TRANSPORT||"", trx: env.AUTOPILOT_ENDPOINT_Q_TRANSPORTX||"" }));
' "$JS" "$f")"
assert_contains "$jsout" '"tr":"plaintext-private"' "js twin allowlists _TRANSPORT"
assert_contains "$jsout" '"trx":""' "js twin rejects near-miss suffixes"

echo "load-endpoints-env: all assertions passed"
