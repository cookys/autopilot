#!/usr/bin/env bash
# config-path-honored.test.sh — BL-0181 guard: hooks and shared libs decide the operator config path
# through scripts/lib/config-path.js, so $AUTOPILOT_CONFIG_FILE wins over $HOME/.autopilot/config.json.
#
# Every case plants a config under a fake HOME that would change the behavior one way and points
# AUTOPILOT_CONFIG_FILE at a different config that changes it the other way; the assertion says the
# behavior followed AUTOPILOT_CONFIG_FILE. A control per case (variable unset) proves the HOME file
# is still honored, so the guard cannot pass by ignoring configs altogether.
# Negative control (shown red, then green, in the BL-0181 change): revert one hook to
# path.join(os.homedir(), '.autopilot', 'config.json') -> its case goes red.
set -uo pipefail
# git-invoking: lib.sh scrubs inherited GIT_* vars (test-identity-guard inventory two).
. "$(dirname "$0")/lib.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"; cleanup_test_tmp' EXIT
H="$SCRATCH/home"; mkdir -p "$H/.autopilot" "$H/.claude"
OTHER="$SCRATCH/other-config.json"

# --- 1. cost-tracker: cache_read_warn_tokens threshold decides whether it warns -----------------
TR="$SCRATCH/transcript.jsonl"
printf '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":1100,"cache_creation_input_tokens":0}}}\n' >"$TR"
ct_stderr() { # <session-suffix> [AUTOPILOT_CONFIG_FILE value; omit = unset]
  local sid="cph-$1"; shift
  printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$sid" "$TR" "$SCRATCH" \
    | env -u AUTOPILOT_CONFIG_FILE -u AUTOPILOT_COST_TRACKER -u AUTOPILOT_COST_TRACKER_CACHE_READ_WARN \
        HOME="$H" TMPDIR="$SCRATCH" CLAUDE_PLUGIN_ROOT="$ROOT" ${1:+AUTOPILOT_CONFIG_FILE="$1"} \
        node "$ROOT/hooks/cost-tracker.js" 2>&1 >/dev/null
}
printf '{"cost_tracker":{"cache_read_warn_tokens":900000000}}\n' >"$H/.autopilot/config.json"   # HOME: never warns
printf '{"cost_tracker":{"cache_read_warn_tokens":1000}}\n' >"$OTHER"                            # OTHER: warns at 1,100
out="$(ct_stderr a "$OTHER")"
case "$out" in *"has read 1,100 cache tokens"*) ok "1: cost-tracker followed AUTOPILOT_CONFIG_FILE (warned)";; *) bad "1: cost-tracker ignored AUTOPILOT_CONFIG_FILE (stderr: $out)";; esac
out="$(ct_stderr b)"
case "$out" in *"has read"*) bad "1c: control: with the variable unset cost-tracker did not use the HOME config";; *) ok "1c: control: variable unset -> HOME config used (no warning)";; esac

# --- 2. session-start: handoff_inject decides whether the handoff is injected -------------------
REPO="$SCRATCH/repo"; mkdir -p "$REPO"
( cd "$REPO" && git init -q -b main && git config user.email t@t && git config user.name t && echo x >f && git add f && git commit -qm init )
write_handoff() {
  mkdir -p "$H/.autopilot/handoff"
  node -e "
    const fs=require('fs'),c=require('crypto'),root=fs.realpathSync(process.argv[1]),dir=process.argv[2];
    const hash=c.createHash('sha1').update(root).digest('hex');
    const body=Buffer.from('# cph handoff');
    fs.writeFileSync(dir+'/'+hash+'.md',body);
    fs.writeFileSync(dir+'/'+hash+'.meta.json',JSON.stringify({repo_root:root,written_at:new Date().toISOString(),session_id:'s',body_bytes:body.length,gen:c.createHash('sha1').update(body).digest('hex')}));
  " "$REPO" "$H/.autopilot/handoff"
}
ss_out() { # [AUTOPILOT_CONFIG_FILE value; omit = unset]
  write_handoff
  printf '{"reason":"clear","cwd":"%s","source":"clear"}' "$REPO" \
    | env -u AUTOPILOT_CONFIG_FILE -u AUTOPILOT_HANDOFF_INJECT HOME="$H" TMPDIR="$SCRATCH" CLAUDE_PLUGIN_ROOT="$ROOT" \
        ${1:+AUTOPILOT_CONFIG_FILE="$1"} node "$ROOT/hooks/session-start.js" 2>/dev/null
}
MARK="machine session snapshot at last /clear"
printf '{"handoff_inject":false}\n' >"$H/.autopilot/config.json"   # HOME: off
printf '{"handoff_inject":true}\n' >"$OTHER"                       # OTHER: on
out="$(ss_out "$OTHER")"
case "$out" in *"$MARK"*) ok "2: session-start followed AUTOPILOT_CONFIG_FILE (handoff injected)";; *) bad "2: session-start ignored AUTOPILOT_CONFIG_FILE (no handoff injected)";; esac
out="$(ss_out)"
case "$out" in *"$MARK"*) bad "2c: control: variable unset but handoff injected despite HOME config off";; *) ok "2c: control: variable unset -> HOME config used (no injection)";; esac
printf '{"handoff_inject":true}\n' >"$H/.autopilot/config.json"   # HOME: on
printf '{}\n' >"$OTHER"                                            # OTHER: off
out="$(ss_out "$OTHER")"
case "$out" in *"$MARK"*) bad "2d: session-start read the HOME config although AUTOPILOT_CONFIG_FILE says off";; *) ok "2d: session-start honored AUTOPILOT_CONFIG_FILE = {} over a HOME config that enables the handoff";; esac

# --- 3. shared opt-in: hooks.<stem> decides isEnabled ---------------------------------------------
optin() { # [AUTOPILOT_CONFIG_FILE value]
  env -u AUTOPILOT_CONFIG_FILE HOME="$H" ${1:+AUTOPILOT_CONFIG_FILE="$1"} \
    node -e "process.stdout.write(String(require(process.argv[1]).isEnabled('cph-probe')))" "$ROOT/hooks/_shared/opt-in.js"
}
printf '{"hooks":{"cph-probe":false}}\n' >"$H/.autopilot/config.json"
printf '{"hooks":{"cph-probe":true}}\n' >"$OTHER"
[ "$(optin "$OTHER")" = "true" ] && ok "3: opt-in followed AUTOPILOT_CONFIG_FILE" || bad "3: opt-in ignored AUTOPILOT_CONFIG_FILE"
[ "$(optin)" = "false" ] && ok "3c: control: variable unset -> HOME config used" || bad "3c: control: HOME config not used"

# --- 4. scripts/lib readers: cost_fuse (brain-spend) and residue (residue-config) ----------------
printf '{"cost_fuse":{"mode":"off"},"residue":{"lease_hours":11}}\n' >"$H/.autopilot/config.json"
printf '{"cost_fuse":{"mode":"block"},"residue":{"lease_hours":22}}\n' >"$OTHER"
lib() { # [AUTOPILOT_CONFIG_FILE value] -> "<fuse mode> <lease_hours>"
  env -u AUTOPILOT_CONFIG_FILE -u AUTOPILOT_COST_FUSE_MODE -u AUTOPILOT_RESIDUE_LEASE_HOURS HOME="$H" ${1:+AUTOPILOT_CONFIG_FILE="$1"} \
    node -e "const b=require(process.argv[1]+'/scripts/lib/brain-spend.js'),r=require(process.argv[1]+'/scripts/lib/residue-config.js');
             process.stdout.write(b.loadCostFuseConfig({home:process.env.HOME}).mode+' '+r.loadResidueConfig({home:process.env.HOME}).lease_hours)" "$ROOT"
}
[ "$(lib "$OTHER")" = "block 22" ] && ok "4: brain-spend + residue-config followed AUTOPILOT_CONFIG_FILE" || bad "4: lib readers ignored AUTOPILOT_CONFIG_FILE (got: $(lib "$OTHER"))"
[ "$(lib)" = "off 11" ] && ok "4c: control: variable unset -> HOME config used" || bad "4c: control: got $(lib)"

# --- 5. session-handoff (writer half of the same handoff_inject switch) -------------------------
REPO2="$SCRATCH/repo2"; mkdir -p "$REPO2"
( cd "$REPO2" && git init -q -b main && git config user.email t@t && git config user.name t && echo v1 >app.txt && git add app.txt && git commit -qm init && echo v2 >app.txt )
TX="$SCRATCH/tx.jsonl"
{ printf '%s\n' '{"type":"user","message":{"content":"do x"}}'; printf '%s\n' '{"type":"user","message":{"content":"do y"}}'; printf '%s\n' '{"type":"user","message":{"content":"and more"}}'; } >"$TX"
sh_wrote() { # [AUTOPILOT_CONFIG_FILE value] -> yes|no: did the hook write a handoff for REPO2
  rm -rf "$H/.autopilot/handoff"
  printf '{"reason":"clear","cwd":"%s","transcript_path":"%s","session_id":"s5"}' "$REPO2" "$TX" \
    | env -u AUTOPILOT_CONFIG_FILE -u AUTOPILOT_HANDOFF_INJECT HOME="$H" TMPDIR="$SCRATCH" CLAUDE_PLUGIN_ROOT="$ROOT" \
        ${1:+AUTOPILOT_CONFIG_FILE="$1"} node "$ROOT/hooks/session-handoff.js" >/dev/null 2>&1
  if ls "$H/.autopilot/handoff/"*.md >/dev/null 2>&1; then echo yes; else echo no; fi
}
printf '{"handoff_inject":false}\n' >"$H/.autopilot/config.json"; printf '{"handoff_inject":true}\n' >"$OTHER"
[ "$(sh_wrote "$OTHER")" = "yes" ] && ok "5: session-handoff followed AUTOPILOT_CONFIG_FILE (handoff written)" || bad "5: session-handoff ignored AUTOPILOT_CONFIG_FILE"
[ "$(sh_wrote)" = "no" ] && ok "5c: control: variable unset -> HOME config used (nothing written)" || bad "5c: control: handoff written despite HOME config off"

# --- 6. dispatch-foreman.sh resolve_tool_cap: foreman_guard.bash_cap -------------------------------
eval "$(sed -n '/^resolve_tool_cap()/,/^}/p' "$ROOT/scripts/dispatch-foreman.sh")"
printf '{"foreman_guard":{"bash_cap":11}}\n' >"$H/.autopilot/config.json"; printf '{"foreman_guard":{"bash_cap":22}}\n' >"$OTHER"
cap() { ( unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP AUTOPILOT_CONFIG_FILE; export HOME="$H"; [ -n "${1:-}" ] && export AUTOPILOT_CONFIG_FILE="$1"; resolve_tool_cap ); }
[ "$(cap "$OTHER")" = "22" ] && ok "6: resolve_tool_cap followed AUTOPILOT_CONFIG_FILE" || bad "6: resolve_tool_cap got $(cap "$OTHER") (want 22)"
[ "$(cap)" = "11" ] && ok "6c: control: variable unset -> HOME config used" || bad "6c: control: got $(cap) (want 11)"

# --- 7. scripts/run-approval.js: status reads and persist writes the file AUTOPILOT_CONFIG_FILE names (BL-0181 follow-up) ---
ra() { # <AUTOPILOT_CONFIG_FILE value or ""> args... ; run under the fake HOME
  local f="$1"; shift
  env -u AUTOPILOT_CONFIG_FILE -u AUTOPILOT_RUN_APPROVAL_MODE HOME="$H" ${f:+AUTOPILOT_CONFIG_FILE="$f"} node "$ROOT/scripts/run-approval.js" "$@"
}
printf '{"run_approval":{"mode":"off"}}\n' >"$H/.autopilot/config.json"      # HOME: off
printf '{"run_approval":{"mode":"ask-once"}}\n' >"$OTHER"                      # OTHER: ask-once
out="$(ra "$OTHER" status)"
case "$out" in *'"mode":"ask-once"'*"$OTHER"*) ok "7: run-approval status followed AUTOPILOT_CONFIG_FILE";; *) bad "7: run-approval status ignored AUTOPILOT_CONFIG_FILE (got: $out)";; esac
out="$(ra "" status)"
case "$out" in *'"mode":"off"'*"$H/.autopilot/config.json"*) ok "7c: control: variable unset -> HOME config used";; *) bad "7c: control: got $out";; esac
HOME_BEFORE="$(cat "$H/.autopilot/config.json")"
PERSIST="$SCRATCH/persist-target.json"; rm -f "$PERSIST"
ra "$PERSIST" persist --mode ask-once >/dev/null 2>&1
if [ -f "$PERSIST" ] && grep -q '"ask-once"' "$PERSIST" && [ "$(cat "$H/.autopilot/config.json")" = "$HOME_BEFORE" ]; then
  ok "7p: run-approval persist wrote the AUTOPILOT_CONFIG_FILE target and left the HOME config alone"
else
  bad "7p: run-approval persist did not write the AUTOPILOT_CONFIG_FILE target (or touched the HOME config)"
fi

# --- 8. scripts/resolve-dispatch-topology.js: topology.exclude_seats comes from the named file ---------------
# A malformed file is a hard error naming its path, so the path actually read is observable.
topo() { # [AUTOPILOT_CONFIG_FILE value] -> "<exit> <stderr>"
  local err rc
  err="$(env -u AUTOPILOT_CONFIG_FILE HOME="$H" ENGINE_SCORECARD_DIR="$SCRATCH/sc" ${1:+AUTOPILOT_CONFIG_FILE="$1"} \
    node "$ROOT/scripts/resolve-dispatch-topology.js" --json --out "$SCRATCH/topology.json" 2>&1 >/dev/null)"; rc=$?
  printf '%s %s' "$rc" "$err"
}
mkdir -p "$SCRATCH/sc"
printf '{}\n' >"$H/.autopilot/config.json"        # HOME: valid
printf '{not json\n' >"$OTHER"                      # OTHER: malformed
out="$(topo "$OTHER")"
case "$out" in "1 Operator config unreadable at $OTHER"*) ok "8: topology followed AUTOPILOT_CONFIG_FILE (rejected the named file)";; *) bad "8: topology ignored AUTOPILOT_CONFIG_FILE (got: ${out:0:200})";; esac
out="$(topo)"
case "$out" in 0*) ok "8c: control: variable unset -> valid HOME config used";; *) bad "8c: control: got ${out:0:200}";; esac

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
