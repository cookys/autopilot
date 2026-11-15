#!/usr/bin/env bash
# Worker mount isolation (01M7E4JC): a dispatched worker must never be able to change the HOST mount
# table (cuda lost /sys/fs/cgroup when a lane ran `mount --rbind /sys` then `umount -l`).
# SAFETY: this suite never runs anything as root, never uses sudo, never mounts or unmounts in the
# host namespace. The one real-namespace case builds its OWN user+mount namespace and is skipped
# where unprivileged user namespaces are blocked.
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
OUT_F="$(cd "$SBX" && WORKER_MOUNT_FORCE_MODE=refuse bash "$REPO_ROOT/scripts/dispatch-foreman.sh" --brief-file "$TEST_TMP/brief.md" --plan-file "$TEST_TMP/plan.md" \
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
    bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --runner grok --model grok-4.5 --effort high --grok-bin "$HSTUB" \
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
  env HOME="$AHOME" AUTOPILOT_DISPATCH_RUNS_DIR="$A_RUNS" MNT_MARK="$A_MARK" DISPATCH_QUIET=1 DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 \
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

finalize_test
