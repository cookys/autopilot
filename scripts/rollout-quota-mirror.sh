#!/usr/bin/env bash
# rollout-quota-mirror.sh — per-OS-account quota-mirror rollout (hangar runs it
# over ssh as that account). It never ssh-es. It never runs `codeforge install`.
#
#   scripts/rollout-quota-mirror.sh [--inventory]
#   scripts/rollout-quota-mirror.sh --apply [--dry-run]
#   scripts/rollout-quota-mirror.sh --rollback <epoch>
#
# --inventory (default) prints one JSON line and does not write:
#   host, user, timer_installed, timer_enabled, last_tick, snapshot_dir_exists,
#   newest_snapshot_age_s, quota_out_newest_age_s, codeforge_on_path, node_path,
#   verdict.
# node_path is the node binary used for every node call, or null when none was
# found. Search order: $NODE if it is an executable file, else command -v node,
# else the newest executable $HOME/.nvm/versions/node/*/bin/node (sort -V),
# else /usr/local/bin/node, else /usr/bin/node. With no node, the verdict is
# unchanged and --apply / --rollback exit 3.
# Fed on stdin (`bash -s`), there is no script path. SCRIPT_DIR is then
# $AUTOPILOT_PLUGIN_ROOT/scripts, else $HOME/projects/autopilot/scripts, when
# that directory exists. Inventory still runs when neither exists; --apply and
# --rollback then exit 3 because the installer is missing.
# verdict is the first match: no_timer, timer_disabled, no_snapshot,
# nothing_applicable, stale, ok.
# A statusline snapshot older than 21600 s (account-quota.js 6 h) is stale.
# A fleet.quota mirror file older than 1800 s (timer is 10 min) is stale.
# When that age check would say stale, and the last quota-mirror.service journal
# line that starts with "quota-mirror-tick: " is
# "quota-mirror-tick: nothing_applicable", the verdict is nothing_applicable.
# No snapshot file contents are printed.
# Exit 0 when verdict is ok and codeforge is on PATH.
# Exit 3 when verdict is not ok, or codeforge is missing. For codeforge missing
# or no_snapshot, stderr names the reason and the command hangar should run:
#   codeforge install --all
#
# --apply backs up existing quota-mirror.service/.timer to <file>.bak.<epoch>
# when the installer would change them, prints sha16 (first 16 hex of sha256)
# of the backups and of the new files, runs install-quota-mirror.js install,
# then systemctl --user daemon-reload and enable --now. Prints the rollback
# command and runs --inventory. A second run with the same bytes prints
# unchanged and the same sha16 and does not write another backup.
# --dry-run with --apply prints the plan and writes nothing.
#
# --rollback <epoch> restores those backups, or uninstalls when none exist,
# then daemon-reload and restart (restored) or disable --now (uninstalled).
#
# Exit 2 on usage. Exit 1 when a step fails. Exit 4 when --apply's
# systemctl --user daemon-reload or enable --now fails (for example no user
# bus). That path prints one line naming the failed step.
# When the script is read from stdin, the rollback line is
#   rollback: bash -s -- --rollback <epoch> < <repo>/scripts/rollout-quota-mirror.sh
# using the repo path already resolved for the installer. A path invocation keeps
#   rollback: <script> --rollback <epoch>
set -euo pipefail

resolve_script_dir() {
  local src=""
  src="${BASH_SOURCE[0]:-}"
  if [ -n "$src" ] && [ -f "$src" ]; then
    (cd "$(dirname "$src")" && pwd)
    return 0
  fi
  if [ -n "${AUTOPILOT_PLUGIN_ROOT:-}" ] && [ -d "${AUTOPILOT_PLUGIN_ROOT}/scripts" ]; then
    (cd "${AUTOPILOT_PLUGIN_ROOT}/scripts" && pwd)
    return 0
  fi
  if [ -n "${HOME:-}" ] && [ -d "$HOME/projects/autopilot/scripts" ]; then
    (cd "$HOME/projects/autopilot/scripts" && pwd)
    return 0
  fi
  printf ''
}

resolve_node() {
  local cand newest ng
  if [ -n "${NODE:-}" ] && [ -f "$NODE" ] && [ -x "$NODE" ]; then
    printf '%s' "$NODE"
    return 0
  fi
  cand="$(command -v node 2>/dev/null || true)"
  if [ -n "$cand" ] && [ -f "$cand" ] && [ -x "$cand" ]; then
    printf '%s' "$cand"
    return 0
  fi
  newest=""
  ng="$(shopt -p nullglob)"
  shopt -s nullglob
  local cands=( "${HOME:-}"/.nvm/versions/node/*/bin/node )
  eval "$ng"
  if [ "${#cands[@]}" -gt 0 ]; then
    while IFS= read -r cand; do
      if [ -n "$cand" ] && [ -f "$cand" ] && [ -x "$cand" ]; then
        newest="$cand"
      fi
    done < <(printf '%s\n' "${cands[@]}" | sort -V)
  fi
  if [ -n "$newest" ]; then
    printf '%s' "$newest"
    return 0
  fi
  for cand in /usr/local/bin/node /usr/bin/node; do
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      printf '%s' "$cand"
      return 0
    fi
  done
  return 1
}

SCRIPT_DIR="$(resolve_script_dir)"
if [ -n "$SCRIPT_DIR" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  INSTALLER="$SCRIPT_DIR/install-quota-mirror.js"
else
  REPO_ROOT=""
  INSTALLER=""
fi
RUN_FROM_STDIN=0
if [ -z "${BASH_SOURCE[0]:-}" ] || [ ! -f "${BASH_SOURCE[0]}" ]; then
  RUN_FROM_STDIN=1
fi

print_rollback() {
  local epoch="$1"
  if [ "$RUN_FROM_STDIN" = "1" ]; then
    printf 'rollback: bash -s -- --rollback %s < %s/scripts/rollout-quota-mirror.sh\n' "$epoch" "$REPO_ROOT"
  else
    printf 'rollback: %s --rollback %s\n' "$SCRIPT_DIR/rollout-quota-mirror.sh" "$epoch"
  fi
}

systemctl_apply() {
  local step="$1"
  shift
  if ! systemctl --user "$@"; then
    printf 'rollout-quota-mirror: systemctl %s failed\n' "$step" >&2
    return 4
  fi
}
NODE_BIN="$(resolve_node || true)"
UNITS=(quota-mirror.service quota-mirror.timer)
SNAPSHOT_STALE_S=21600
QUOTA_OUT_STALE_S=1800
HANGAR_CMD="codeforge install --all"

unit_dir() {
  local base="${XDG_CONFIG_HOME:-$HOME/.config}"
  printf '%s\n' "$base/systemd/user"
}

live_dir() {
  if [ -n "${AUTOPILOT_LIVE_DIR:-}" ]; then
    printf '%s\n' "$AUTOPILOT_LIVE_DIR"
  elif [ -n "${XDG_RUNTIME_DIR:-}" ]; then
    printf '%s\n' "$XDG_RUNTIME_DIR/autopilot"
  else
    printf '%s\n' "$HOME/.autopilot"
  fi
}

sha16_of() {
  sha256sum -- "$1" | awk '{print substr($1, 1, 16)}'
}

# Newest regular-file mtime, or empty when none. $2 = json (maxdepth 1 *.json) or any.
newest_mtime() {
  local dir="$1" mode="$2" newest="" f m
  [ -d "$dir" ] || return 0
  if [ "$mode" = "json" ]; then
    while IFS= read -r -d '' f; do
      m="$(stat -c %Y -- "$f")"
      if [ -z "$newest" ] || [ "$m" -gt "$newest" ]; then newest="$m"; fi
    done < <(find "$dir" -maxdepth 1 -type f -name '*.json' -print0)
  else
    while IFS= read -r -d '' f; do
      m="$(stat -c %Y -- "$f")"
      if [ -z "$newest" ] || [ "$m" -gt "$newest" ]; then newest="$m"; fi
    done < <(find "$dir" -type f -print0)
  fi
  printf '%s' "$newest"
}

age_of() {
  local mtime="$1" now="$2"
  if [ -z "$mtime" ]; then
    printf ''
  else
    printf '%s' "$((now - mtime))"
  fi
}

timer_installed() {
  [ -f "$(unit_dir)/quota-mirror.timer" ] && [ ! -L "$(unit_dir)/quota-mirror.timer" ]
}

timer_enabled() {
  local state
  state="$(systemctl --user is-enabled quota-mirror.timer 2>/dev/null || true)"
  [ "$state" = "enabled" ]
}

last_tick() {
  local raw
  raw="$(systemctl --user show quota-mirror.timer -p LastTriggerUSec --value 2>/dev/null || true)"
  raw="${raw#LastTriggerUSec=}"
  case "$raw" in
    ""|n/a|N/A|0) printf '' ;;
    *) printf '%s' "$raw" ;;
  esac
}

# Last "quota-mirror-tick: " line from the user journal of quota-mirror.service.
last_tick_marker() {
  local text
  text="$(journalctl --user -u quota-mirror.service -n 80 --no-pager -o cat 2>/dev/null || true)"
  printf '%s\n' "$text" | awk '/^quota-mirror-tick: /{line=$0} END{print line}'
}

# Prints verdict on stdout.
verdict_of() {
  local snap_dir_exists="$1" snap_age="$2" quota_age="$3" marker
  if ! timer_installed; then
    printf 'no_timer'
    return
  fi
  if ! timer_enabled; then
    printf 'timer_disabled'
    return
  fi
  if [ "$snap_dir_exists" != "1" ] || [ -z "$snap_age" ]; then
    printf 'no_snapshot'
    return
  fi
  if [ "$snap_age" -gt "$SNAPSHOT_STALE_S" ] || [ -z "$quota_age" ] || [ "$quota_age" -gt "$QUOTA_OUT_STALE_S" ]; then
    marker="$(last_tick_marker)"
    if [ "$marker" = "quota-mirror-tick: nothing_applicable" ]; then
      printf 'nothing_applicable'
      return
    fi
    printf 'stale'
    return
  fi
  printf 'ok'
}

emit_inventory() {
  local live snap_dir quota_dir now snap_m quota_m snap_age quota_age snap_exists verdict tick host user codeforge
  live="$(live_dir)"
  snap_dir="$live/codeforge/usage/quota"
  quota_dir="$live/quota"
  now="$(date +%s)"
  if [ -d "$snap_dir" ]; then snap_exists=1; else snap_exists=0; fi
  snap_m="$(newest_mtime "$snap_dir" json)"
  quota_m="$(newest_mtime "$quota_dir" any)"
  snap_age="$(age_of "$snap_m" "$now")"
  quota_age="$(age_of "$quota_m" "$now")"
  verdict="$(verdict_of "$snap_exists" "$snap_age" "$quota_age")"
  tick="$(last_tick)"
  host="$(hostname)"
  user="$(id -un)"
  if command -v codeforge >/dev/null 2>&1; then codeforge=1; else codeforge=0; fi

  if [ -n "$NODE_BIN" ]; then
    I_HOST="$host" I_USER="$user" I_INST="$(timer_installed && echo 1 || echo 0)" \
    I_EN="$(timer_enabled && echo 1 || echo 0)" I_TICK="$tick" \
    I_SNAP_DIR="$snap_exists" I_SNAP_AGE="$snap_age" I_QUOTA_AGE="$quota_age" \
    I_CODEFORGE="$codeforge" I_VERDICT="$verdict" I_NODE="$NODE_BIN" \
    "$NODE_BIN" -e '
      const env = process.env;
      const num = (v) => (v === "" ? null : Number(v));
      const o = {
        host: env.I_HOST,
        user: env.I_USER,
        timer_installed: env.I_INST === "1",
        timer_enabled: env.I_EN === "1",
        last_tick: env.I_TICK === "" ? null : env.I_TICK,
        snapshot_dir_exists: env.I_SNAP_DIR === "1",
        newest_snapshot_age_s: num(env.I_SNAP_AGE),
        quota_out_newest_age_s: num(env.I_QUOTA_AGE),
        codeforge_on_path: env.I_CODEFORGE === "1",
        node_path: env.I_NODE === "" ? null : env.I_NODE,
        verdict: env.I_VERDICT,
      };
      process.stdout.write(JSON.stringify(o) + "\n");
    '
  else
    json_str() {
      local s="$1"
      s="${s//\\/\\\\}"
      s="${s//\"/\\\"}"
      s="${s//$'\n'/\\n}"
      printf '"%s"' "$s"
    }
    json_num() { if [ -z "$1" ]; then printf 'null'; else printf '%s' "$1"; fi; }
    json_bool() { if [ "$1" = "1" ]; then printf 'true'; else printf 'false'; fi; }
    printf '{"host":%s,"user":%s,"timer_installed":%s,"timer_enabled":%s,"last_tick":%s,"snapshot_dir_exists":%s,"newest_snapshot_age_s":%s,"quota_out_newest_age_s":%s,"codeforge_on_path":%s,"node_path":null,"verdict":%s}\n' \
      "$(json_str "$host")" "$(json_str "$user")" \
      "$(timer_installed && json_bool 1 || json_bool 0)" \
      "$(timer_enabled && json_bool 1 || json_bool 0)" \
      "$([ -z "$tick" ] && printf 'null' || json_str "$tick")" \
      "$(json_bool "$snap_exists")" \
      "$(json_num "$snap_age")" "$(json_num "$quota_age")" \
      "$(json_bool "$codeforge")" "$(json_str "$verdict")"
  fi

  if [ "$codeforge" != "1" ]; then
    printf 'rollout-quota-mirror: codeforge not on PATH; hangar: %s\n' "$HANGAR_CMD" >&2
  fi
  if [ "$verdict" = "no_snapshot" ]; then
    printf 'rollout-quota-mirror: no statusline snapshot under %s; hangar: %s\n' "$snap_dir" "$HANGAR_CMD" >&2
  fi
  if [ "$verdict" != "ok" ] || [ "$codeforge" != "1" ]; then
    return 3
  fi
  return 0
}

require_node_and_installer() {
  if [ -z "$NODE_BIN" ]; then
    printf 'rollout-quota-mirror: node not found\n' >&2
    return 3
  fi
  if [ -z "$INSTALLER" ] || [ ! -f "$INSTALLER" ]; then
    printf 'rollout-quota-mirror: installer not found\n' >&2
    return 3
  fi
}

installer_dry_out() {
  "$NODE_BIN" "$INSTALLER" install --dry-run
}

needs_install_write() {
  local out="$1"
  printf '%s\n' "$out" | grep -q 'would write:'
}

print_sha_line() {
  local kind="$1" name="$2" file="$3"
  if [ -f "$file" ]; then
    printf '%s sha16 %s %s\n' "$kind" "$name" "$(sha16_of "$file")"
  else
    printf '%s sha16 %s none\n' "$kind" "$name"
  fi
}

do_apply() {
  local dry="$1" dir epoch name src bak out changed
  require_node_and_installer
  dir="$(unit_dir)"
  epoch="$(date +%s)"
  out="$(installer_dry_out)"
  if needs_install_write "$out"; then changed=1; else changed=0; fi

  if [ "$dry" = "1" ]; then
    printf 'dry-run: write nothing\n'
    for name in "${UNITS[@]}"; do
      src="$dir/$name"
      if [ "$changed" = "1" ] && [ -f "$src" ]; then
        printf 'would backup %s -> %s.bak.%s\n' "$src" "$src" "$epoch"
        print_sha_line would-backup "$name" "$src"
      else
        printf 'would backup %s none\n' "$name"
      fi
    done
    if [ "$changed" = "1" ]; then
      printf 'would run: node %s install\n' "$INSTALLER"
    else
      printf 'unchanged\n'
      for name in "${UNITS[@]}"; do
        print_sha_line unchanged "$name" "$dir/$name"
      done
    fi
    printf 'would run: systemctl --user daemon-reload && systemctl --user enable --now quota-mirror.timer\n'
    print_rollback "$epoch"
    emit_inventory
    return
  fi

  if [ "$changed" = "1" ]; then
    mkdir -p -- "$dir"
    for name in "${UNITS[@]}"; do
      src="$dir/$name"
      bak="$src.bak.$epoch"
      if [ -f "$src" ]; then
        cp -- "$src" "$bak"
        print_sha_line backup "$name" "$bak"
      else
        printf 'backup sha16 %s none\n' "$name"
      fi
    done
    "$NODE_BIN" "$INSTALLER" install
    for name in "${UNITS[@]}"; do
      print_sha_line new "$name" "$dir/$name"
    done
  else
    printf 'unchanged\n'
    for name in "${UNITS[@]}"; do
      print_sha_line unchanged "$name" "$dir/$name"
    done
  fi
  systemctl_apply daemon-reload daemon-reload
  systemctl_apply enable enable --now quota-mirror.timer
  print_rollback "$epoch"
  emit_inventory
}

do_rollback() {
  local epoch="$1" dir name src bak any=0
  require_node_and_installer
  case "$epoch" in
    ''|*[!0-9]*) printf 'rollout-quota-mirror: epoch must be digits\n' >&2; return 2 ;;
  esac
  dir="$(unit_dir)"
  for name in "${UNITS[@]}"; do
    if [ -f "$dir/$name.bak.$epoch" ]; then any=1; fi
  done
  if [ "$any" = "1" ]; then
    for name in "${UNITS[@]}"; do
      src="$dir/$name"
      bak="$src.bak.$epoch"
      if [ -f "$bak" ]; then
        cp -- "$bak" "$src"
        printf 'restored %s\n' "$name"
      fi
    done
    systemctl --user daemon-reload
    if timer_enabled || systemctl --user is-enabled quota-mirror.timer >/dev/null 2>&1; then
      systemctl --user restart quota-mirror.timer
    fi
  else
    "$NODE_BIN" "$INSTALLER" uninstall
    systemctl --user daemon-reload
    systemctl --user disable --now quota-mirror.timer
    printf 'uninstalled\n'
  fi
  emit_inventory
}

usage() {
  cat <<'EOF'
usage: scripts/rollout-quota-mirror.sh [--inventory]
       scripts/rollout-quota-mirror.sh --apply [--dry-run]
       scripts/rollout-quota-mirror.sh --rollback <epoch>
Reads the current account only. Does not ssh. Does not run codeforge install.
EOF
}

main() {
  local mode="inventory" dry=0 epoch=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --inventory) mode="inventory" ;;
      --apply) mode="apply" ;;
      --dry-run) dry=1 ;;
      --rollback)
        mode="rollback"
        shift
        [ $# -gt 0 ] || { usage >&2; return 2; }
        epoch="$1"
        ;;
      -h|--help) usage; return 0 ;;
      *) printf 'rollout-quota-mirror: unknown argument: %s\n' "$1" >&2; usage >&2; return 2 ;;
    esac
    shift
  done
  if [ "$dry" = "1" ] && [ "$mode" != "apply" ]; then
    printf 'rollout-quota-mirror: --dry-run is only valid with --apply\n' >&2
    return 2
  fi
  case "$mode" in
    inventory) emit_inventory ;;
    apply) do_apply "$dry" ;;
    rollback) do_rollback "$epoch" ;;
  esac
}

main "$@"
