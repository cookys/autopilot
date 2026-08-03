#!/usr/bin/env bash
# Privileged P3.7 U5 live gate (opt-in AUTOPILOT_P37_LIVE=1). getent: 0 present,
# 2 not-found, other unverifiable. finish_live owns cleanup+verify+finalize;
# EXIT trap is emergency-only and never fail/finalize after a fixed result.
. "$(dirname "$0")/lib.sh"
TEST_NAME="supervised-owner-kernel-installed-live"
RUNTIME_PARENT="/run/autopilot-production-installed"
TRUSTED_RECOVERY_PARENT="/run/autopilot-production-installed-recovery"
TRUSTED_NODE_PATH="/usr/bin/node"
SERVICE_IDENTITIES=(
  autopilot-p37i-kernel
  autopilot-p37i-worker
  autopilot-p37i-broker
  autopilot-p37i-receipt-verifier
  autopilot-p37i-witness
  autopilot-p37i-coordinator
)
SERVICE_UNITS=(
  autopilot-p37i-kernel.service
  autopilot-p37i-worker.service
  autopilot-p37i-broker.service
  autopilot-p37i-receipt-verifier.service
  autopilot-p37i-witness.service
  autopilot-p37i-coordinator.service
)
if [ "${AUTOPILOT_P37_LIVE:-0}" != "1" ]; then
  echo "SKIP [$TEST_NAME] set AUTOPILOT_P37_LIVE=1 to run the privileged disposable Linux gate"
  finalize_test
  exit 0
fi
getent_identity_rc() {
  local kind="$1" identity="$2"
  getent "$kind" "$identity" >/dev/null 2>/dev/null
  return $?
}
preflight_failed=0
if ! sudo -n true 2>/dev/null; then
  fail "$TEST_NAME requires passwordless sudo when AUTOPILOT_P37_LIVE=1"
  preflight_failed=1
fi
if [ ! -x /usr/bin/systemd-run ] || [ ! -x /usr/bin/systemctl ] || [ ! -x "$TRUSTED_NODE_PATH" ]; then
  fail "$TEST_NAME requires systemd-run, systemctl, and fixed trusted Node at $TRUSTED_NODE_PATH"
  preflight_failed=1
fi
if ! /usr/bin/systemctl is-system-running >/dev/null 2>&1; then
  fail "$TEST_NAME requires a running systemd manager"
  preflight_failed=1
fi
if sudo -n test -e "$RUNTIME_PARENT"; then
  fail "$TEST_NAME refuses a pre-existing installed runtime parent"
  preflight_failed=1
fi
for unit in "${SERVICE_UNITS[@]}"; do
  load_state="$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$unit")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "$TEST_NAME systemctl show LoadState failed for unit $unit (rc=$rc); absence unverifiable"
    preflight_failed=1
  elif [ "$load_state" != "not-found" ]; then
    fail "$TEST_NAME refuses pre-existing installed service unit: $unit (LoadState=$load_state)"
    preflight_failed=1
  fi
  active_state="$(sudo -n /usr/bin/systemctl show --property=ActiveState --value "$unit")"
  arc=$?
  if [ "$arc" -ne 0 ]; then
    fail "$TEST_NAME systemctl show ActiveState failed for unit $unit (rc=$arc); absence unverifiable"
    preflight_failed=1
  fi
done
for identity in "${SERVICE_IDENTITIES[@]}"; do
  for kind in passwd group; do
    getent_identity_rc "$kind" "$identity"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      fail "$TEST_NAME refuses pre-existing dedicated $kind: $identity"
      preflight_failed=1
    elif [ "$rc" -ne 2 ]; then
      fail "$TEST_NAME getent $kind failed for $identity (rc=$rc); absence unverifiable"
      preflight_failed=1
    fi
  done
done
if [ "$preflight_failed" -ne 0 ]; then
  finalize_test
  exit 1
fi
# Pin disposable fixtures under the fixed trusted recovery parent (exclusive mkdir).
# Mode 0711: dedicated service UIDs traverse without list/mutate (0700 caused EACCES).
if ! sudo -n test -d /run; then
  fail "$TEST_NAME requires trusted /run grandparent"; finalize_test; exit 1
fi
if ! sudo -n test -d "$TRUSTED_RECOVERY_PARENT"; then
  if sudo -n test -e "$TRUSTED_RECOVERY_PARENT" \
    || ! sudo -n /usr/bin/mkdir "$TRUSTED_RECOVERY_PARENT"; then
    fail "$TEST_NAME cannot establish exclusive trusted recovery parent"; finalize_test; exit 1
  fi
fi
if ! sudo -n /usr/bin/chown root:root "$TRUSTED_RECOVERY_PARENT" \
  || ! sudo -n /usr/bin/chmod 0711 "$TRUSTED_RECOVERY_PARENT"; then
  fail "$TEST_NAME cannot establish trusted recovery parent mode 0711"; finalize_test; exit 1
fi
_recovery_mode="$(sudo -n /usr/bin/stat -c '%a' "$TRUSTED_RECOVERY_PARENT" 2>/dev/null || true)"
_recovery_owner="$(sudo -n /usr/bin/stat -c '%U:%G' "$TRUSTED_RECOVERY_PARENT" 2>/dev/null || true)"
if [ "$_recovery_mode" != "711" ] || [ "$_recovery_owner" != "root:root" ]; then
  fail "$TEST_NAME trusted recovery parent must be root:root 0711 (got ${_recovery_owner:-?}:${_recovery_mode:-?})"
  finalize_test; exit 1
fi
live_parent="$TRUSTED_RECOVERY_PARENT/live-$$-$RANDOM"
install_root="$live_parent/install"
state_root="$live_parent/state"
handoff_root="$live_parent/p35-handoff"
out="$TEST_TMP/p37-live.out"
err="$TEST_TMP/p37-live.err"
created_identities=()
cleanup_failures=0
CLEANUP_DONE=0
verify_resource_absent() {
  local identity unit rc load_state residual_count=0
  for unit in "${SERVICE_UNITS[@]}"; do
    load_state="$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$unit")"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      printf 'FAIL [%s] systemctl show failed for unit %s (rc=%s); residue unverifiable\n' \
        "$TEST_NAME" "$unit" "$rc" >&2
      residual_count=$((residual_count + 1))
      continue
    fi
    if [ -n "$load_state" ] && [ "$load_state" != "not-found" ]; then
      printf 'FAIL [%s] residual installed unit remains: %s (LoadState=%s)\n' \
        "$TEST_NAME" "$unit" "$load_state" >&2
      residual_count=$((residual_count + 1))
    fi
  done
  for identity in "${SERVICE_IDENTITIES[@]}"; do
    for kind in passwd group; do
      getent_identity_rc "$kind" "$identity"
      rc=$?
      if [ "$rc" -eq 0 ]; then
        printf 'FAIL [%s] residual dedicated %s remains: %s\n' "$TEST_NAME" "$kind" "$identity" >&2
        residual_count=$((residual_count + 1))
      elif [ "$rc" -ne 2 ]; then
        printf 'FAIL [%s] getent %s failed for %s (rc=%s); residue unverifiable\n' \
          "$TEST_NAME" "$kind" "$identity" "$rc" >&2
        residual_count=$((residual_count + 1))
      fi
    done
  done
  if sudo -n test -e "$RUNTIME_PARENT"; then
    printf 'FAIL [%s] residual runtime parent remains: %s\n' "$TEST_NAME" "$RUNTIME_PARENT" >&2
    residual_count=$((residual_count + 1))
  fi
  if [ -n "${live_parent:-}" ] && sudo -n test -e "$live_parent"; then
    printf 'FAIL [%s] residual live parent remains: %s\n' "$TEST_NAME" "$live_parent" >&2
    residual_count=$((residual_count + 1))
  fi
  return "$residual_count"
}
cleanup_live() {
  local unit identity load_state rc
  set +e
  cleanup_failures=0
  for unit in "${SERVICE_UNITS[@]}"; do
    load_state="$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$unit" 2>/dev/null)"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      cleanup_failures=$((cleanup_failures + 1))
      continue
    fi
    if [ -n "$load_state" ] && [ "$load_state" != "not-found" ]; then
      if ! sudo -n /usr/bin/systemctl stop "$unit"; then
        cleanup_failures=$((cleanup_failures + 1))
      fi
      sudo -n /usr/bin/systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    fi
  done
  if sudo -n test -e "$RUNTIME_PARENT"; then
    if ! sudo -n rmdir "$RUNTIME_PARENT" 2>/dev/null; then
      if ! sudo -n /usr/bin/python3 -I - "$RUNTIME_PARENT" <<'PY'
import os, stat, sys
root = sys.argv[1]
if root != "/run/autopilot-production-installed":
    raise SystemExit("unexpected runtime parent")
def remove(path):
    try: info = os.lstat(path)
    except FileNotFoundError: return
    if stat.S_ISLNK(info.st_mode): os.unlink(path); return
    if stat.S_ISDIR(info.st_mode):
        for entry in os.scandir(path): remove(entry.path)
        os.rmdir(path); return
    if stat.S_ISREG(info.st_mode) or stat.S_ISSOCK(info.st_mode):
        os.unlink(path); return
    raise SystemExit("unexpected entry")
if os.path.isdir(root):
    for entry in os.scandir(root): remove(entry.path)
    os.rmdir(root)
PY
      then
        cleanup_failures=$((cleanup_failures + 1))
      fi
    fi
  fi
  if [ -n "${live_parent:-}" ]; then
    if ! sudo -n /usr/bin/python3 -I - "$live_parent" "$TRUSTED_RECOVERY_PARENT" <<'PY'
import os, stat, sys
root, parent = sys.argv[1], sys.argv[2]
if not root.startswith(parent + os.sep):
    raise SystemExit('unexpected disposable live root')
def remove(path):
    try: info = os.lstat(path)
    except FileNotFoundError: return
    if stat.S_ISLNK(info.st_mode): os.unlink(path); return
    if stat.S_ISDIR(info.st_mode):
        for entry in os.scandir(path): remove(entry.path)
        os.rmdir(path); return
    if stat.S_ISREG(info.st_mode) or stat.S_ISSOCK(info.st_mode):
        os.unlink(path); return
    raise SystemExit('unexpected fixture entry type')
if os.path.lexists(root):
    remove(root)
PY
    then
      cleanup_failures=$((cleanup_failures + 1))
    fi
  fi
  for identity in "${created_identities[@]:-}"; do
    getent_identity_rc passwd "$identity"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      if ! sudo -n /usr/sbin/userdel "$identity"; then
        cleanup_failures=$((cleanup_failures + 1))
      fi
    elif [ "$rc" -ne 2 ]; then
      cleanup_failures=$((cleanup_failures + 1))
    fi
    getent_identity_rc group "$identity"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      if ! sudo -n /usr/sbin/groupdel "$identity"; then
        cleanup_failures=$((cleanup_failures + 1))
      fi
    elif [ "$rc" -ne 2 ]; then
      cleanup_failures=$((cleanup_failures + 1))
    fi
  done
}
emergency_cleanup() {
  [ "${CLEANUP_DONE:-0}" -eq 1 ] && return 0
  set +e
  cleanup_live >/dev/null 2>&1 || true
  CLEANUP_DONE=1
}
trap emergency_cleanup EXIT
finish_live() {
  local residual_rc=0
  set +e
  cleanup_live
  verify_resource_absent
  residual_rc=$?
  CLEANUP_DONE=1
  if [ "$cleanup_failures" -ne 0 ]; then
    fail "$TEST_NAME live cleanup accumulated $cleanup_failures failure(s)"
  fi
  if [ "$residual_rc" -ne 0 ]; then
    fail "$TEST_NAME post-cleanup absence verification failed ($residual_rc residual issue(s))"
  fi
  finalize_test
}
# Live parent exclusivity: prove absent, plain exclusive mkdir (never mkdir -p).
if sudo -n test -e "$live_parent"; then
  fail "$TEST_NAME refuses pre-existing or colliding live_parent: $live_parent"
  finish_live
fi
if ! sudo -n /usr/bin/mkdir "$live_parent"; then
  fail "$TEST_NAME exclusive live_parent mkdir failed (no adoption): $live_parent"
  finish_live
fi
sudo -n /usr/bin/chown root:root "$live_parent"
sudo -n /usr/bin/chmod 0755 "$live_parent"
# install_root must stay absent for host install exclusivity; only pin state/handoff leaves.
if ! sudo -n /usr/bin/mkdir "$state_root"; then
  fail "$TEST_NAME exclusive state_root mkdir failed"
  finish_live
fi
if ! sudo -n /usr/bin/mkdir "$handoff_root"; then
  fail "$TEST_NAME exclusive handoff_root mkdir failed"
  finish_live
fi
sudo -n /usr/bin/chown root:root "$handoff_root"
sudo -n /usr/bin/chmod 0700 "$handoff_root"
sudo -n /usr/bin/chown root:root "$state_root"
sudo -n /usr/bin/chmod 0711 "$state_root"
handoff_id="p37-live-handoff-$$"
sudo -n /usr/bin/python3 -I - "$handoff_root" "$handoff_id" <<'PY'
import hashlib, json, os, sys
root, handoff_id = sys.argv[1], sys.argv[2]
def h(value):
    if not isinstance(value, str):
        value = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode()).hexdigest()
handoff = {
    "handoff_hash": h("live-handoff"),
    "p35_install_binding_hash": h("live-p35-install"),
    "bridge_plan_hash": h("live-bridge-plan"),
    "handoff_id": handoff_id,
}
path = os.path.join(root, handoff_id + ".json")
with open(path, "w", encoding="utf-8") as handle:
    handle.write(json.dumps(handoff, sort_keys=True, separators=(",", ":")) + "\n")
os.chmod(path, 0o600)
os.chown(path, 0, 0)
PY
host_src="$REPO_ROOT/src/engine/supervised-owner-kernel-installed-host.py"
if ! sudo -n /usr/bin/python3 -I "$host_src" install \
  --install-root "$install_root" \
  --state-root "$state_root" \
  --p35-handoff-root "$handoff_root" \
  --create-identities >"$out" 2>"$err"; then
  fail "$TEST_NAME install failed: $(cat "$err")"
  finish_live
fi
mapfile -t created_identities < <(
  /usr/bin/python3 -I - "$out" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    raw = handle.read().strip().splitlines()
payload = json.loads(raw[-1])
for identity in payload.get("created_identities") or []:
    if not isinstance(identity, str) or not identity:
        raise SystemExit("invalid created identity")
    print(identity)
PY
)
if [ "${#created_identities[@]}" -ne 6 ]; then
  fail "$TEST_NAME install did not report exactly six confirmed created identities"
  finish_live
fi
# Six service UIDs must traverse recovery parent to open the installed snapshot (live EACCES site).
service_py="$install_root/lib/supervised-owner-kernel-installed-service.py"
for identity in "${created_identities[@]}"; do
  if ! sudo -n -u "$identity" /usr/bin/test -x "$TRUSTED_RECOVERY_PARENT"; then
    fail "$TEST_NAME service identity cannot traverse trusted recovery parent: $identity"
    finish_live
  fi
  if ! sudo -n -u "$identity" /usr/bin/test -r "$service_py"; then
    fail "$TEST_NAME service identity cannot open installed service via recovery parent: $identity"
    finish_live
  fi
done
if ! sudo -n /usr/bin/python3 -I - "$install_root" <<'PY'
import json, os, stat, sys, hashlib
install_root = sys.argv[1]
with open(os.path.join(install_root, "etc/supervised-owner-kernel-installed.json"), "rb") as handle:
    config = json.loads(handle.read().decode("utf-8").rstrip("\n"))
meta = config["files"]["node_runtime"]
node_path = os.path.join(install_root, meta["path"])
info = os.lstat(node_path)
if (stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0 or info.st_gid != 0
        or (info.st_mode & 0o111) == 0 or (info.st_mode & 0o022) != 0):
    raise SystemExit("installed node runtime ownership/mode invalid")
if config["paths"]["node_path"] != node_path:
    raise SystemExit("installed config node_path does not pin the snapshot")
if len(config.get("created_identities") or []) != 6:
    raise SystemExit("install must track all six created identities")
digest = hashlib.sha256()
with open(node_path, "rb") as handle:
    while True:
        chunk = handle.read(1024 * 1024)
        if not chunk: break
        digest.update(chunk)
if digest.hexdigest() != meta["sha256"]:
    raise SystemExit("installed node runtime hash drifted")
print("node-runtime-ok")
PY
then
  fail "$TEST_NAME installed node runtime is not a root-owned hash-pinned snapshot"
  finish_live
fi
assert_contains "$(cat "$out")" '"status":"installed"'
assert_contains "$(cat "$out")" '"fixed_probe_catalog_id":"owner-kernel-probe-toggle-v1"'
assert_contains "$(cat "$out")" 'autopilot-p37i-kernel'
if ! sudo -n /usr/bin/python3 -I "$install_root/sbin/supervised-owner-kernel-installed-host.py" run-probe \
  --handoff-id "$handoff_id" >"$out" 2>"$err"; then
  fail "$TEST_NAME run-probe failed: $(cat "$err") | out=$(cat "$out")"
  finish_live
fi
assert_contains "$(cat "$out")" '"probe_catalog_id":"owner-kernel-probe-toggle-v1"'
assert_contains "$(cat "$out")" '"effect_replayed":false'
assert_contains "$(cat "$out")" '"engine_sink":"disabled"'
assert_contains "$(cat "$out")" '"outcome":"completed"'
assert_contains "$(cat "$out")" '"sentinel_restored":true'
for unit in "${SERVICE_UNITS[@]}"; do
  load_state="$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$unit")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "$TEST_NAME systemctl show failed for $unit after run-probe (residue unverifiable)"
  fi
  if [ -n "$load_state" ] && [ "$load_state" != "not-found" ]; then
    fail "$TEST_NAME left installed service unit behind: $unit"
  fi
done
if sudo -n test -e "$RUNTIME_PARENT"; then
  if ! sudo -n rmdir "$RUNTIME_PARENT" 2>/dev/null; then
    fail "$TEST_NAME left residue under $RUNTIME_PARENT"
  fi
fi
for identity in "${SERVICE_IDENTITIES[@]}"; do
  for kind in passwd group; do
    getent_identity_rc "$kind" "$identity"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      fail "$TEST_NAME left dedicated $kind residue: $identity"
    elif [ "$rc" -ne 2 ]; then
      fail "$TEST_NAME getent $kind failed for $identity after run-probe (rc=$rc); residue unverifiable"
    fi
  done
done
finish_live
