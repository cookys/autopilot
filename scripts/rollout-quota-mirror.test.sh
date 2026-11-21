#!/usr/bin/env bash
# Hermetic tests for scripts/rollout-quota-mirror.sh.
# Sandbox HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR. PATH stubs for systemctl,
# codeforge and node (the node stub refuses a HOME outside the sandbox, then
# execs the real node). Never calls the real systemctl or the real home.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/rollout-quota-mirror.sh"
REAL_NODE="$(command -v node)"
FAIL=0

fail() { printf 'FAIL %s\n' "$1" >&2; FAIL=1; }
ok() { printf 'ok %s\n' "$1"; }

new_sandbox() {
  BASE="$(mktemp -d)"
  HOME_D="$BASE/home"
  OUTSIDE="$BASE/outside"
  RUNTIME="$BASE/run"
  BIN="$BASE/bin"
  STUB="$BASE/stub"
  mkdir -p "$HOME_D" "$OUTSIDE" "$RUNTIME" "$BIN" "$STUB"
  printf 'canary\n' > "$OUTSIDE/canary"
  CANARY_SHA="$(sha256sum -- "$OUTSIDE/canary" | awk '{print $1}')"
  printf 'disabled\n' > "$STUB/enabled"
  printf 'n/a\n' > "$STUB/last"
  : > "$STUB/log"

  cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "$ROLLOUT_STUB/log"
case "$*" in
  *"$ROLLOUT_OUTSIDE"*) printf 'systemctl touched outside\n' >&2; exit 86 ;;
esac
args=("$@")
i=0
if [ "${args[0]:-}" = "--user" ]; then i=1; fi
cmd="${args[$i]:-}"
case "$cmd" in
  is-enabled)
    state="$(cat "$ROLLOUT_STUB/enabled")"
    printf '%s\n' "$state"
    [ "$state" = "enabled" ]
    ;;
  show)
    cat "$ROLLOUT_STUB/last"
    ;;
  daemon-reload) exit 0 ;;
  enable)
    printf 'enabled\n' > "$ROLLOUT_STUB/enabled"
    if [ "$(cat "$ROLLOUT_STUB/last")" = "n/a" ]; then
      printf 'Fri 2026-11-21 00:00:00 UTC\n' > "$ROLLOUT_STUB/last"
    fi
    if [ -f "$ROLLOUT_STUB/enable_rc" ]; then
      exit "$(cat "$ROLLOUT_STUB/enable_rc")"
    fi
    exit 0
    ;;
  disable)
    printf 'disabled\n' > "$ROLLOUT_STUB/enabled"
    exit 0
    ;;
  restart|try-restart) exit 0 ;;
  *) printf 'unexpected systemctl %s\n' "$*" >&2; exit 44 ;;
esac
EOF

  cat > "$BIN/node" <<EOF
#!/usr/bin/env bash
set -u
case "\${HOME:-}" in
  "$HOME_D"|"$HOME_D"/*) ;;
  *) printf 'node refused HOME=%s\n' "\${HOME:-}" >&2; exit 97 ;;
esac
exec "$REAL_NODE" "\$@"
EOF

  cat > "$BIN/codeforge" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$BIN/journalctl" <<'EOF'
#!/usr/bin/env bash
set -u
if [ -f "$ROLLOUT_STUB/journal" ]; then
  cat "$ROLLOUT_STUB/journal"
fi
exit 0
EOF
  chmod 755 "$BIN/systemctl" "$BIN/node" "$BIN/codeforge" "$BIN/journalctl"

  export HOME="$HOME_D"
  export XDG_CONFIG_HOME="$HOME_D/.config"
  export XDG_RUNTIME_DIR="$RUNTIME"
  export AUTOPILOT_LIVE_DIR=""
  export PATH="$BIN:/usr/bin:/bin"
  export ROLLOUT_STUB="$STUB"
  export ROLLOUT_OUTSIDE="$OUTSIDE"
  unset AUTOPILOT_LIVE_DIR
  unset AUTOPILOT_PLUGIN_ROOT
  unset NODE
}

# PATH with the sandbox systemctl stub and the usual tools, and no node binary.
isolate_path_no_node() {
  local dest="$BASE/nonode" c
  mkdir -p "$dest"
  ln -sf "$BIN/systemctl" "$dest/systemctl"
  ln -sf "$BIN/codeforge" "$dest/codeforge"
  for c in bash env sort hostname id date stat find sha256sum awk grep cp mkdir cat touch chmod sed ls basename head xargs wc mktemp readlink; do
    if [ -x "/usr/bin/$c" ]; then ln -sf "/usr/bin/$c" "$dest/$c"
    elif [ -x "/bin/$c" ]; then ln -sf "/bin/$c" "$dest/$c"
    fi
  done
  export PATH="$dest"
}

# Fake nvm tree. v22 is not executable; newest executable is v20.11.1.
plant_nvm() {
  local v dest
  for v in v18.20.0 v20.9.0 v20.11.1; do
    dest="$HOME_D/.nvm/versions/node/$v/bin"
    mkdir -p "$dest"
    cat > "$dest/node" <<EOF
#!/usr/bin/env bash
exec "$REAL_NODE" "\$@"
EOF
    chmod 755 "$dest/node"
  done
  dest="$HOME_D/.nvm/versions/node/v22.0.0/bin"
  mkdir -p "$dest"
  printf 'not executable\n' > "$dest/node"
}

run_script_stdin() {
  set +e
  OUT="$(bash -u -s -- "$@" < "$SCRIPT" 2>"$BASE/err")"
  RC=$?
  ERR="$(cat "$BASE/err")"
  set -e
}

json_node_path() {
  printf '%s\n' "$OUT" | "$REAL_NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const lines=s.trim().split(/\n/).filter(l=>l.startsWith("{")); const o=JSON.parse(lines[lines.length-1]); process.stdout.write(o.node_path===null?"null":String(o.node_path));});'
}

live() { printf '%s/autopilot' "$RUNTIME"; }

seed_fresh() {
  local live_d snap quota
  live_d="$(live)"
  snap="$live_d/codeforge/usage/quota"
  quota="$live_d/quota/claude/alias"
  mkdir -p "$snap" "$quota"
  printf '{}\n' > "$snap/main.json"
  printf '{}\n' > "$quota/main.json"
}

install_unit_file() {
  mkdir -p "$XDG_CONFIG_HOME/systemd/user"
  printf 'autopilot:quota-mirror/1\n' > "$XDG_CONFIG_HOME/systemd/user/quota-mirror.timer"
  printf 'autopilot:quota-mirror/1\n' > "$XDG_CONFIG_HOME/systemd/user/quota-mirror.service"
}

enable_timer() { printf 'enabled\n' > "$STUB/enabled"; }

run_script() {
  set +e
  OUT="$(bash "$SCRIPT" "$@" 2>"$BASE/err")"
  RC=$?
  ERR="$(cat "$BASE/err")"
  set -e
}

assert_verdict() {
  local want="$1" got
  got="$(printf '%s\n' "$OUT" | "$REAL_NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const lines=s.trim().split(/\n/).filter(l=>l.startsWith("{")); const o=JSON.parse(lines[lines.length-1]); process.stdout.write(o.verdict);});')"
  [ "$got" = "$want" ] || { fail "$2: verdict $got != $want (out=$OUT err=$ERR)"; return; }
  ok "$2"
}

assert_outside_clean() {
  local now
  now="$(sha256sum -- "$OUTSIDE/canary" | awk '{print $1}')"
  [ "$now" = "$CANARY_SHA" ] || { fail "canary changed"; return; }
  local n
  n="$(find "$OUTSIDE" -type f | wc -l)"
  [ "$n" = "1" ] || { fail "outside file count $n"; return; }
}

# --- no_timer ---
new_sandbox
seed_fresh
run_script --inventory
[ "$RC" = "3" ] || fail "no_timer exit $RC"
assert_verdict no_timer "inventory no_timer"
assert_outside_clean

# --- ok ---
new_sandbox
seed_fresh
install_unit_file
enable_timer
printf 'Fri 2026-11-21 00:00:00 UTC\n' > "$STUB/last"
run_script --inventory
[ "$RC" = "0" ] || fail "ok exit $RC err=$ERR out=$OUT"
assert_verdict ok "inventory ok"
printf '%s\n' "$OUT" | "$REAL_NODE" -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const o=JSON.parse(s.trim().split(/\n/).pop()); if(!o.timer_installed||!o.timer_enabled||!o.codeforge_on_path||o.last_tick===null||o.newest_snapshot_age_s===null||o.quota_out_newest_age_s===null) process.exit(2);});' \
  || fail "ok json fields"

# --- no_snapshot ---
new_sandbox
install_unit_file
enable_timer
run_script --inventory
[ "$RC" = "3" ] || fail "no_snapshot exit $RC"
assert_verdict no_snapshot "inventory no_snapshot"
printf '%s\n' "$ERR" | grep -q 'codeforge install --all' || fail "no_snapshot missing hangar command"

# --- stale ---
new_sandbox
seed_fresh
install_unit_file
enable_timer
touch -d '8 hours ago' "$(live)/codeforge/usage/quota/main.json"
touch -d '8 hours ago' "$(live)/quota/claude/alias/main.json"
run_script --inventory
[ "$RC" = "3" ] || fail "stale exit $RC out=$OUT"
assert_verdict stale "inventory stale"

# --- nothing_applicable tick is its own verdict, not stale ---
new_sandbox
seed_fresh
install_unit_file
enable_timer
touch -d '8 hours ago' "$(live)/codeforge/usage/quota/main.json"
touch -d '8 hours ago' "$(live)/quota/claude/alias/main.json"
printf '%s\n' 'quota-mirror-tick: usage-probe skip token_missing' 'quota-mirror-tick: nothing_applicable' > "$STUB/journal"
run_script --inventory
[ "$RC" = "3" ] || fail "nothing_applicable exit $RC out=$OUT"
assert_verdict nothing_applicable "inventory nothing_applicable"

# --- apply twice ---
new_sandbox
seed_fresh
PRIOR="$XDG_CONFIG_HOME/systemd/user"
mkdir -p "$PRIOR"
printf 'autopilot:quota-mirror/1\nPRIOR-BYTES\n' > "$PRIOR/quota-mirror.service"
printf 'autopilot:quota-mirror/1\nPRIOR-TIMER\n' > "$PRIOR/quota-mirror.timer"
SHA_PRIOR="$(sha256sum -- "$PRIOR/quota-mirror.service" | awk '{print $1}')"
run_script --apply
[ "$RC" = "0" ] || fail "apply1 exit $RC err=$ERR out=$OUT"
SHA1="$(printf '%s\n' "$OUT" | awk '/^new sha16 quota-mirror.service /{print $4}')"
[ -n "$SHA1" ] || fail "apply1 missing new sha16"
BAK="$(ls "$PRIOR"/quota-mirror.service.bak.* 2>/dev/null | head -1)"
[ -n "$BAK" ] || fail "apply1 missing backup"
[ "$(sha256sum -- "$BAK" | awk '{print $1}')" = "$SHA_PRIOR" ] || fail "backup bytes differ"
grep -q 'PRIOR-BYTES' "$PRIOR/quota-mirror.service" && fail "apply did not replace service"
run_script --apply
[ "$RC" = "0" ] || fail "apply2 exit $RC err=$ERR out=$OUT"
printf '%s\n' "$OUT" | grep -q '^unchanged$' || fail "apply2 not unchanged"
SHA2="$(printf '%s\n' "$OUT" | awk '/^unchanged sha16 quota-mirror.service /{print $4}')"
[ "$SHA1" = "$SHA2" ] || fail "sha16 changed $SHA1 vs $SHA2"
BAK_N="$(find "$PRIOR" -name 'quota-mirror.service.bak.*' | wc -l)"
[ "$BAK_N" = "1" ] || fail "second apply wrote another backup ($BAK_N)"
ok "apply twice idempotent"

# --- rollback restores bytes ---
EPOCH="$(printf '%s\n' "$OUT" | awk '/^rollback: /{print $NF}')"
# The second apply prints a new epoch but did not write that backup.
# Roll back the epoch that owns the backup file.
EPOCH="$(basename "$BAK" | sed 's/.*\.bak\.//')"
run_script --rollback "$EPOCH"
grep -q 'PRIOR-BYTES' "$PRIOR/quota-mirror.service" || fail "rollback service bytes"
grep -q 'PRIOR-TIMER' "$PRIOR/quota-mirror.timer" || fail "rollback timer bytes"
ok "rollback restores bytes"

# --- dry-run writes nothing ---
new_sandbox
seed_fresh
mkdir -p "$XDG_CONFIG_HOME/systemd/user"
printf 'autopilot:quota-mirror/1\nPRIOR-BYTES\n' > "$XDG_CONFIG_HOME/systemd/user/quota-mirror.service"
printf 'autopilot:quota-mirror/1\nPRIOR-TIMER\n' > "$XDG_CONFIG_HOME/systemd/user/quota-mirror.timer"
BEFORE="$(find "$HOME_D" "$RUNTIME" -type f -print | sort | xargs sha256sum)"
run_script --apply --dry-run
AFTER="$(find "$HOME_D" "$RUNTIME" -type f -print | sort | xargs sha256sum)"
[ "$BEFORE" = "$AFTER" ] || { fail "dry-run wrote files"; printf '%s\n%s\n' "$BEFORE" "$AFTER" >&2; }
printf '%s\n' "$OUT" | grep -q 'dry-run: write nothing' || fail "dry-run missing banner"
find "$HOME_D" -name '*.bak.*' | grep -q . && fail "dry-run created a backup"
ok "dry-run writes nothing"

# --- negative control: apply must not touch the outside tree ---
new_sandbox
seed_fresh
run_script --apply
[ "$RC" = "0" ] || fail "negative apply exit $RC err=$ERR"
assert_outside_clean
# unit files live under the sandbox home only
find "$HOME_D" -type f | grep -q '/systemd/user/quota-mirror.service' || fail "unit not in sandbox"
ok "negative control outside sandbox"

# --- stdin + set -u, PATH has no node, newest executable nvm node ---
new_sandbox
seed_fresh
install_unit_file
enable_timer
printf 'Fri 2026-11-21 00:00:00 UTC\n' > "$STUB/last"
isolate_path_no_node
plant_nvm
run_script_stdin --inventory
printf '%s\n' "$ERR" | grep -q 'BASH_SOURCE' && fail "stdin unbound BASH_SOURCE: $ERR"
[ "$RC" = "0" ] || fail "stdin nvm exit $RC err=$ERR out=$OUT"
assert_verdict ok "stdin inventory ok"
GOT_NODE="$(json_node_path)"
WANT_NODE="$HOME_D/.nvm/versions/node/v20.11.1/bin/node"
[ "$GOT_NODE" = "$WANT_NODE" ] || fail "stdin node_path $GOT_NODE != $WANT_NODE"
ok "stdin set -u uses newest nvm node"

# NODE, when executable, wins over nvm and PATH.
export NODE="$HOME_D/.nvm/versions/node/v18.20.0/bin/node"
run_script_stdin --inventory
GOT_NODE="$(json_node_path)"
[ "$GOT_NODE" = "$NODE" ] || fail "NODE override $GOT_NODE != $NODE"
unset NODE
ok "NODE override"

# No plugin root and no ~/projects/autopilot/scripts: inventory still runs;
# --apply exits 3 because the installer is missing.
new_sandbox
seed_fresh
install_unit_file
enable_timer
printf 'Fri 2026-11-21 00:00:00 UTC\n' > "$STUB/last"
run_script_stdin --inventory
[ "$RC" = "0" ] || fail "stdin no script dir inventory exit $RC err=$ERR out=$OUT"
assert_verdict ok "stdin inventory without script dir"
run_script_stdin --apply
[ "$RC" = "3" ] || fail "stdin apply without installer exit $RC err=$ERR"
printf '%s\n' "$ERR" | grep -q 'installer not found' || fail "stdin apply missing installer reason: $ERR"
ok "stdin apply without installer exits 3"

# AUTOPILOT_PLUGIN_ROOT/scripts wins over ~/projects/autopilot/scripts.
new_sandbox
seed_fresh
install_unit_file
enable_timer
printf 'Fri 2026-11-21 00:00:00 UTC\n' > "$STUB/last"
FAKE="$BASE/pluginroot"
mkdir -p "$FAKE/scripts" "$HOME_D/projects/autopilot/scripts"
printf '%s\n' 'console.log("would write: home-copy");' > "$HOME_D/projects/autopilot/scripts/install-quota-mirror.js"
printf '%s\n' 'console.log("would write: plugin-root");' > "$FAKE/scripts/install-quota-mirror.js"
export AUTOPILOT_PLUGIN_ROOT="$FAKE"
run_script_stdin --apply --dry-run
[ "$RC" = "0" ] || fail "plugin root dry-run exit $RC err=$ERR out=$OUT"
printf '%s\n' "$OUT" | grep -q "$FAKE/scripts/install-quota-mirror.js" || fail "plugin root installer not used: $OUT"
printf '%s\n' "$OUT" | grep -q 'home-copy' && fail "home copy installer ran"
unset AUTOPILOT_PLUGIN_ROOT
ok "stdin AUTOPILOT_PLUGIN_ROOT"

# Neither plugin root: the home projects path is the installer.
new_sandbox
seed_fresh
install_unit_file
enable_timer
printf 'Fri 2026-11-21 00:00:00 UTC\n' > "$STUB/last"
mkdir -p "$HOME_D/projects/autopilot/scripts"
printf '%s\n' 'console.log("would write: home-copy");' > "$HOME_D/projects/autopilot/scripts/install-quota-mirror.js"
run_script_stdin --apply --dry-run
[ "$RC" = "0" ] || fail "home scripts dry-run exit $RC err=$ERR out=$OUT"
printf '%s\n' "$OUT" | grep -q "$HOME_D/projects/autopilot/scripts/install-quota-mirror.js" || fail "home installer not used: $OUT"
ok "stdin HOME projects scripts"

# systemctl enable failure names the step and exits 4. Sandbox stub only.
new_sandbox
seed_fresh
install_unit_file
enable_timer
printf '1\n' > "$STUB/enable_rc"
run_script --apply
[ "$RC" = "4" ] || fail "enable fail exit $RC err=$ERR out=$OUT"
printf '%s\n' "$ERR" | grep -qx 'rollout-quota-mirror: systemctl enable failed' || fail "enable fail did not name the step: out=$OUT err=$ERR"
ok "systemctl enable failure exits 4"

# stdin invocation prints a copyable bash -s rollback line.
new_sandbox
seed_fresh
install_unit_file
enable_timer
export AUTOPILOT_PLUGIN_ROOT="$ROOT"
run_script_stdin --apply --dry-run
unset AUTOPILOT_PLUGIN_ROOT
[ "$RC" = "0" ] || fail "stdin dry-run rollback exit $RC err=$ERR out=$OUT"
printf '%s\n' "$OUT" | grep -F "rollback: bash -s -- --rollback" >/dev/null || fail "stdin rollback form: $OUT"
printf '%s\n' "$OUT" | grep -F "< $ROOT/scripts/rollout-quota-mirror.sh" >/dev/null || fail "stdin rollback repo path: $OUT"
ok "stdin rollback uses bash -s"

# No node anywhere: inventory verdict unchanged (node_path null); --apply exits 3.
new_sandbox
seed_fresh
install_unit_file
enable_timer
printf 'Fri 2026-11-21 00:00:00 UTC\n' > "$STUB/last"
isolate_path_no_node
EMPTYF="$BASE/not-node"
: > "$EMPTYF"
chmod 644 "$EMPTYF"
BINDS=(--bind "$EMPTYF" /usr/bin/node)
if [ -e /usr/local/bin/node ]; then
  BINDS+=(--bind "$EMPTYF" "$(readlink -f /usr/local/bin/node)")
fi
set +e
OUT="$(/usr/bin/bwrap --ro-bind / / --bind "$BASE" "$BASE" --dev /dev "${BINDS[@]}" -- bash -u -s -- --inventory < "$SCRIPT" 2>"$BASE/err")"
RC=$?
ERR="$(cat "$BASE/err")"
set -e
[ "$RC" = "0" ] || fail "no-node inventory exit $RC err=$ERR out=$OUT"
assert_verdict ok "no-node inventory verdict"
GOT_NODE="$(json_node_path)"
[ "$GOT_NODE" = "null" ] || fail "no-node node_path $GOT_NODE"
set +e
OUT="$(/usr/bin/bwrap --ro-bind / / --bind "$BASE" "$BASE" --dev /dev "${BINDS[@]}" -- bash "$SCRIPT" --apply 2>"$BASE/err")"
RC=$?
ERR="$(cat "$BASE/err")"
set -e
[ "$RC" = "3" ] || fail "no-node apply exit $RC err=$ERR out=$OUT"
printf '%s\n' "$ERR" | grep -q 'node not found' || fail "no-node apply reason: $ERR"
ok "no node inventory unchanged apply exits 3"

if [ "$FAIL" != "0" ]; then
  printf 'rollout-quota-mirror.test.sh FAILED\n' >&2
  exit 1
fi
printf 'rollout-quota-mirror.test.sh PASS\n'
exit 0
