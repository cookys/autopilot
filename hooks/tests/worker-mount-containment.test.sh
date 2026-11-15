#!/usr/bin/env bash
# Worker mount isolation (01M7E4JC): a dispatched worker must never be able to change the HOST mount
# table (cuda lost /sys/fs/cgroup when a lane ran `mount --rbind /sys` then `umount -l`).
# SAFETY: shim cases never run real sudo/mount/umount/unshare. The real sudo_private_ns case runs
# only when `sudo -n true` succeeds (otherwise it prints SKIP real-sudo-ns), touches only a scratch
# dir under TEST_TMP, and umounts that dir from a trap. It never touches /sys or any host path.
. "$(dirname "$0")/lib.sh"

# eq <expected> <actual> <label>: lib.sh assert_eq takes (actual expected label)
eq() { assert_eq "$2" "$1" "$3"; }
LIB="$REPO_ROOT/scripts/lib/worker-containment.sh"
LINE_TAIL='(01M7E4JC) — fix: run the dispatch inside a private mount namespace created as root then drop privileges, or dispatch from an account without sudo'

SHIMS="$TEST_TMP/shims"; mkdir -p "$SHIMS"
mkshim() { printf '#!/bin/sh\n%s\n' "$2" > "$SHIMS/$1"; chmod +x "$SHIMS/$1"; }
rmshim() { rm -f "$SHIMS/$1"; }
STATUS0="$TEST_TMP/status0"; printf 'Name:\tx\nCapEff:\t0000000000000000\n' > "$STATUS0"
STATUS_ADMIN="$TEST_TMP/status-admin"; printf 'Name:\tx\nCapEff:\t0000000000200000\n' > "$STATUS_ADMIN"

# detect <label-env...> : prints "MODE|reason" using the shims first on PATH.
detect() {
  env "$@" PATH="$SHIMS:$PATH" bash -c '. "$1"; worker_mount_isolation_detect; printf "%s|%s" "$WORKER_MOUNT_MODE" "$WORKER_MOUNT_REASON"' _ "$LIB"
}

echo "== detect: layered decision =="
mkshim unshare 'exit 0'; mkshim sudo 'exit 1'
eq "private_ns" "$(detect WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "unshare shim ok -> private_ns"

mkshim unshare 'exit 1'; mkshim sudo 'exit 1'
eq "no_root" "$(detect WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "uid!=0, sudo fails, no CAP_SYS_ADMIN, no private ns -> no_root"
eq "refuse" "$(detect WORKER_MOUNT_PROC_STATUS="$STATUS0" WORKER_MOUNT_NO_ROOT_OK=0 | cut -d'|' -f1)" "WORKER_MOUNT_NO_ROOT_OK=0 turns no_root into refuse"
eq "refuse" "$(detect WORKER_MOUNT_PROC_STATUS="$STATUS_ADMIN" | cut -d'|' -f1)" "uid!=0, sudo fails, but CapEff has bit 21 -> refuse"
assert_contains "$(detect WORKER_MOUNT_PROC_STATUS="$STATUS_ADMIN")" "CAP_SYS_ADMIN" "cap refuse names CAP_SYS_ADMIN"

mkshim unshare 'exit 1'; mkshim sudo 'exit 0'
eq "refuse" "$(detect WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "sudo shim ok + unshare fails -> refuse"
mkshim unshare 'exit 1'; mkshim sudo 'exit 1'; mkshim id 'echo 0'
eq "refuse" "$(detect WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "euid 0 + unshare fails -> refuse"
rmshim id
mkshim unshare 'exit 0'; mkshim id 'echo 0'
PFX0="$(env PATH="$SHIMS:$PATH" bash -c '. "$1"; worker_mount_isolation_detect; echo "${WORKER_MOUNT_PREFIX[*]}"' _ "$LIB")"
assert_contains "$PFX0" "-m --propagation private --" "root prefix is plain unshare -m"
assert_not_contains "$PFX0" "--user" "root prefix has no user namespace"
rmshim id
PFX="$(env PATH="$SHIMS:$PATH" bash -c '. "$1"; worker_mount_isolation_detect; echo "${WORKER_MOUNT_PREFIX[*]}"' _ "$LIB")"
assert_contains "$PFX" "--user --map-current-user --mount --propagation private --" "non-root prefix maps the current user"
eq "no_root" "$(detect WORKER_MOUNT_FORCE_MODE=no_root | cut -d'|' -f1)" "force no_root"
eq "refuse" "$(detect WORKER_MOUNT_FORCE_MODE=refuse | cut -d'|' -f1)" "force refuse"
eq "sudo_private_ns" "$(detect WORKER_MOUNT_FORCE_MODE=sudo_private_ns | cut -d'|' -f1)" "force sudo_private_ns"

echo "== detect: sudo_private_ns =="
# Smart shims. id answers numeric uid/gid and a fixed name. sudo execs the argv after `--`
# unless an argument's basename is unshare and SUDO_SHIM_FAIL_UNSHARE=1.
# unshare fails the unprivileged --user form and otherwise execs the tail (unused by the sudo probe,
# which stops at `-- true`). setpriv execs the tail after `--`.
MINBIN="$TEST_TMP/minbin"; mkdir -p "$MINBIN"
ln -s "$(command -v bash)" "$MINBIN/bash"
ln -s "$(command -v sed)" "$MINBIN/sed"
ln -s "$(command -v id)" "$MINBIN/id"
ln -s "$(command -v head)" "$MINBIN/head"
# `command -v true` is the shell builtin, so a symlink of that name loops. Use the binary.
if [ -x /usr/bin/true ]; then ln -s /usr/bin/true "$MINBIN/true"; else ln -s /bin/true "$MINBIN/true"; fi
ln -s "$(command -v env)" "$MINBIN/env"
REAL_BASH="$(command -v bash)"
mkshim id 'case "$1" in -u) echo 4242 ;; -g) echo 4343 ;; -un) echo worker ;; *) echo 4242 ;; esac'
# Clobber the way standard sudoers does: secure_path, set_logname, always_set_home, SUDO_USER.
mkshim sudo 'if [ "${SUDO_SHIM_FAIL_UNSHARE:-}" = 1 ]; then
  for a in "$@"; do b="${a##*/}"; [ "$b" = unshare ] && exit 1; done
fi
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export USER=root
export LOGNAME=root
export HOME=/root
export SUDO_USER=x
while [ $# -gt 0 ]; do
  if [ "$1" = "--" ]; then shift; [ $# -eq 0 ] && exit 0; exec "$@"; fi
  shift
done
exit 0'
mkshim unshare 'for a in "$@"; do [ "$a" = "--user" ] && exit 1; done
while [ $# -gt 0 ]; do
  if [ "$1" = "--" ]; then shift; [ $# -eq 0 ] && exit 0; exec "$@"; fi
  shift
done
exit 0'
mkshim setpriv 'while [ $# -gt 0 ]; do
  if [ "$1" = "--" ]; then shift; [ $# -eq 0 ] && exit 0; exec "$@"; fi
  shift
done
exit 1'
# PATH is shims + minbin only, so a real sudo/unshare/setpriv cannot answer.
SUDO_PATH="$SHIMS:$MINBIN"
ENV_BIN="$(PATH="$SUDO_PATH" command -v env)"
detect_sudo() {
  env USER=worker LOGNAME=not-the-user PATH="$SUDO_PATH" HOME="${HOME-}" "$@" bash -c '. "$1"; worker_mount_isolation_detect; printf "%s|%s" "$WORKER_MOUNT_MODE" "$WORKER_MOUNT_REASON"' _ "$LIB"
}
prefix_sudo() {
  env USER=worker LOGNAME=not-the-user PATH="$SUDO_PATH" HOME="${HOME-}" "$@" bash -c '. "$1"; worker_mount_isolation_detect; printf "%s" "${WORKER_MOUNT_PREFIX[*]}"' _ "$LIB"
}
cat > "$TEST_TMP/check-inside.sh" << 'EOF'
#!/bin/bash
want_path="$1"; want_home="$2"; want_user="$3"
[ "$PATH" = "$want_path" ] || { printf 'PATH=%s\n' "$PATH"; exit 5; }
[ "$HOME" = "$want_home" ] || { printf 'HOME=%s\n' "$HOME"; exit 6; }
[ "$USER" = "$want_user" ] || { printf 'USER=%s\n' "$USER"; exit 7; }
[ "$LOGNAME" = "$want_user" ] || { printf 'LOGNAME=%s\n' "$LOGNAME"; exit 8; }
if env | grep -q '^SUDO_'; then env | grep '^SUDO_'; exit 9; fi
exit 0
EOF
cat > "$TEST_TMP/run-inside.sh" << 'EOF'
#!/bin/bash
lib="$1"; bashbin="$2"; check="$3"; want_path="$4"; want_home="$5"; want_user="$6"
# shellcheck disable=SC1090
. "$lib"
worker_mount_isolation_detect
[ "$WORKER_MOUNT_MODE" = sudo_private_ns ] || { printf 'mode=%s\n' "$WORKER_MOUNT_MODE"; exit 4; }
exec "${WORKER_MOUNT_PREFIX[@]}" "$bashbin" "$check" "$want_path" "$want_home" "$want_user"
EOF
chmod +x "$TEST_TMP/check-inside.sh" "$TEST_TMP/run-inside.sh"
run_inside() { # <lib> <path> <home> <user>
  local lib="$1" want_path="$2" want_home="$3" want_user="$4" name
  while IFS= read -r name; do
    [ -n "$name" ] && unset "$name"
  done < <(env | sed -n 's/^\(SUDO_[A-Za-z0-9_]*\)=.*/\1/p')
  env -u SUDO_USER -u SUDO_UID -u SUDO_GID -u SUDO_COMMAND -u SUDO_HOME \
    PATH="$want_path" HOME="$want_home" USER="$want_user" LOGNAME="not-the-user" \
    WORKER_MOUNT_PROC_STATUS="$STATUS0" \
    bash "$TEST_TMP/run-inside.sh" "$lib" "$REAL_BASH" "$TEST_TMP/check-inside.sh" \
      "$want_path" "$want_home" "$want_user"
}
mkshim unshare 'exit 0'
eq "private_ns" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "userns ok -> private_ns even if sudo would succeed"
mkshim unshare 'for a in "$@"; do [ "$a" = "--user" ] && exit 1; done
while [ $# -gt 0 ]; do
  if [ "$1" = "--" ]; then shift; [ $# -eq 0 ] && exit 0; exec "$@"; fi
  shift
done
exit 0'
ENV_RESTORE="$ENV_BIN -u SUDO_USER -u SUDO_UID -u SUDO_GID -u SUDO_COMMAND -u SUDO_HOME PATH=$SUDO_PATH HOME=$HOME USER=worker LOGNAME=worker"
SETPRIV_PFX="$SHIMS/sudo -n --preserve-env $SHIMS/unshare --mount --propagation private -- $SHIMS/setpriv --reuid=4242 --regid=4343 --init-groups -- $ENV_RESTORE"
eq "sudo_private_ns" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "userns blocked + sudo + unshare probe ok -> sudo_private_ns"
eq "$SETPRIV_PFX" "$(prefix_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0")" "sudo_private_ns prefix is sudo unshare setpriv env"
INSIDE_OUT="$(run_inside "$LIB" "$SUDO_PATH" "$HOME" worker 2>&1)"; INSIDE_RC=$?
eq "0" "$INSIDE_RC" "setpriv form: inside PATH HOME USER LOGNAME are the dispatcher's and no SUDO_* (${INSIDE_OUT:-ok})"
SPACED="$SUDO_PATH:/tmp/space dir"
SP_OUT="$(run_inside "$LIB" "$SPACED" "$HOME" worker 2>&1)"; SP_RC=$?
eq "0" "$SP_RC" "PATH with a space survives as one argv (${SP_OUT:-ok})"
# Negative control: drop the env step. The sudo shim still clobbers, so the probe refuses.
MUT_ENV="$TEST_TMP/worker-containment.no-env.sh"
sed_mutant "$LIB" "$MUT_ENV" '/_worker_mount_append_dispatcher_env prefix "\$disp_path" "\$home" "\$disp_user" || return 1/d'
NEG_ENV_OUT="$(run_inside "$MUT_ENV" "$SUDO_PATH" "$HOME" worker 2>&1)"; NEG_ENV_RC=$?
eq "4" "$NEG_ENV_RC" "negative control red: without the env step the dispatcher env is not held (${NEG_ENV_OUT:-no-output})"
REST_OUT="$(run_inside "$LIB" "$SUDO_PATH" "$HOME" worker 2>&1)"; REST_RC=$?
eq "0" "$REST_RC" "restored env step holds the dispatcher env (${REST_OUT:-ok})"
mkshim env 'while [ $# -gt 0 ]; do
  case "$1" in
    -u) shift 2 ;;
    -*) shift ;;
    *=*) shift ;;
    *) exec "$@" ;;
  esac
done
exit 1'
eq "refuse" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "ineffective env step (PATH still clobbered) -> refuse"
rmshim env
eq "sudo_private_ns" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "real env after the ineffective shim -> sudo_private_ns"
# Newline sits in a later PATH component so `env` is still resolvable; the value itself is what must refuse.
NL_PATH="$SUDO_PATH:/ok"$'\n'"x"
NL_MODE="$(PATH="$NL_PATH" HOME="${HOME-}" USER=worker WORKER_MOUNT_PROC_STATUS="$STATUS0" "$REAL_BASH" -c '. "$1"; worker_mount_isolation_detect; printf "%s" "$WORKER_MOUNT_MODE"' _ "$LIB")"
eq "refuse" "$NL_MODE" "PATH containing a newline is refused"
NLH_MODE="$(env USER=worker PATH="$SUDO_PATH" HOME=$'/tmp/ho\nme' WORKER_MOUNT_PROC_STATUS="$STATUS0" bash -c '. "$1"; worker_mount_isolation_detect; printf "%s" "$WORKER_MOUNT_MODE"' _ "$LIB")"
eq "refuse" "$NLH_MODE" "HOME containing a newline is refused"
# Negative control: a copy that skips the sudo_private_ns attempt must go red on this same shim case.
MUT="$TEST_TMP/worker-containment.skip-sudo.sh"
sed_mutant "$LIB" "$MUT" 's/if _worker_mount_try_sudo_private_ns; then/if false; then/'
NEG="$(env PATH="$SUDO_PATH" HOME="${HOME-}" WORKER_MOUNT_PROC_STATUS="$STATUS0" bash -c '. "$1"; worker_mount_isolation_detect; printf "%s" "$WORKER_MOUNT_MODE"' _ "$MUT")"
if [ "$NEG" = "sudo_private_ns" ]; then
  fail "negative control stayed green: skipping sudo_private_ns still returned sudo_private_ns"
else
  eq "refuse" "$NEG" "negative control red: detection that skips sudo_private_ns refuses the shim case"
fi
eq "sudo_private_ns" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "restored detection returns sudo_private_ns"
rmshim setpriv
FALLBACK_PFX="$SHIMS/sudo -n --preserve-env $SHIMS/unshare --mount --propagation private -- $SHIMS/sudo -n -E -u worker -- $ENV_RESTORE"
eq "sudo_private_ns" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "setpriv missing -> sudo -u fallback still sudo_private_ns"
eq "$FALLBACK_PFX" "$(prefix_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0")" "setpriv missing prefix drops with sudo -n -E -u then env"
FB_OUT="$(run_inside "$LIB" "$SUDO_PATH" "$HOME" worker 2>&1)"; FB_RC=$?
eq "0" "$FB_RC" "sudo -u fallback: inside PATH HOME USER LOGNAME are the dispatcher's and no SUDO_* (${FB_OUT:-ok})"
SUDO_SHIM_FAIL_UNSHARE=1
eq "refuse" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" SUDO_SHIM_FAIL_UNSHARE=1 | cut -d'|' -f1)" "unshare probe fails -> refuse"
assert_contains "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" SUDO_SHIM_FAIL_UNSHARE=1)" "passwordless sudo is available" "probe failure keeps the old refuse reason"
unset SUDO_SHIM_FAIL_UNSHARE
mkshim unshare 'exit 1'
mkshim id 'echo 0'
eq "refuse" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "root dispatcher -> refuse even when sudo would succeed"
assert_contains "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0")" "dispatcher runs as root" "root refuse names root"
rmshim id
rmshim sudo
eq "no_root" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "no sudo binary -> no_root"
mkshim sudo 'exit 1'
eq "no_root" "$(detect_sudo WORKER_MOUNT_PROC_STATUS="$STATUS0" | cut -d'|' -f1)" "sudo -n true fails -> no_root"

echo "== brief gate =="
gate_rc() { # <mode> <file>
  env WORKER_MOUNT_FORCE_MODE="$1" bash -c '. "$1"; worker_mount_isolation_detect; worker_mount_brief_gate "$2"' _ "$LIB" "$2" >/dev/null 2>"$TEST_TMP/gate.err"
  echo $?
}
printf 'amount of mountpoints\n' > "$TEST_TMP/brief-amount.txt"
printf 'note\nmount --rbind /sys /x\n' > "$TEST_TMP/brief-mount.txt"
printf 'umount -l /mnt\n' > "$TEST_TMP/brief-umount.txt"
printf 'unshare --mount\n' > "$TEST_TMP/brief-unshare.txt"
eq "0" "$(gate_rc no_root "$TEST_TMP/brief-amount.txt")" "amount of mountpoints is allowed under no_root"
eq "0" "$(gate_rc refuse "$TEST_TMP/brief-amount.txt")" "amount of mountpoints is allowed under refuse"
eq "1" "$(gate_rc no_root "$TEST_TMP/brief-mount.txt")" "no_root + mount command is refused"
eq "mount_brief_refused: mount at line 2 (01M7E4JC)" "$(cat "$TEST_TMP/gate.err")" "gate names the word and line"
eq "1" "$(gate_rc refuse "$TEST_TMP/brief-mount.txt")" "refuse mode + mount command is refused"
eq "1" "$(gate_rc no_root "$TEST_TMP/brief-umount.txt")" "umount command is refused"
eq "1" "$(gate_rc no_root "$TEST_TMP/brief-unshare.txt")" "unshare command is refused"
eq "0" "$(gate_rc sudo_private_ns "$TEST_TMP/brief-mount.txt")" "same mount brief is allowed under sudo_private_ns"
eq "0" "$(gate_rc private_ns "$TEST_TMP/brief-mount.txt")" "mount brief is allowed under private_ns"
# Empty WORKER_MOUNT_MODE must detect. Shims decide the mode; FORCE_MODE stays unset.
unset_gate() { # <lib> <file>
  env -u WORKER_MOUNT_MODE -u WORKER_MOUNT_FORCE_MODE \
    PATH="$SHIMS:$PATH" WORKER_MOUNT_PROC_STATUS="$STATUS0" \
    bash -c 'unset WORKER_MOUNT_MODE WORKER_MOUNT_FORCE_MODE
      . "$1"
      worker_mount_brief_gate "$2" >/dev/null 2>"$3"
      printf "%s|%s" "$?" "${WORKER_MOUNT_MODE-}"' _ "$1" "$2" "$TEST_TMP/gate-unset.err"
}
mkshim unshare 'exit 0'
mkshim sudo 'exit 1'
eq "0|private_ns" "$(unset_gate "$LIB" "$TEST_TMP/brief-mount.txt")" "unset mode + private_ns shim allows the mount brief"
mkshim unshare 'exit 1'
eq "1|no_root" "$(unset_gate "$LIB" "$TEST_TMP/brief-mount.txt")" "unset mode + no_root shim refuses the mount brief"
eq "mount_brief_refused: mount at line 2 (01M7E4JC)" "$(cat "$TEST_TMP/gate-unset.err")" "unset no_root gate names the word and line"
mkshim unshare 'exit 0'
MUT_GATE="$TEST_TMP/worker-containment.no-detect.sh"
sed_mutant "$LIB" "$MUT_GATE" '/^  \[ -n "\${WORKER_MOUNT_MODE:-}" \] || worker_mount_isolation_detect$/d'
eq "1|" "$(unset_gate "$MUT_GATE" "$TEST_TMP/brief-mount.txt")" "negative control red: gate without detect refuses an unset mode"
eq "0|private_ns" "$(unset_gate "$LIB" "$TEST_TMP/brief-mount.txt")" "restored gate detects private_ns and allows the brief"
rmshim unshare; rmshim sudo; rmshim setpriv; rmshim id

echo "== rail: foreman refuse never starts the worker =="
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" init -q -b develop; git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
echo brief > "$TEST_TMP/brief.md"; echo plan > "$TEST_TMP/plan.md"
MARK_F="$TEST_TMP/foreman.ran"
cat > "$TEST_TMP/kimi" <<EOF
#!/usr/bin/env bash
echo ran > "$MARK_F"
exit 0
EOF
chmod +x "$TEST_TMP/kimi"
OUT_F="$(cd "$SBX" && AUTOPILOT_TEST_CN_GATE_OFF=1 WORKER_MOUNT_FORCE_MODE=refuse bash "$REPO_ROOT/scripts/dispatch-foreman.sh" --brief-file "$TEST_TMP/brief.md" --plan-file "$TEST_TMP/plan.md" \
  --run-id mnt1 --run-dir "$TEST_TMP/runs/mnt1" --timeout 20 --kimi-bin "$TEST_TMP/kimi" 2>"$TEST_TMP/foreman.err" < /dev/null)"; RC_F=$?
[ "$RC_F" -ne 0 ] && eq ok ok "foreman refuse exits non-zero" || fail "foreman refuse exited 0"
assert_file_absent "$MARK_F" "foreman worker never ran under refuse"
eq "mount_containment_unavailable: forced by WORKER_MOUNT_FORCE_MODE $LINE_TAIL" "$(head -n1 "$TEST_TMP/foreman.err")" "foreman stderr line exact"

echo "== rail: hetero refuse / no_root / private_ns =="
HSTUB="$TEST_TMP/grok-stub"
cat > "$HSTUB" <<'EOF'
#!/usr/bin/env bash
case " $* " in *" __autopilot_probe__ "*) echo "Error: unknown effort level '__autopilot_probe__'; use one of: high, medium, low" >&2; exit 1 ;; esac
[ "${1:-}" = "--list-models" ] && { echo "Available models"; exit 0; }
[ -n "${MNT_MARK:-}" ] && echo ran > "$MNT_MARK"
exit 0
EOF
chmod +x "$HSTUB"
echo "create ok.txt" > "$TEST_TMP/prompt.txt"
export AUTOPILOT_GROK_EFFORT_PROBE=0 AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/sm"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"; mkdir -p "$ENGINE_CAPABILITY_DIR"
hetero_run() { # <tag> [env...] ; sets H_RC H_ERR RUNS MARK
  local tag="$1"; shift
  RUNS="$TEST_TMP/runs-$tag"; MARK="$TEST_TMP/mark-$tag"; mkdir -p "$RUNS"
  (cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" MNT_MARK="$MARK" "$@" \
    bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --no-verify-tip --runner grok --model grok-4.5 --effort high --grok-bin "$HSTUB" \
    --branch "feat/mnt-$tag" --prompt-file "$TEST_TMP/prompt.txt" --timeout 60s >"$TEST_TMP/h-$tag.out" 2>"$TEST_TMP/h-$tag.err" < /dev/null)
  H_RC=$?
}
manifest_field() { cat "$RUNS"/*.manifest.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]])}catch(e){console.log("")}})' "$1"; }

hetero_run refuse WORKER_MOUNT_FORCE_MODE=refuse
[ "$H_RC" -ne 0 ] && eq ok ok "hetero refuse exits non-zero" || fail "hetero refuse exited 0"
assert_file_absent "$MARK" "hetero worker never ran under refuse"
eq "mount_containment_unavailable: forced by WORKER_MOUNT_FORCE_MODE $LINE_TAIL" "$(grep '^mount_containment_unavailable' "$TEST_TMP/h-refuse.err" | head -n1)" "hetero stderr line exact"
eq "refused" "$(manifest_field mount_containment)" "hetero refuse manifest records refused"

hetero_run norootcase WORKER_MOUNT_FORCE_MODE=no_root
assert_file_exists "$MARK" "hetero worker ran under no_root"
eq "no_root" "$(manifest_field mount_containment)" "hetero manifest records no_root"

# private_ns through a pass-through unshare shim: the worker must be launched THROUGH the prefix.
mkshim unshare 'echo "$@" > "'"$TEST_TMP"'/unshare.argv"; while [ "$1" != -- ]; do shift; done; shift; exec "$@"'
hetero_run priv PATH="$SHIMS:$PATH"
assert_file_exists "$MARK" "hetero worker ran under private_ns"
eq "private_ns" "$(manifest_field mount_containment)" "hetero manifest records private_ns"
assert_contains "$(cat "$TEST_TMP/unshare.argv" 2>/dev/null)" "--propagation private" "worker was launched through the unshare prefix"

echo "== rail: author, every runner launch path (refuse blocks, private_ns wraps) =="
AHOME="$TEST_TMP/ahome"; mkdir -p "$AHOME/.claude"; echo '{}' > "$AHOME/.claude/.credentials.json"
echo "author brief" > "$TEST_TMP/aprompt.txt"
ASTUB="$TEST_TMP/author-stub"
cat > "$ASTUB" <<'EOF2'
#!/usr/bin/env bash
[ -n "${MNT_MARK:-}" ] && echo ran >> "$MNT_MARK"
cat >/dev/null 2>&1 || true
echo "OK-WRITTEN"
exit 0
EOF2
chmod +x "$ASTUB"
mkdir -p "$TEST_TMP/abin"; ln -sf "$ASTUB" "$TEST_TMP/abin/kimi"
author_run() { # <tag> <env words...> -- <runner args...>
  local tag="$1"; shift
  local -a envs=(); while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  A_RUNS="$TEST_TMP/runs-a-$tag"; A_MARK="$TEST_TMP/mark-a-$tag"; mkdir -p "$A_RUNS"; rm -f "$A_MARK"
  env HOME="$AHOME" AUTOPILOT_DISPATCH_RUNS_DIR="$A_RUNS" MNT_MARK="$A_MARK" DISPATCH_QUIET=1 DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_TEST_CN_GATE_OFF=1 \
    ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test-token-0123456789 "${envs[@]}" \
    bash "$REPO_ROOT/scripts/dispatch-author.sh" "$@" --prompt-file "$TEST_TMP/aprompt.txt" --timeout 30s \
    >"$TEST_TMP/a-$tag.out" 2>"$TEST_TMP/a-$tag.err" < /dev/null
  A_RC=$?
}
for spec in "codex|--runner codex --model gpt-5.5 --effort xhigh" \
            "grok|--runner grok --model grok-4.5 --effort high" \
            "cursor|--runner cursor --model cursor-grok-4.6-low" \
            "kimi|--runner kimi --model kimi-code/k3" \
            "cc-shim|--runner cc-shim --model mini" \
            "claude-native|--runner claude-native --model claude-fable-5-1" \
            "agy|--runner agy --model gpt-test"; do
  name="${spec%%|*}"; rargs="${spec#*|}"
  # shellcheck disable=SC2086
  author_run "ref-$name" WORKER_MOUNT_FORCE_MODE=refuse PATH="$TEST_TMP/abin:$PATH" AUTOPILOT_GROK_EFFORT_PROBE=0 -- $rargs --bin "$ASTUB"
  [ "$A_RC" -ne 0 ] && eq ok ok "author $name refuse exits non-zero" || fail "author $name refuse exited 0"
  assert_file_absent "$A_MARK" "author $name: runner never ran under refuse"
  eq "mount_containment_unavailable: forced by WORKER_MOUNT_FORCE_MODE $LINE_TAIL" "$(grep '^mount_containment_unavailable' "$TEST_TMP/a-ref-$name.err" | head -n1)" "author $name stderr line exact"
  # agy refuses before its model-alias probe (which runs the binary), i.e. before the manifest exists
  [ "$name" = agy ] || assert_contains "$(cat "$A_RUNS"/*.manifest.json 2>/dev/null)" '"mount_containment": "refused"' "author $name manifest records refused"
  # private_ns: pass-through unshare shim that logs argv; the runner launch must go through it.
  mkshim unshare 'echo "$@" >> "'"$TEST_TMP"'/ua-'"$name"'.argv"; while [ "$1" != -- ]; do shift; done; shift; exec "$@"'
  rm -f "$TEST_TMP/ua-$name.argv"
  # shellcheck disable=SC2086
  author_run "priv-$name" PATH="$SHIMS:$TEST_TMP/abin:$PATH" AUTOPILOT_GROK_EFFORT_PROBE=0 -- $rargs --bin "$ASTUB"
  UA="$(grep -v -- ' -- true$' "$TEST_TMP/ua-$name.argv" 2>/dev/null | head -n1)"
  case "$UA" in
    "--user --map-current-user --mount --propagation private -- "*) eq ok ok "author $name launched through the unshare prefix" ;;
    *) fail "author $name: no unshare-wrapped launch (got: '$UA'; rc=$A_RC; $(head -c 300 "$TEST_TMP/a-priv-$name.err") $(head -c 400 "$TEST_TMP/a-priv-$name.out"))" ;;
  esac
done
rmshim unshare

echo "== rail: brief gate refuses before the runner starts =="
printf 'note\nmount --rbind /sys /x\n' > "$TEST_TMP/prompt.txt"
hetero_run gate WORKER_MOUNT_FORCE_MODE=no_root
[ "$H_RC" -ne 0 ] && eq ok ok "hetero no_root mount brief exits non-zero" || fail "hetero no_root mount brief exited 0"
assert_file_absent "$MARK" "hetero runner never ran under the brief gate"
assert_contains "$(cat "$TEST_TMP/h-gate.err")" "mount_brief_refused: mount at line" "hetero stderr names the word and line"
printf 'note\nmount --rbind /sys /x\n' > "$TEST_TMP/prompt.txt"
hetero_run gateok WORKER_MOUNT_FORCE_MODE=sudo_private_ns
assert_file_exists "$MARK" "hetero runner ran under sudo_private_ns with the same mount brief"
printf 'mount --rbind /sys /x\n' > "$TEST_TMP/brief.md"
rm -f "$TEST_TMP/foreman.ran"
OUT_FG="$(cd "$SBX" && AUTOPILOT_TEST_CN_GATE_OFF=1 WORKER_MOUNT_FORCE_MODE=no_root bash "$REPO_ROOT/scripts/dispatch-foreman.sh" --brief-file "$TEST_TMP/brief.md" --plan-file "$TEST_TMP/plan.md" \
  --run-id mntgate --run-dir "$TEST_TMP/runs/mntgate" --timeout 20 --kimi-bin "$TEST_TMP/kimi" 2>"$TEST_TMP/foreman-gate.err" < /dev/null)"; RC_FG=$?
[ "$RC_FG" -ne 0 ] && eq ok ok "foreman no_root mount brief exits non-zero" || fail "foreman no_root mount brief exited 0"
assert_file_absent "$TEST_TMP/foreman.ran" "foreman runner never ran under the brief gate"
assert_contains "$(cat "$TEST_TMP/foreman-gate.err")" "mount_brief_refused: mount at line" "foreman stderr names the word and line"
rm -f "$TEST_TMP/foreman.ran"
OUT_FGOK="$(cd "$SBX" && AUTOPILOT_TEST_CN_GATE_OFF=1 WORKER_MOUNT_FORCE_MODE=sudo_private_ns bash "$REPO_ROOT/scripts/dispatch-foreman.sh" --brief-file "$TEST_TMP/brief.md" --plan-file "$TEST_TMP/plan.md" \
  --run-id mntgateok --run-dir "$TEST_TMP/runs/mntgateok" --timeout 20 --kimi-bin "$TEST_TMP/kimi" 2>"$TEST_TMP/foreman-gateok.err" < /dev/null)"; RC_FGOK=$?
assert_file_exists "$TEST_TMP/foreman.ran" "foreman runner ran under sudo_private_ns with the same mount brief (rc=$RC_FGOK)"
# --resume under no_root must gate the run-dir brief before any runner spawn.
RES_DIR="$TEST_TMP/runs/mntresume"
mkdir -p "$RES_DIR"
RES_BASE="$(git -C "$SBX" rev-parse HEAD)"
printf 'RUN_ID=%q\nBRANCH=%q\nBASE_SHA=%q\nWT=%q\nMODEL=%q\n' \
  mntresume 'foreman/mntresume' "$RES_BASE" "$SBX" 'kimi-code/k3' > "$RES_DIR/run.env"
printf 'mount --rbind /sys /x\n' > "$RES_DIR/brief.md"
printf 'plan\n' > "$RES_DIR/plan.md"
printf 'escalation\n' > "$RES_DIR/ESCALATION.md"
printf 'answer\n' > "$TEST_TMP/answer-resume.md"
rm -f "$TEST_TMP/foreman.ran"
OUT_FR="$(cd "$SBX" && AUTOPILOT_TEST_CN_GATE_OFF=1 WORKER_MOUNT_FORCE_MODE=no_root bash "$REPO_ROOT/scripts/dispatch-foreman.sh" --resume --run-dir "$RES_DIR" --answer-file "$TEST_TMP/answer-resume.md" \
  --timeout 20 --kimi-bin "$TEST_TMP/kimi" 2>"$TEST_TMP/foreman-resume.err" < /dev/null)"; RC_FR=$?
[ "$RC_FR" -ne 0 ] && eq ok ok "foreman --resume no_root mount brief exits non-zero" || fail "foreman --resume no_root mount brief exited 0"
assert_file_absent "$TEST_TMP/foreman.ran" "foreman --resume runner never ran under the brief gate"
assert_contains "$(cat "$TEST_TMP/foreman-resume.err")" "mount_brief_refused: mount at line" "foreman --resume stderr names the word and line"
printf 'mount --rbind /sys /x\n' > "$TEST_TMP/aprompt.txt"
# shellcheck disable=SC2086
author_run "gate" WORKER_MOUNT_FORCE_MODE=no_root PATH="$TEST_TMP/abin:$PATH" AUTOPILOT_GROK_EFFORT_PROBE=0 -- --runner grok --model grok-4.5 --effort high --bin "$ASTUB"
[ "$A_RC" -ne 0 ] && eq ok ok "author no_root mount brief exits non-zero" || fail "author no_root mount brief exited 0"
assert_file_absent "$A_MARK" "author runner never ran under the brief gate"
assert_contains "$(cat "$TEST_TMP/a-gate.err")" "mount_brief_refused: mount at line" "author stderr names the word and line"
printf 'mount --rbind /sys /x\n' > "$TEST_TMP/aprompt.txt"
# shellcheck disable=SC2086
author_run "gateok" WORKER_MOUNT_FORCE_MODE=sudo_private_ns PATH="$TEST_TMP/abin:$PATH" AUTOPILOT_GROK_EFFORT_PROBE=0 -- --runner grok --model grok-4.5 --effort high --bin "$ASTUB"
assert_file_exists "$A_MARK" "author runner ran under sudo_private_ns with the same mount brief"

echo "== real namespace propagation (self-created sandbox only) =="
if unshare --user --map-current-user --mount --propagation shared true >/dev/null 2>&1; then
  SANDBOX_SCRIPT="$TEST_TMP/outer.sh"
  cat > "$SANDBOX_SCRIPT" <<'EOF'
#!/usr/bin/env bash
# Runs INSIDE a user+mount namespace this test created. Only paths under $1 are touched.
set -u
R="$1"; LIBF="$2"
mkdir -p "$R/shared" "$R/copy"
mount --make-rshared / 2>/dev/null || true
mount -t tmpfs tmpfs "$R/shared" || exit 90
echo marker > "$R/shared/m"
. "$LIBF"; worker_mount_isolation_detect
[ "$WORKER_MOUNT_MODE" = private_ns ] || { echo "mode=$WORKER_MOUNT_MODE"; exit 91; }
"${WORKER_MOUNT_PREFIX[@]}" bash -c 'mount --rbind "$1/shared" "$1/copy" && umount -l "$1/copy" && umount -l "$1/shared"' _ "$R"
[ -f "$R/shared/m" ] || { echo "outer sandbox lost its mount"; exit 92; }
exit 0
EOF
  PROP_OUT="$(unshare --user --map-current-user --mount --propagation shared bash "$SANDBOX_SCRIPT" "$TEST_TMP/propagation" "$LIB" 2>&1)"; PROP_RC=$?
  eq "0" "$PROP_RC" "private_ns worker's umount -l did not reach the outer sandbox ($PROP_OUT)"
else
  echo "SKIP private_ns: userns unavailable"
fi

echo "== real sudo_private_ns (scratch dir only; SKIP without passwordless sudo) =="
# host_mount_clean <mountpoint-q-status> <leak-test-status>
# Both are exit codes: 0 means "yes" (mountpoint -q true, or the leak file exists).
# A leak fails the assertion. The red control feeds a recorded mountpoint-true state and
# must fail; it does not mount anything.
host_mount_clean() {
  local is_mp="$1" leak="$2"
  if [ "$is_mp" -eq 0 ] || [ "$leak" -eq 0 ]; then
    echo "host mount leak: mountpoint=$is_mp leak=$leak" >&2
    return 1
  fi
  return 0
}
RED_RC=0
host_mount_clean 0 1 || RED_RC=$?
eq "1" "$RED_RC" "red control: recorded mountpoint=true is a leak"
if sudo -n true >/dev/null 2>&1; then
  SUDO_NS_D="$(mktemp -d "$TEST_TMP/sudo-ns.XXXXXX")"
  cleanup_sudo_ns() {
    if [ "$BASHPID" = "$__TEST_TOP_BASHPID" ] && [ -n "${SUDO_NS_D:-}" ]; then
      sudo -n umount "$SUDO_NS_D" 2>/dev/null || true
    fi
    cleanup_test_tmp
  }
  trap cleanup_sudo_ns EXIT
  sudo_ns_out="$(env -u WORKER_MOUNT_FORCE_MODE bash -c '. "$1"; worker_mount_isolation_detect; printf "%s\n" "$WORKER_MOUNT_MODE"; printf "%s\0" "${WORKER_MOUNT_PREFIX[@]}"' _ "$LIB" 2>"$TEST_TMP/sudo-ns-detect.err")"
  SUDO_NS_MODE="${sudo_ns_out%%$'\n'*}"
  if [ "$SUDO_NS_MODE" != "sudo_private_ns" ]; then
    echo "SKIP real-sudo-ns"
  else
    # Rebuild the prefix from a second detect in this shell so the worker runs through it.
    env -u WORKER_MOUNT_FORCE_MODE bash -c '
      . "$1"
      worker_mount_isolation_detect
      [ "$WORKER_MOUNT_MODE" = "sudo_private_ns" ] || exit 91
      "${WORKER_MOUNT_PREFIX[@]}" bash -c "sudo -n mount -t tmpfs none \"\$1\" && sudo -n touch \"\$1/leak\"" _ "$2"
    ' _ "$LIB" "$SUDO_NS_D" >"$TEST_TMP/sudo-ns-run.out" 2>"$TEST_TMP/sudo-ns-run.err"
    SUDO_NS_RUN=$?
    eq "0" "$SUDO_NS_RUN" "worker mounted a tmpfs inside sudo_private_ns ($(head -c 200 "$TEST_TMP/sudo-ns-run.err"))"
    if mountpoint -q "$SUDO_NS_D"; then MP_RC=0; else MP_RC=1; fi
    if [ -e "$SUDO_NS_D/leak" ]; then LEAK_RC=0; else LEAK_RC=1; fi
    host_mount_clean "$MP_RC" "$LEAK_RC" || fail "sudo_private_ns leaked the tmpfs onto the host"
    sudo -n umount "$SUDO_NS_D" 2>/dev/null || true
  fi
else
  echo "SKIP real-sudo-ns"
fi

finalize_test
