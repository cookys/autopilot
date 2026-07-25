#!/usr/bin/env bash
# Explicit privileged P0-A0 evidence. This gate never upgrades the original
# Owner-Kernel P0 verdict: it exercises only the installed no-effect substrate.

. "$(dirname "$0")/lib.sh"

TEST_NAME="supervised-production-substrate-p0-live"
P35_RUNTIME_PARENT="/run/autopilot-intake"
P36_RUNTIME_PARENT="/run/autopilot-production-durable"
FIXTURE_LOCK="/run/autopilot-p0-a0-live.fixture-lock"
P36_IDENTITIES=(
  autopilot-p36d-worker
  autopilot-p36d-broker
  autopilot-p36d-receipt-verifier
  autopilot-p36d-witness
  autopilot-p36d-coordinator
)
P35_IDENTITIES=(
  autopilot-intake-worker
  autopilot-verifier
  autopilot-shadow-witness
)

if [ "${AUTOPILOT_P0_A0_LIVE:-0}" != "1" ]; then
  echo "SKIP [$TEST_NAME] set AUTOPILOT_P0_A0_LIVE=1 to run the privileged P3.5-to-P3.6 boundary gate"
  finalize_test
  exit 0
fi

preflight_failed=0
node_command="$(command -v node 2>/dev/null)"
node_command_status=$?
node_source=""
if [ "$node_command_status" -eq 0 ]; then
  node_source="$(readlink -f "$node_command" 2>/dev/null)"
fi
if ! sudo -n true 2>/dev/null; then
  fail "$TEST_NAME requires passwordless sudo when AUTOPILOT_P0_A0_LIVE=1"
  preflight_failed=1
fi
if [ ! -x /usr/bin/systemd-run ] || [ ! -x /usr/bin/systemctl ] || [ ! -x "$node_source" ]; then
  fail "$TEST_NAME requires systemd-run, systemctl, and a local Node executable"
  preflight_failed=1
fi
if [ ! -x /usr/sbin/useradd ] || [ ! -x /usr/sbin/userdel ] || [ ! -x /usr/sbin/groupdel ]; then
  fail "$TEST_NAME requires the system account-management executables"
  preflight_failed=1
fi
if ! /usr/bin/systemctl is-system-running >/dev/null 2>&1; then
  fail "$TEST_NAME requires a running systemd manager"
  preflight_failed=1
fi
for runtime_parent in "$P35_RUNTIME_PARENT" "$P36_RUNTIME_PARENT"; do
  if sudo -n test -e "$runtime_parent"; then
    fail "$TEST_NAME refuses a pre-existing runtime parent: $runtime_parent"
    preflight_failed=1
  fi
done
if sudo -n test -e "$FIXTURE_LOCK"; then
  fail "$TEST_NAME refuses an existing root-owned fixture lock: $FIXTURE_LOCK"
  preflight_failed=1
fi
for unit_glob in 'autopilot-p35-worker-*' 'autopilot-p35-verifier-*' 'autopilot-p35-shadow-witness-*' 'autopilot-p36d-*'; do
  if sudo -n /usr/bin/systemctl list-units --all --no-legend "$unit_glob" | /usr/bin/grep -q '^autopilot-'; then
    fail "$TEST_NAME refuses pre-existing transient units matching $unit_glob"
    preflight_failed=1
  fi
done
if [ "$preflight_failed" -ne 0 ]; then
  finalize_test
  exit 1
fi

live_parent="/run/autopilot-p0-a0-live-$$-$RANDOM"
stage_root="$TEST_TMP/p0-a0-stage"
p35_install="$live_parent/p35-install"
p35_state="$live_parent/p35-state"
p35_workspace_registry="$live_parent/p35-workspace-registry"
p35_witness_state="$live_parent/p35-shadow-witness-state"
p35_handoff_root="$p35_workspace_registry/p36-handoff"
p36_install="$live_parent/p36-install"
p36_state="$live_parent/p36-state"
tamper_install="$live_parent/p36-tamper-install"
tamper_state="$live_parent/p36-tamper-state"
node_root="$live_parent/nodejs"
node_path="$node_source"
keyring_path="$stage_root/keyring.json"
private_key_path="$stage_root/private.pem"
registry_out="$stage_root/workspace-registry.out"
registry_err="$stage_root/workspace-registry.err"
registry_pid=""
registry_start_token=""
created_p36_identities=()
created_p35_identities=()
preexisting_p36_identities=()
preexisting_p35_identities=()
created_units=()
# Records are pid:start-token pairs. The token prevents EXIT cleanup from
# signaling an unrelated process if Bash has already reaped a completed child
# and Linux subsequently reuses its numeric PID.
background_host_records=()
fixture_lock_created=0
worker_uid=""
worker_gid=""
created_handoff_id=""
created_workspace_root=""
created_session_id=""

for identity in "${P36_IDENTITIES[@]}"; do
  if getent passwd "$identity" >/dev/null; then
    preexisting_p36_identities+=("$identity")
  fi
done
for identity in "${P35_IDENTITIES[@]}"; do
  if getent passwd "$identity" >/dev/null; then
    preexisting_p35_identities+=("$identity")
  fi
done

remember_unit() {
  local candidate="$1"
  local unit
  for unit in "${created_units[@]}"; do
    if [ "$unit" = "$candidate" ]; then
      return 0
    fi
  done
  created_units+=("$candidate")
}

process_start_token() {
  local pid="$1"
  /usr/bin/awk 'NR == 1 { print $22 }' "/proc/$pid/stat" 2>/dev/null || true
}

identity_was_preexisting() {
  local candidate="$1"
  local identity
  for identity in "${preexisting_p36_identities[@]}" "${preexisting_p35_identities[@]}"; do
    if [ "$identity" = "$candidate" ]; then
      return 0
    fi
  done
  return 1
}

acquire_fixture_lock() {
  if ! sudo -n mkdir "$FIXTURE_LOCK"; then
    fail "$TEST_NAME could not acquire its exclusive identity fixture lock"
    return 1
  fi
  fixture_lock_created=1
  if ! sudo -n chown root:root "$FIXTURE_LOCK" || ! sudo -n chmod 700 "$FIXTURE_LOCK"; then
    fail "$TEST_NAME could not harden its exclusive identity fixture lock"
    return 1
  fi
  if [ "$(sudo -n stat -c '%u:%g:%a' "$FIXTURE_LOCK")" != "0:0:700" ]; then
    fail "$TEST_NAME identity fixture lock has an unexpected identity or mode"
    return 1
  fi
  return 0
}

provision_fixture_identity() {
  local identity="$1"
  local family="$2"
  local account
  local uid
  local gid
  if identity_was_preexisting "$identity"; then
    if ! getent passwd "$identity" >/dev/null; then
      fail "$TEST_NAME pre-existing identity disappeared during fixture setup: $identity"
      return 1
    fi
    return 0
  fi
  if getent passwd "$identity" >/dev/null; then
    fail "$TEST_NAME identity appeared after its preflight snapshot: $identity"
    return 1
  fi
  if ! sudo -n /usr/sbin/useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin "$identity"; then
    fail "$TEST_NAME could not atomically create its disposable identity: $identity"
    return 1
  fi
  account="$(getent passwd "$identity" || true)"
  IFS=: read -r _ _ uid gid _ _ _ <<<"$account"
  if ! [[ "$uid" =~ ^[1-9][0-9]*$ ]] || ! [[ "$gid" =~ ^[1-9][0-9]*$ ]]; then
    fail "$TEST_NAME created identity has an invalid UID/GID: $identity"
    return 1
  fi
  case "$family" in
    p36) created_p36_identities+=("$identity:$uid:$gid") ;;
    p35) created_p35_identities+=("$identity:$uid:$gid") ;;
    *)
      fail "$TEST_NAME identity helper received an unknown family"
      return 1
      ;;
  esac
  return 0
}

remember_background_host() {
  local pid="$1"
  local start_token
  start_token="$(process_start_token "$pid")"
  if ! [[ "$start_token" =~ ^[0-9]+$ ]]; then
    sudo -n /bin/kill -TERM "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
    fail "$TEST_NAME could not capture the background host start token"
    return 1
  fi
  background_host_records+=("$pid:$start_token")
}

forget_background_host() {
  local candidate="$1"
  local record
  local pid
  local remaining=()
  for record in "${background_host_records[@]}"; do
    pid="${record%%:*}"
    if [ "$pid" != "$candidate" ]; then
      remaining+=("$record")
    fi
  done
  background_host_records=("${remaining[@]}")
}

wait_for_background_host() {
  local pid="$1"
  local status
  wait "$pid" >/dev/null 2>&1
  status=$?
  forget_background_host "$pid"
  return "$status"
}

background_host_record_matches() {
  local record="$1"
  local pid="${record%%:*}"
  local expected_token="${record#*:}"
  local observed_token
  observed_token="$(process_start_token "$pid")"
  [ "$observed_token" = "$expected_token" ] && [[ "$observed_token" =~ ^[0-9]+$ ]]
}

wait_for_unit_unload() {
  local unit="$1"
  local state
  local _
  for _ in $(seq 1 100); do
    state="$(sudo -n /usr/bin/systemctl show --property=LoadState --value "$unit" 2>/dev/null || true)"
    if [ "$state" = "not-found" ]; then
      return 0
    fi
    sleep 0.05
  done
  printf 'FAIL [%s] transient unit did not unload during cleanup: %s\n' "$TEST_NAME" "$unit" >&2
  return 1
}

record_p36_attempt_units() {
  local unit
  while read -r unit; do
    case "${unit:-}" in
      autopilot-p36d-*.service) remember_unit "$unit" ;;
    esac
  done < <(sudo -n /usr/bin/python3 -I - "$p36_state/attempts" <<'PY' 2>/dev/null
import json
import os
import sys

root = sys.argv[1]
if os.path.isdir(root):
    for name in sorted(os.listdir(root)):
        if not name.endswith('.json'):
            continue
        with open(os.path.join(root, name), encoding='utf-8') as source:
            value = json.load(source)
        for unit in value.get('units', []):
            name = unit.get('unit')
            if isinstance(name, str):
                print(name)
PY
)
}

stop_workspace_registry() {
  local pid="${registry_pid:-}"
  local observed_token
  if [ -z "$pid" ]; then
    return 0
  fi
  observed_token="$(process_start_token "$pid")"
  if [ -n "$registry_start_token" ] && [ "$observed_token" = "$registry_start_token" ]; then
    sudo -n /bin/kill -TERM "$pid" >/dev/null 2>&1 || return 1
  fi
  if ! wait "$pid"; then
    return 1
  fi
  registry_pid=""
  registry_start_token=""
  return 0
}

cleanup_live() {
  local status="$?"
  local unit
  local identity_record
  local identity
  local expected_uid
  local expected_gid
  local account
  local actual_uid
  local actual_gid
  set +e

  if ! stop_workspace_registry; then
    printf 'FAIL [%s] workspace registry could not be stopped\n' "$TEST_NAME" >&2
    status=1
  fi

  for record in "${background_host_records[@]}"; do
    pid="${record%%:*}"
    if background_host_record_matches "$record"; then
      sudo -n /bin/kill -TERM "$pid" >/dev/null 2>&1 || status=1
    fi
  done
  for record in "${background_host_records[@]}"; do
    pid="${record%%:*}"
    wait "$pid" >/dev/null 2>&1 || true
  done
  background_host_records=()

  record_p36_attempt_units
  for unit in "${created_units[@]}"; do
    sudo -n /usr/bin/systemctl stop "$unit" >/dev/null 2>&1
    sudo -n /usr/bin/systemctl reset-failed "$unit" >/dev/null 2>&1
    wait_for_unit_unload "$unit" || status=1
  done

  for runtime_parent in "$P36_RUNTIME_PARENT" "$P35_RUNTIME_PARENT"; do
    if sudo -n test -e "$runtime_parent" && ! sudo -n rmdir "$runtime_parent"; then
      printf 'FAIL [%s] runtime parent was not empty at cleanup: %s\n' "$TEST_NAME" "$runtime_parent" >&2
      status=1
    fi
  done

  sudo -n /usr/bin/python3 -I - "$live_parent" <<'PY' 2>/dev/null || status=1
import os
import stat
import sys

root = sys.argv[1]
if not root.startswith('/run/autopilot-p0-a0-live-'):
    raise SystemExit('unexpected P0-A0 disposable root')

parent, name = os.path.split(root)
if parent != '/run' or not name:
    raise SystemExit('unexpected P0-A0 disposable root parent')

def remove_at(parent_fd, entry):
    try:
        info = os.stat(entry, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    mode = info.st_mode
    if stat.S_ISLNK(mode):
        os.unlink(entry, dir_fd=parent_fd)
        return
    if not stat.S_ISDIR(mode):
        if not (stat.S_ISREG(mode) or stat.S_ISSOCK(mode)):
            raise SystemExit('unexpected P0-A0 fixture entry type')
        os.unlink(entry, dir_fd=parent_fd)
        return
    descriptor = os.open(entry, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        for child in os.listdir(descriptor):
            remove_at(descriptor, child)
    finally:
        os.close(descriptor)
    os.rmdir(entry, dir_fd=parent_fd)

run_fd = os.open('/run', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    remove_at(run_fd, name)
finally:
    os.close(run_fd)
PY

  for identity_record in "${created_p36_identities[@]}" "${created_p35_identities[@]}"; do
    IFS=: read -r identity expected_uid expected_gid <<<"$identity_record"
    account="$(getent passwd "$identity" || true)"
    IFS=: read -r _ _ actual_uid actual_gid _ _ _ <<<"$account"
    if [ "$actual_uid" != "$expected_uid" ] || [ "$actual_gid" != "$expected_gid" ]; then
      printf 'FAIL [%s] disposable identity provenance changed before cleanup: %s\n' "$TEST_NAME" "$identity" >&2
      status=1
      continue
    fi
    if ! sudo -n /usr/sbin/userdel "$identity" >/dev/null 2>&1; then
      printf 'FAIL [%s] disposable identity %s could not be removed\n' "$TEST_NAME" "$identity" >&2
      status=1
      continue
    fi
    if getent group "$identity" >/dev/null && ! sudo -n /usr/sbin/groupdel "$identity" >/dev/null 2>&1; then
      printf 'FAIL [%s] disposable private group %s could not be removed\n' "$TEST_NAME" "$identity" >&2
      status=1
    fi
  done

  if [ "$fixture_lock_created" -eq 1 ]; then
    if [ "$(sudo -n stat -c '%u:%g:%a' "$FIXTURE_LOCK" 2>/dev/null)" != "0:0:700" ] \
      || ! sudo -n rmdir "$FIXTURE_LOCK"; then
      printf 'FAIL [%s] exclusive identity fixture lock could not be removed\n' "$TEST_NAME" >&2
      status=1
    fi
  fi

  cleanup_test_tmp
  trap - EXIT
  exit "$status"
}

assert_root_path_exists() {
  local path="$1"
  local message="$2"
  sudo -n test -e "$path"
  local status=$?
  assert_eq "$status" "0" "$message"
}

assert_root_path_absent() {
  local path="$1"
  local message="$2"
  sudo -n test -e "$path"
  local status=$?
  assert_eq "$status" "1" "$message"
}

trap cleanup_live EXIT
trap 'exit 130' INT TERM

sudo -n mkdir "$live_parent"
sudo -n chown root:root "$live_parent"
sudo -n chmod 755 "$live_parent"
mkdir -p "$stage_root"
chmod 700 "$stage_root"

if ! acquire_fixture_lock; then
  finalize_test
  exit 1
fi
for identity in "${P36_IDENTITIES[@]}"; do
  provision_fixture_identity "$identity" p36 || { finalize_test; exit 1; }
done
for identity in "${P35_IDENTITIES[@]}"; do
  provision_fixture_identity "$identity" p35 || { finalize_test; exit 1; }
done

# Installed hosts reject a user-owned Node binary. Copy only a versioned Node
# distribution when the system package is not already rooted at /usr/bin.
if [ "$node_source" != "/usr/bin/node" ]; then
  node_distribution="$(dirname "$(dirname "$node_source")")"
  case "$node_distribution" in
    /|/usr|/usr/local|/opt)
      fail "$TEST_NAME refuses to copy a broad Node ancestor: $node_distribution"
      finalize_test
      exit 1
      ;;
  esac
  case "$(basename "$node_distribution")" in
    node-*) ;;
    *)
      fail "$TEST_NAME requires a versioned Node distribution outside /usr/bin"
      finalize_test
      exit 1
      ;;
  esac
  sudo -n cp -a "$node_distribution" "$node_root"
  sudo -n chown -R root:root "$node_root"
  sudo -n chmod -R go-w "$node_root"
  node_path="$node_root/bin/node"
fi

node - "$REPO_ROOT" "$keyring_path" "$private_key_path" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [root, keyringPath, privatePath] = process.argv.slice(2);
const { canonicalJson } = require(path.join(root, 'src', 'engine', 'owner-kernel', 'canonical'));
const pair = crypto.generateKeyPairSync('ed25519');
const now = Date.now();
const keyring = {
  schema_version: 1,
  issuer: 'owner-control',
  keyring_id: 'p0-a0-owner-keyring',
  keyring_epoch: 1,
  keys: [{
    algorithm: 'ed25519',
    key_id: 'p0-a0-owner-ed25519',
    not_before_ms: now - 1000,
    not_after_ms: now + 240000,
    public_key_spki_base64: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
  }],
};
fs.writeFileSync(keyringPath, canonicalJson(keyring), { mode: 0o600 });
fs.writeFileSync(privatePath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
NODE
if [ "$?" -ne 0 ]; then
  fail "$TEST_NAME could not generate its disposable P3.5 signing key"
  finalize_test
  exit 1
fi

sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$REPO_ROOT/src/engine/supervised-intake-host.py" install \
  --install-root "$p35_install" \
  --state-root "$p35_state" \
    --workspace-registry-root "$p35_workspace_registry" \
    --witness-state-root "$p35_witness_state" \
    --keyring "$keyring_path" \
    --node-path "$node_path" >"$stage_root/p35-install.out" 2>"$stage_root/p35-install.err"
p35_install_status=$?
if [ "$p35_install_status" -ne 0 ]; then
  fail "P0-A0 installs a real P3.5 root host before P3.6: expected '0', got '$p35_install_status'"
  sed -n '1,160p' "$stage_root/p35-install.err" >&2
  finalize_test
  exit 1
fi
assert_eq "$p35_install_status" "0" "P0-A0 installs a real P3.5 root host before P3.6"

sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$p35_install/sbin/supervised-intake-host.py" workspace-registry-serve \
  >"$registry_out" 2>"$registry_err" &
registry_pid=$!
registry_start_token="$(process_start_token "$registry_pid")"
if ! [[ "$registry_start_token" =~ ^[0-9]+$ ]]; then
  sudo -n /bin/kill -TERM "$registry_pid" >/dev/null 2>&1 || true
  wait "$registry_pid" >/dev/null 2>&1 || true
  fail "$TEST_NAME could not capture the workspace registry start token"
  finalize_test
  exit 1
fi
registry_ready=0
for _ in $(seq 1 100); do
  if /usr/bin/grep -q '"status":"workspace_registry_ready"' "$registry_out"; then
    registry_ready=1
    break
  fi
  if ! kill -0 "$registry_pid" 2>/dev/null; then
    break
  fi
  sleep 0.05
done
if [ "$registry_ready" -ne 1 ]; then
  fail "$TEST_NAME workspace registry did not become ready"
  if [ -r "$registry_err" ]; then
    sed -n '1,120p' "$registry_err" >&2
  else
    printf 'registry stderr is unavailable: %s\n' "$registry_err" >&2
  fi
  finalize_test
  exit 1
fi
assert_contains "$(cat "$registry_out")" '"owner_kernel_authority":"none"' "real P3.5 registry remains non-authoritative"

install_p36() {
  local install_root="$1"
  local state_root="$2"
  local output_prefix="$3"
  sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
    "$REPO_ROOT/src/engine/supervised-production-substrate-durable-host.py" install \
    --install-root "$install_root" \
    --state-root "$state_root" \
    --p35-handoff-root "$p35_handoff_root" \
    --node-path "$node_path" >"$stage_root/$output_prefix.out" 2>"$stage_root/$output_prefix.err"
}

install_p36 "$tamper_install" "$tamper_state" "p36-tamper-install"
tamper_install_status=$?
if [ "$tamper_install_status" -ne 0 ]; then
  fail "P0-A0 installs an independent tamper snapshot: expected '0', got '$tamper_install_status'"
  sed -n '1,120p' "$stage_root/p36-tamper-install.err" >&2
  finalize_test
  exit 1
fi
assert_eq "$tamper_install_status" "0" "P0-A0 installs an independent tamper snapshot"

sudo -n /usr/bin/python3 -I - "$tamper_install/lib/supervised_production_substrate_durable_transport.py" <<'PY'
import os
import sys

path = sys.argv[1]
descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
try:
    os.write(descriptor, b'\n# p0-a0 installed snapshot tamper\n')
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
tamper_mutation_status=$?
if [ "$tamper_mutation_status" -ne 0 ]; then
  fail "$TEST_NAME could not mutate only the disposable installed snapshot"
  finalize_test
  exit 1
fi
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$tamper_install/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id p36-p0-a0-snapshot-tamper \
  >"$stage_root/p36-tamper-run.out" 2>"$stage_root/p36-tamper-run.err"
tamper_run_status=$?
if [ "$tamper_run_status" -eq 0 ]; then
  fail "tampered installed P3.6 snapshot unexpectedly reached handoff admission"
fi
assert_neq "$tamper_run_status" "0" "tampered installed P3.6 snapshot is rejected before any handoff admission"
assert_contains "$(cat "$stage_root/p36-tamper-run.err")" "snapshot hash does not match content" "snapshot integrity failure names the installed file mismatch"
assert_root_path_absent "$tamper_state/attempts" "tampered installed snapshot cannot create a launch attempt"

install_p36 "$p36_install" "$p36_state" "p36-install"
p36_install_status=$?
if [ "$p36_install_status" -ne 0 ]; then
  fail "P0-A0 installs the real P3.6 consumer snapshot: expected '0', got '$p36_install_status'"
  sed -n '1,120p' "$stage_root/p36-install.err" >&2
  finalize_test
  exit 1
fi
assert_eq "$p36_install_status" "0" "P0-A0 installs the real P3.6 consumer snapshot"
worker_uid="$(getent passwd autopilot-p36d-worker | /usr/bin/awk -F: '{print $3}')"
worker_gid="$(getent passwd autopilot-p36d-worker | /usr/bin/awk -F: '{print $4}')"
if ! [[ "$worker_uid" =~ ^[1-9][0-9]*$ ]] || ! [[ "$worker_gid" =~ ^[1-9][0-9]*$ ]]; then
  fail "$TEST_NAME could not resolve the P3.6 worker identity"
  finalize_test
  exit 1
fi

assert_worker_paths_denied() {
  local evidence_path="$1"
  shift
  if [ $(( $# % 2 )) -ne 0 ]; then
    fail "$TEST_NAME worker visibility helper received an unpaired label/path"
    return 1
  fi
  sudo -n /usr/bin/python3 -I - "$worker_uid" "$worker_gid" "$@" >"$evidence_path" <<'PY'
import errno
import json
import os
import sys

uid = int(sys.argv[1])
gid = int(sys.argv[2])
raw = sys.argv[3:]
pairs = list(zip(raw[0::2], raw[1::2]))
if not pairs:
    raise SystemExit('no path probes')
read_fd, write_fd = os.pipe()
pid = os.fork()
if pid == 0:
    try:
        os.close(read_fd)
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        values = []
        for label, path in pairs:
            try:
                descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC)
            except OSError as error:
                status = 'denied' if error.errno in {errno.EACCES, errno.EPERM} else 'other_error'
                values.append({'label': label, 'status': status, 'errno': error.errno})
            else:
                os.close(descriptor)
                values.append({'label': label, 'status': 'opened', 'errno': None})
        value = {
            'uid': os.geteuid(),
            'gid': os.getegid(),
            'supplementary_groups': os.getgroups(),
            'probes': values,
        }
        os.write(write_fd, json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf-8'))
        os._exit(0)
    except BaseException as error:
        os.write(write_fd, ('worker-probe-error:' + str(error)).encode('utf-8', 'replace'))
        os._exit(1)
os.close(write_fd)
blocks = []
while True:
    block = os.read(read_fd, 65536)
    if not block:
        break
    blocks.append(block)
os.close(read_fd)
_waited, status = os.waitpid(pid, 0)
if status != 0:
    raise SystemExit('worker probe child failed: ' + b''.join(blocks).decode('utf-8', 'replace'))
print(b''.join(blocks).decode('utf-8'))
PY
  local visibility_status=$?
  if [ "$visibility_status" -ne 0 ]; then
    fail "$TEST_NAME worker visibility probe could not run"
    return 1
  fi
  node - "$evidence_path" "$worker_uid" "$worker_gid" "$@" <<'NODE'
const fs = require('fs');
const [evidencePath, uid, gid, ...raw] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
if (value.uid !== Number(uid) || value.gid !== Number(gid) || value.supplementary_groups.length !== 0) process.exit(1);
const expected = raw.filter((_value, index) => index % 2 === 0);
if (!Array.isArray(value.probes) || value.probes.length !== expected.length) process.exit(1);
for (let index = 0; index < expected.length; index += 1) {
  const probe = value.probes[index];
  if (probe.label !== expected[index] || probe.status !== 'denied') process.exit(1);
}
NODE
  local validation_status=$?
  assert_eq "$validation_status" "0" "worker identity cannot open the exact root-only classes under test"
  return "$validation_status"
}

generate_v2_request() {
  local output_path="$1"
  local begin_path="$2"
  local jti="$3"
  node - "$REPO_ROOT" "$private_key_path" "$output_path" "$begin_path" "$jti" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [root, privatePath, outputPath, beginPath, jti] = process.argv.slice(2);
const {
  AUTOPILOT_ENGINE_CONTROL_SINKS,
  compileSupervisedEngineBridgeContract,
  getAutopilotEngineControlSinkInventory,
  getRequiredActionCatalogBindingIds,
  getSupervisedEngineBridgeAbiHash,
} = require(path.join(root, 'src', 'engine', 'supervised-engine-bridge-contract'));
const {
  canonicalJson,
  freezeAcceptanceContract,
  resolveGovernancePolicy,
  sha256,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const begin = JSON.parse(fs.readFileSync(beginPath, 'utf8'));
const workspace = begin.workspace_binding;
if (begin.status !== 'session_open' || begin.intake_protocol_version !== 2 || !workspace) process.exit(1);
const hash = (value) => sha256(value);
const requirement = {
  'review-dispatch': ['engine_review_dispatch', 'model_runner', 'external'],
  'implementation-dispatch': ['engine_implementation_dispatch', 'model_runner', 'external'],
  'diff-provenance': ['engine_diff_materialization', 'filesystem_git', 'reversible'],
  'repair-prompt-write': ['engine_repair_prompt_write', 'filesystem', 'reversible'],
  'verification-execution': ['engine_verification_command', 'shell', 'external'],
  'verify-worktree-add': ['engine_verify_worktree_add', 'git', 'external'],
  'verify-worktree-remove': ['engine_verify_worktree_remove', 'git', 'external'],
  'verify-worktree-cleanup': ['engine_verify_worktree_cleanup', 'filesystem', 'irreversible'],
  'branch-force': ['engine_branch_force', 'git', 'external'],
};
const attestation = (identity) => ({
  issuer: 'test', uri: `test://${identity}`, sha256: hash(identity),
  issued_at: '2026-07-23T00:00:00.000Z', expires_at: '2027-07-23T00:00:00.000Z',
});
const roster = (identity, role) => ({
  identity, model_alias: identity, model_version: '1', family: 'test', runner: 'test', role, attestation: attestation(identity),
});
const actionCatalog = AUTOPILOT_ENGINE_CONTROL_SINKS.filter((sink) => sink.requires_action_catalog_binding).map((sink) => {
  const [operation, toolClass, actionClass] = requirement[sink.id];
  return {
    id: sink.id, operation, tool_class: toolClass, action_class: actionClass,
    command_required: sink.id === 'verification-execution', requires_mediator: true, requires_challenge: false,
  };
});
const input = {
  schema_version: 2,
  ownerRunId: 'owner-run-p0-a0', engineRunId: 'engine-run-p0-a0', invocationId: `invocation-${jti}`,
  governanceConfig: {
    schema_version: 1,
    governance: {
      default_mode: 'owner-led', owner_roster: [roster('owner-a', 'owner')], challenger_roster: [roster('challenger-a', 'challenger')], trusted_runner_roster: [roster('runner-a', 'trusted_runner')],
      approval_policy: {
        read_only: { requires_approval: false, max_uses: 1 }, reversible: { requires_approval: false, max_uses: 1 },
        external: { requires_approval: true, max_uses: 1 }, irreversible: { requires_approval: true, max_uses: 1 },
      },
      capability_ttl_seconds: 3600, checkpoint_interval_closed_events: 100, max_blocked_duration_seconds: 86400, action_catalog: actionCatalog,
    },
  },
  acceptanceContract: {
    schema_version: 2, contract_id: 'p0-a0-live-contract', artifacts: [{ id: 'source', target: 'src/engine/autopilot-engine.js' }],
    legs: [{ id: 'verification', kind: 'executable', command: 'bash hooks/tests/autopilot-engine.test.sh', artifact_ids: ['source'] }],
  },
  immutableBase: workspace.immutable_base,
  workspaceBinding: {
    registrationId: workspace.registration_id,
    workspaceRootHash: workspace.workspace_root_hash,
    descriptorBindingHash: workspace.descriptor_binding_hash,
    ticketHash: workspace.ticket_hash,
  },
  prompt: 'P0-A0 real P3.5 v2 intake remains path-free',
  branch: 'feat/p0-a0-live', verifyCommand: 'bash hooks/tests/run.sh --parallel 16',
  actionCatalogBindings: Object.fromEntries(getRequiredActionCatalogBindingIds().map((id) => [id, id])),
};
const binding = {
  schema_version: 2,
  owner_run_id: input.ownerRunId, engine_run_id: input.engineRunId, invocation_id: input.invocationId,
  policy_hash: resolveGovernancePolicy(input.governanceConfig).policy_hash,
  contract_hash: freezeAcceptanceContract(input.acceptanceContract).contract_hash,
  immutable_base: input.immutableBase,
  workspace_registration_id: input.workspaceBinding.registrationId,
  workspace_root_hash: input.workspaceBinding.workspaceRootHash,
  workspace_descriptor_binding_hash: input.workspaceBinding.descriptorBindingHash,
  workspace_ticket_hash: input.workspaceBinding.ticketHash,
  prompt_hash: hash(input.prompt), branch_hash: hash(input.branch), verify_command_hash: hash(input.verifyCommand),
  sink_inventory_hash: hash(canonicalJson(getAutopilotEngineControlSinkInventory())), bridge_abi_hash: getSupervisedEngineBridgeAbiHash(2),
};
const plan = compileSupervisedEngineBridgeContract(input);
if (plan.schema_version !== 2 || JSON.stringify(plan).includes('"workspaceRoot"')) process.exit(1);
const now = Date.now();
const claims = {
  schema_version: 2, purpose: 'autopilot-supervised-owner-intake/v2', audience: 'autopilot-supervised-host',
  issuer: 'owner-control', signing_key_id: 'p0-a0-owner-ed25519', keyring_epoch: 1, jti,
  issued_at_ms: now - 5, not_before_ms: now - 5, expires_at_ms: now + 60000,
  session_id: begin.session_id, session_challenge_hash: begin.session_challenge_hash,
  host_install_binding_hash: begin.install_binding_hash,
  binding, binding_hash: hash(canonicalJson(binding)), plan_hash: hash(canonicalJson(plan)),
};
const protectedPayload = Buffer.from(canonicalJson(claims));
const signature = crypto.sign(null, Buffer.concat([Buffer.from('autopilot-supervised-owner-intake/v2\n'), protectedPayload]), fs.readFileSync(privatePath));
const request = {
  protocol_version: 2, session_id: begin.session_id,
  envelope: { schema_version: 2, protected_payload: protectedPayload.toString('base64url'), signature: signature.toString('base64url') },
  bridge_input: input,
};
const serialized = canonicalJson(request);
if (serialized.includes('"workspaceRoot"') || serialized.includes('/run/')) process.exit(1);
fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
NODE
}

create_real_handoff() {
  local tag="$1"
  local inspect_worker="$2"
  local registration_id="p0-a0-${tag}-${RANDOM}"
  local workspace_root="$live_parent/workspace-$tag"
  local begin_path="$stage_root/$tag-begin.json"
  local request_path="$stage_root/$tag-request.json"
  local submit_path="$stage_root/$tag-submit.json"
  local submit_err="$stage_root/$tag-submit.err"
  local session_id
  local handoff_id

  sudo -n install -d -o root -g root -m 0700 "$workspace_root"
  if ! sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
    "$p35_install/sbin/supervised-intake-host.py" workspace-register \
    --registration-id "$registration_id" \
    --workspace-root "$workspace_root" \
    --immutable-base "$(printf 'a%.0s' {1..40})" \
    --ttl-milliseconds 600000 >"$stage_root/$tag-register.json"; then
    fail "$TEST_NAME real P3.5 workspace registration failed for $tag"
    return 1
  fi
  if ! sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
    "$p35_install/sbin/supervised-intake-host.py" begin \
    --workspace-registration-id "$registration_id" \
    --intake-protocol-version 2 >"$begin_path"; then
    fail "$TEST_NAME real P3.5 v2 begin failed for $tag"
    return 1
  fi
  session_id="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).session_id)" "$begin_path")"
  if ! [[ "$session_id" =~ ^p35-[a-f0-9]+$ ]]; then
    fail "$TEST_NAME real P3.5 v2 begin did not allocate an opaque session"
    return 1
  fi
  assert_contains "$(cat "$begin_path")" '"intake_protocol_version":2' "real P3.5 begin uses the descriptor-bound v2 protocol"
  assert_not_contains "$(cat "$begin_path")" "$workspace_root" "real P3.5 public begin disclosure omits the root workspace path"

  if [ "$inspect_worker" = "1" ]; then
    assert_worker_paths_denied "$stage_root/$tag-worker-visible.json" \
      p35_ticket_body "$P35_RUNTIME_PARENT/$session_id/binding/workspace-ticket.json" \
      root_workspace_path "$workspace_root" \
      root_workspace_descriptor_fd_directory "/proc/$registry_pid/fd" || return 1
  fi

  if ! generate_v2_request "$request_path" "$begin_path" "p0-a0-$tag"; then
    fail "$TEST_NAME could not create a real signed P3.5 v2 request for $tag"
    return 1
  fi
  assert_not_contains "$(cat "$request_path")" "$workspace_root" "real P3.5 v2 worker request contains no root workspace path"
  if ! sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
    "$p35_install/sbin/supervised-intake-host.py" submit --session-id "$session_id" \
    <"$request_path" >"$submit_path" 2>"$submit_err"; then
    fail "$TEST_NAME real P3.5 v2 submit failed for $tag"
    sed -n '1,160p' "$submit_err" >&2
    return 1
  fi
  node - "$submit_path" "$workspace_root" <<'NODE'
const fs = require('fs');
const [path, workspaceRoot] = process.argv.slice(2);
const raw = fs.readFileSync(path, 'utf8');
const value = JSON.parse(raw);
if (value.status !== 'p35_shadow_intake_complete' || value.intake_protocol_version !== 2
  || value.effect_authority !== 'none' || value.owner_kernel_authority !== 'none'
  || value.acceptance !== 'not_available' || raw.includes(workspaceRoot)) process.exit(1);
NODE
  local submit_validation_status=$?
  if [ "$submit_validation_status" -ne 0 ]; then
    fail "$TEST_NAME real P3.5 submit did not preserve the v2 no-effect disclosure"
    return 1
  fi
  assert_eq "$submit_validation_status" "0" "real P3.5 submit preserves its v2 no-effect disclosure"

  handoff_id="$(sudo -n /usr/bin/python3 -I - "$p35_handoff_root" "$session_id" <<'PY'
import json
import os
import sys

root, session_id = sys.argv[1:]
matches = []
for name in sorted(os.listdir(root)):
    if not name.startswith('handoff-') or not name.endswith('.json'):
        continue
    with open(os.path.join(root, name), encoding='utf-8') as source:
        value = json.load(source)
    if value.get('session_id') == session_id:
        matches.append(value)
if len(matches) != 1:
    raise SystemExit('expected one root-published handoff for the real P3.5 session')
print(matches[0]['handoff_id'])
PY
)"
  if ! [[ "$handoff_id" =~ ^p36-[a-f0-9]+$ ]]; then
    fail "$TEST_NAME root P3.5 mailbox did not publish one opaque verified handoff"
    return 1
  fi
  assert_not_contains "$(sudo -n cat "$p35_handoff_root/handoff-$handoff_id.json")" "$workspace_root" "root P3.5-to-P3.6 mailbox contains no workspace path"
  assert_not_contains "$(sudo -n cat "$p35_handoff_root/handoff-$handoff_id.json")" '"ticket"' "root P3.5-to-P3.6 mailbox contains no ticket body"
  created_handoff_id="$handoff_id"
  created_workspace_root="$workspace_root"
  created_session_id="$session_id"
  return 0
}

run_outsider_peer_probe() {
  local handoff_id="$1"
  local evidence_path="$2"
  sudo -n /usr/bin/python3 -I - "$p36_install" "$p36_state" "$handoff_id" "$P36_RUNTIME_PARENT" "$worker_uid" "$worker_gid" <<'PY' >"$evidence_path"
import errno
import json
import os
import signal
import socket
import stat
import subprocess
import sys
import time

install_root, state_root, handoff_id, runtime_parent, raw_uid, raw_gid = sys.argv[1:]
uid = int(raw_uid)
gid = int(raw_gid)
deadline = time.monotonic() + 24
attempt = None
while time.monotonic() < deadline:
    root = os.path.join(state_root, 'attempts')
    if os.path.isdir(root):
        for name in os.listdir(root):
            if not name.endswith('.json'):
                continue
            with open(os.path.join(root, name), encoding='utf-8') as source:
                candidate = json.load(source)
            if candidate.get('handoff_id') == handoff_id:
                attempt = candidate
                break
    if attempt is not None:
        break
    time.sleep(0.02)
if attempt is None:
    raise SystemExit('P3.6 did not persist an attempt for the outsider probe')
worker = next((unit for unit in attempt['units'] if unit['unit'].startswith('autopilot-p36d-worker-')), None)
if worker is None:
    raise SystemExit('P3.6 attempt omitted the worker unit')
worker_pid = None
ready_path = os.path.join(runtime_parent, attempt['cohort_id'], 'roles', 'worker', 'ack', 'listeners.json')
socket_path = os.path.join(runtime_parent, attempt['cohort_id'], 'ipc', 'e0', 's')
peer_config_path = os.path.join(runtime_parent, attempt['cohort_id'], 'roles', 'worker', 'peer.json')
while time.monotonic() < deadline:
    result = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--property=MainPID', '--value', worker['unit']],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    candidate = result.stdout.strip()
    if candidate.isdigit() and int(candidate) > 0 and os.path.exists(ready_path):
        worker_pid = int(candidate)
        break
    time.sleep(0.02)
if worker_pid is None:
    raise SystemExit('P3.6 worker was not ready before outsider probe')
with open('/proc/{}/cgroup'.format(worker_pid), encoding='utf-8') as source:
    worker_cgroup = source.read(8192).splitlines()
if worker_cgroup != ['0::' + worker['cgroup_path']]:
    raise SystemExit('P3.6 worker did not retain its expected cgroup')
# `listeners.json` is published before root releases the sealed listener
# cohort. Freeze the real worker before waiting on root-written peer config,
# otherwise it can race through its own probes and ACK before this outsider is
# queued at the broker.
os.kill(worker_pid, signal.SIGSTOP)
stopped = True
while time.monotonic() < deadline:
    try:
        info = os.lstat(socket_path)
    except FileNotFoundError:
        time.sleep(0.01)
        continue
    if stat.S_ISSOCK(info.st_mode):
        break
    raise SystemExit('worker_broker endpoint is not a socket')
else:
    raise SystemExit('worker_broker endpoint did not appear')
while time.monotonic() < deadline:
    try:
        info = os.lstat(peer_config_path)
    except FileNotFoundError:
        time.sleep(0.01)
        continue
    if stat.S_ISREG(info.st_mode):
        break
    raise SystemExit('worker peer configuration is not a regular file')
else:
    raise SystemExit('worker peer configuration did not appear before outsider probe')

# The frozen real worker cannot send its fixed request, so this is the first
# worker-UID peer queued for the broker without changing installed code.
read_fd, write_fd = os.pipe()
child = os.fork()
if child == 0:
    try:
        os.close(read_fd)
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        with open('/proc/self/cgroup', encoding='utf-8') as source:
            outsider_cgroup = source.read(8192).splitlines()
        value = {
            'uid': os.geteuid(),
            'gid': os.getegid(),
            'supplementary_groups': os.getgroups(),
            'outsider_cgroup': outsider_cgroup,
            'sent_bytes': 0,
        }
        library_root = os.path.join(install_root, 'lib')
        sys.path.insert(0, library_root)
        import supervised_production_substrate_durable_transport as transport
        with open(peer_config_path, encoding='utf-8') as source:
            peer_config = json.load(source)
        payload = {
            'schema_version': 1,
            'request_id': 'p0-outsider-' + attempt['cohort_id'],
            'operation': 'execute',
            'substrate_plan_hash': peer_config['durable_binding']['substrate_plan_hash'],
        }
        _request, frame = transport.create_request(
            peer_config['durable_binding'], peer_config['runtime_services'], 'worker_broker', payload,
        )
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            connection.settimeout(12)
            connection.connect(socket_path)
            value['connection'] = 'connected'
            connection.sendall(frame)
            value['sent_bytes'] = len(frame)
            try:
                block = connection.recv(1)
                value['receive'] = 'eof' if block == b'' else 'unexpected_data'
            except OSError as error:
                value['receive'] = 'reset' if error.errno in {errno.ECONNRESET, errno.EPIPE} else 'error'
                value['receive_errno'] = error.errno
        except OSError as error:
            value['connection'] = 'error_before_frame'
            value['errno'] = error.errno
        finally:
            connection.close()
        os.write(write_fd, json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf-8'))
        os._exit(0)
    except BaseException as error:
        os.write(write_fd, ('outsider-error:' + str(error)).encode('utf-8', 'replace'))
        os._exit(1)
os.close(write_fd)
blocks = []
while True:
    block = os.read(read_fd, 65536)
    if not block:
        break
    blocks.append(block)
os.close(read_fd)
_waited, child_status = os.waitpid(child, 0)
if stopped:
    os.kill(worker_pid, signal.SIGCONT)
if child_status != 0:
    raise SystemExit('outsider child failed: ' + b''.join(blocks).decode('utf-8', 'replace'))
value = json.loads(b''.join(blocks).decode('utf-8'))
value.update({
    'cohort_id': attempt['cohort_id'],
    'worker_pid': worker_pid,
    'worker_unit': worker['unit'],
    'expected_worker_cgroup': worker['cgroup_path'],
    'worker_cgroup': worker_cgroup,
    'socket_path': socket_path,
    'peer_config_path': peer_config_path,
})
print(json.dumps(value, sort_keys=True, separators=(',', ':')))
PY
}

run_forged_ack_probe() {
  local handoff_id="$1"
  local evidence_path="$2"
  sudo -n /usr/bin/python3 -I - "$p36_install" "$p36_state" "$handoff_id" "$P36_RUNTIME_PARENT" "$worker_uid" "$worker_gid" <<'PY' >"$evidence_path"
import errno
import json
import os
import signal
import socket
import stat
import subprocess
import sys
import time

install_root, state_root, handoff_id, runtime_parent, raw_uid, raw_gid = sys.argv[1:]
uid = int(raw_uid)
gid = int(raw_gid)
deadline = time.monotonic() + 24
attempt = None
while time.monotonic() < deadline:
    root = os.path.join(state_root, 'attempts')
    if os.path.isdir(root):
        for name in os.listdir(root):
            if not name.endswith('.json'):
                continue
            with open(os.path.join(root, name), encoding='utf-8') as source:
                candidate = json.load(source)
            if candidate.get('handoff_id') == handoff_id:
                attempt = candidate
                break
    if attempt is not None:
        break
    time.sleep(0.02)
if attempt is None:
    raise SystemExit('P3.6 did not persist an attempt for the forged ACK probe')
worker = next((unit for unit in attempt['units'] if unit['unit'].startswith('autopilot-p36d-worker-')), None)
if worker is None:
    raise SystemExit('P3.6 attempt omitted the worker unit for forged ACK probe')
role_root = os.path.join(runtime_parent, attempt['cohort_id'], 'roles', 'worker')
ready_path = os.path.join(role_root, 'ack', 'listeners.json')
ack_socket_path = os.path.join(role_root, 'ack.sock')
bootstrap_path = os.path.join(role_root, 'bootstrap.json')
peer_config_path = os.path.join(role_root, 'peer.json')
worker_pid = None
while time.monotonic() < deadline:
    result = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--property=MainPID', '--value', worker['unit']],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    candidate = result.stdout.strip()
    if candidate.isdigit() and int(candidate) > 0 and os.path.exists(ready_path):
        worker_pid = int(candidate)
        break
    time.sleep(0.02)
if worker_pid is None:
    raise SystemExit('P3.6 worker was not ready before forged ACK probe')
with open('/proc/{}/cgroup'.format(worker_pid), encoding='utf-8') as source:
    worker_cgroup = source.read(8192).splitlines()
if worker_cgroup != ['0::' + worker['cgroup_path']]:
    raise SystemExit('P3.6 worker did not retain its expected cgroup before forged ACK probe')
# `listeners.json` is the service's pre-release readiness boundary. Stop the
# real worker here, before any root-written bootstrap/peer-config waits can
# give it time to complete its own ACK path.
os.kill(worker_pid, signal.SIGSTOP)
stopped = True
for required, kind in ((ack_socket_path, 'socket'), (bootstrap_path, 'file')):
    while time.monotonic() < deadline:
        try:
            info = os.lstat(required)
        except FileNotFoundError:
            time.sleep(0.01)
            continue
        if (kind == 'socket' and stat.S_ISSOCK(info.st_mode)) or (kind == 'file' and stat.S_ISREG(info.st_mode)):
            break
        raise SystemExit('forged ACK prerequisite has an unexpected type: ' + required)
    else:
        raise SystemExit('forged ACK prerequisite did not appear: ' + required)

with open(bootstrap_path, encoding='utf-8') as source:
    root_bootstrap = json.load(source)
# The real worker is stopped before it can emit either completion ACK. If the
# host skipped ACK peer binding, this same-UID outsider could replace both
# completion frames regardless of when root publishes the release token.
while time.monotonic() < deadline:
    try:
        info = os.lstat(peer_config_path)
    except FileNotFoundError:
        time.sleep(0.01)
        continue
    if stat.S_ISREG(info.st_mode):
        break
    raise SystemExit('forged ACK peer configuration has an unexpected type')
else:
    raise SystemExit('forged ACK peer configuration did not appear')
read_fd, write_fd = os.pipe()
child = os.fork()
if child == 0:
    try:
        os.close(read_fd)
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        with open('/proc/self/cgroup', encoding='utf-8') as source:
            outsider_cgroup = source.read(8192).splitlines()
        library_root = os.path.join(install_root, 'lib')
        sys.path.insert(0, library_root)
        import supervised_production_substrate_durable as durable
        import supervised_production_substrate_durable_transport as transport
        with open(bootstrap_path, encoding='utf-8') as source:
            bootstrap = json.load(source)
        with open(peer_config_path, encoding='utf-8') as source:
            peer_config = json.load(source)
        binding = peer_config['durable_binding']
        seed = transport.sha256_value({
            'kind': 'p36_durable_fixed_probe_seed',
            **{key: binding[key] for key in (
                'install_binding_hash', 'run_binding_hash', 'substrate_abi_hash',
                'substrate_plan_hash', 'durable_abi_hash', 'cohort_id', 'generation',
            )},
        })
        evidence = [{
            'endpoint_id': 'worker_broker',
            'request_id': 'p36d-probe-' + seed[:24] + '-worker-execute',
            'operation': 'execute',
            'code': 'BROKER_EFFECTS_DISABLED',
            'response_hash': '0' * 64,
        }]
        value = {
            'uid': os.geteuid(),
            'gid': os.getegid(),
            'supplementary_groups': os.getgroups(),
            'outsider_cgroup': outsider_cgroup,
            'phases_sent': [],
            'confirmations': [],
            'sent_bytes': 0,
        }
        def send_phase(phase):
            material = {
                'schema_version': 1,
                'kind': 'p36_durable_release_ack',
                'status': 'released_durable_no_effect',
                'phase': phase,
                'role': bootstrap['role'],
                'identity': bootstrap['identity'],
                'pid': worker_pid,
                'uid': uid,
                'gid': gid,
                'bootstrap_hash': bootstrap['bootstrap_hash'],
                'peer_config_hash': peer_config['peer_config_hash'],
                'binding_hash': durable.normalized_binding_hash(binding),
                'state_snapshot': None,
                'self_probe_evidence': evidence,
                'owner_kernel_authority': 'none',
                'effect_authority': 'none',
                'broker_authority': 'disabled',
                'acceptance': 'not_available',
            }
            acknowledgement = dict(material, ack_hash=transport.sha256_value(material))
            frame = transport.encode_frame(acknowledgement)
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                connection.settimeout(5)
                connection.connect(ack_socket_path)
                connection.sendall(frame)
                try:
                    confirmation = connection.recv(1)
                    value['confirmations'].append(
                        'confirmed' if confirmation == b'\x01'
                        else ('eof' if confirmation == b'' else 'unexpected_data')
                    )
                except OSError as error:
                    value['confirmations'].append(
                        'reset' if error.errno in {errno.ECONNRESET, errno.EPIPE} else 'error'
                    )
                    value['confirmation_errno'] = error.errno
            finally:
                connection.close()
            value['phases_sent'].append(phase)
            value['sent_bytes'] += len(frame)
        send_phase('probe_complete')
        quiesce_deadline = time.monotonic() + 45
        while time.monotonic() < quiesce_deadline:
            if os.path.exists(bootstrap['quiesce_path']):
                value['quiesce_observed'] = True
                send_phase('quiesced')
                break
            if not os.path.lexists(ack_socket_path):
                value['quiesce_observed'] = False
                break
            time.sleep(0.02)
        else:
            value['quiesce_observed'] = False
        os.write(write_fd, json.dumps(value, sort_keys=True, separators=(',', ':')).encode('utf-8'))
        os._exit(0)
    except BaseException as error:
        os.write(write_fd, ('forged-ack-error:' + str(error)).encode('utf-8', 'replace'))
        os._exit(1)
os.close(write_fd)
blocks = []
while True:
    block = os.read(read_fd, 65536)
    if not block:
        break
    blocks.append(block)
os.close(read_fd)
_waited, child_status = os.waitpid(child, 0)
try:
    os.kill(worker_pid, signal.SIGCONT)
except ProcessLookupError:
    pass
if child_status != 0:
    raise SystemExit('forged ACK child failed: ' + b''.join(blocks).decode('utf-8', 'replace'))
value = json.loads(b''.join(blocks).decode('utf-8'))
value.update({
    'cohort_id': attempt['cohort_id'],
    'worker_pid': worker_pid,
    'worker_unit': worker['unit'],
    'expected_worker_cgroup': worker['cgroup_path'],
    'worker_cgroup': worker_cgroup,
    'ack_socket_path': ack_socket_path,
})
print(json.dumps(value, sort_keys=True, separators=(',', ':')))
PY
}

create_real_handoff outsider 1 || { finalize_test; exit 1; }
outsider_handoff_id="$created_handoff_id"
outsider_out="$stage_root/p36-outsider.out"
outsider_err="$stage_root/p36-outsider.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$p36_install/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$outsider_handoff_id" >"$outsider_out" 2>"$outsider_err" &
outsider_runner_pid=$!
if ! remember_background_host "$outsider_runner_pid"; then
  finalize_test
  exit 1
fi
run_outsider_peer_probe "$outsider_handoff_id" "$stage_root/outsider-peer.json"
outsider_probe_status=$?
if [ "$outsider_probe_status" -ne 0 ]; then
  fail "$TEST_NAME could not run the same-UID outsider peer probe"
  if [ -r "$stage_root/outsider-peer.json" ]; then
    sed -n '1,160p' "$stage_root/outsider-peer.json" >&2
  else
    printf 'outsider peer evidence is unavailable: %s\n' "$stage_root/outsider-peer.json" >&2
  fi
  finalize_test
  exit 1
fi
wait_for_background_host "$outsider_runner_pid"
outsider_run_status=$?
assert_neq "$outsider_run_status" "0" "same-UID outsider makes the no-effect cohort terminal rather than verified"

outsider_cohort_id="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).cohort_id)" "$stage_root/outsider-peer.json")"
node - "$stage_root/outsider-peer.json" "$worker_uid" "$worker_gid" <<'NODE'
const fs = require('fs');
const [path, uid, gid] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!/^p36d-[0-9]+-[a-f0-9]+$/.test(value.cohort_id || '')) process.exit(1);
if (!value.worker_unit.startsWith('autopilot-p36d-worker-')) process.exit(1);
if (value.uid !== Number(uid) || value.gid !== Number(gid) || value.supplementary_groups.length !== 0) process.exit(1);
if (JSON.stringify(value.worker_cgroup) !== JSON.stringify([`0::${value.expected_worker_cgroup}`])) process.exit(1);
if (JSON.stringify(value.outsider_cgroup) === JSON.stringify(value.worker_cgroup)) process.exit(1);
if (value.connection !== 'connected' || !['eof', 'reset'].includes(value.receive)
  || !Number.isInteger(value.sent_bytes) || value.sent_bytes <= 4) process.exit(1);
NODE
outsider_evidence_status=$?
assert_eq "$outsider_evidence_status" "0" "same UID outside the worker cgroup is closed before its valid frame can be parsed"
assert_eq "$(sudo -n /usr/bin/python3 -I - "$p36_state/attempts/$outsider_cohort_id.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    print(json.load(source)['state'])
PY
)" "abandoned" "outsider peer failure has a terminal abandoned attempt"
assert_root_path_exists "$p36_state/abandoned/$outsider_cohort_id.json" "outsider peer failure retains a root-only tombstone"
assert_root_path_absent "$P36_RUNTIME_PARENT/$outsider_cohort_id" "outsider peer failure removes the transient runtime tree"
assert_root_path_absent "$p36_state/probe-evidence/$outsider_cohort_id.json" "outsider peer cannot produce root probe evidence"
assert_root_path_absent "$p36_state/receipt-audits/$outsider_cohort_id.json" "outsider peer cannot produce a receipt audit result"
assert_not_contains "$(sudo -n cat "$p36_state/cohorts/$outsider_cohort_id/receipt_verifier/leaf/journal.jsonl")" '"endpoint_id":"worker_broker"' "outsider peer cannot append a worker-broker durable receipt"

sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$p36_install/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$outsider_handoff_id" >"$stage_root/p36-outsider-replay.out" 2>"$stage_root/p36-outsider-replay.err"
outsider_replay_status=$?
if [ "$outsider_replay_status" -eq 0 ]; then
  fail "failed outsider handoff unexpectedly launched a second cohort"
fi
assert_neq "$outsider_replay_status" "0" "terminal outsider handoff remains one-shot"
assert_contains "$(cat "$stage_root/p36-outsider-replay.err")" "handoff claim already exists" "one-shot P3.5 handoff cannot be retried after terminal cleanup"

create_real_handoff forged-ack 0 || { finalize_test; exit 1; }
forged_ack_handoff_id="$created_handoff_id"
forged_ack_out="$stage_root/p36-forged-ack.out"
forged_ack_err="$stage_root/p36-forged-ack.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$p36_install/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$forged_ack_handoff_id" >"$forged_ack_out" 2>"$forged_ack_err" &
forged_ack_runner_pid=$!
if ! remember_background_host "$forged_ack_runner_pid"; then
  finalize_test
  exit 1
fi
run_forged_ack_probe "$forged_ack_handoff_id" "$stage_root/forged-ack.json"
forged_ack_probe_status=$?
if [ "$forged_ack_probe_status" -ne 0 ]; then
  fail "$TEST_NAME could not run the same-UID forged root ACK probe"
  if [ -r "$stage_root/forged-ack.json" ]; then
    sed -n '1,160p' "$stage_root/forged-ack.json" >&2
  fi
  finalize_test
  exit 1
fi
wait_for_background_host "$forged_ack_runner_pid"
forged_ack_run_status=$?
assert_neq "$forged_ack_run_status" "0" "same-UID outsider cannot replace a frozen worker through the root ACK socket"
forged_ack_cohort_id="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).cohort_id)" "$stage_root/forged-ack.json")"
node - "$stage_root/forged-ack.json" "$worker_uid" "$worker_gid" <<'NODE'
const fs = require('fs');
const [path, uid, gid] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!/^p36d-[0-9]+-[a-f0-9]+$/.test(value.cohort_id || '')) process.exit(1);
if (!value.worker_unit.startsWith('autopilot-p36d-worker-')) process.exit(1);
if (value.uid !== Number(uid) || value.gid !== Number(gid) || value.supplementary_groups.length !== 0) process.exit(1);
if (JSON.stringify(value.worker_cgroup) !== JSON.stringify([`0::${value.expected_worker_cgroup}`])) process.exit(1);
if (JSON.stringify(value.outsider_cgroup) === JSON.stringify(value.worker_cgroup)) process.exit(1);
if (!Array.isArray(value.phases_sent) || value.phases_sent[0] !== 'probe_complete' || value.sent_bytes <= 4) process.exit(1);
if (!Array.isArray(value.confirmations) || !['eof', 'reset'].includes(value.confirmations[0])) process.exit(1);
if (!value.ack_socket_path.endsWith('/roles/worker/ack.sock')) process.exit(1);
NODE
forged_ack_evidence_status=$?
assert_eq "$forged_ack_evidence_status" "0" "same UID outsider sends a canonical forged worker ACK but cannot pass root peer authentication"
assert_contains "$(cat "$forged_ack_err")" "rejected an unexpected Linux peer before frame parsing" "root ACK socket rejects the forged peer before it parses the frame"
assert_eq "$(sudo -n /usr/bin/python3 -I - "$p36_state/attempts/$forged_ack_cohort_id.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    print(json.load(source)['state'])
PY
)" "abandoned" "forged root ACK failure has a terminal abandoned attempt"
assert_root_path_exists "$p36_state/abandoned/$forged_ack_cohort_id.json" "forged root ACK failure retains a root-only tombstone"
assert_root_path_absent "$p36_state/probe-evidence/$forged_ack_cohort_id.json" "forged root ACK cannot produce root probe evidence"
assert_root_path_absent "$p36_state/receipt-audits/$forged_ack_cohort_id.json" "forged root ACK cannot produce receipt audit evidence"

create_real_handoff recovery 0 || { finalize_test; exit 1; }
recovery_handoff_id="$created_handoff_id"
recovery_out="$stage_root/p36-recovery.out"
recovery_err="$stage_root/p36-recovery.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$p36_install/sbin/supervised-production-substrate-durable-host.py" run \
  --handoff-id "$recovery_handoff_id" >"$recovery_out" 2>"$recovery_err" &
recovery_runner_pid=$!
if ! remember_background_host "$recovery_runner_pid"; then
  finalize_test
  exit 1
fi

recovery_cohort_id=""
for _ in $(seq 1 600); do
  recovery_cohort_id="$(sudo -n /usr/bin/python3 -I - "$p36_state/attempts" "$recovery_handoff_id" <<'PY'
import json
import os
import sys

root, handoff_id = sys.argv[1:]
if not os.path.isdir(root):
    raise SystemExit(0)
for name in sorted(os.listdir(root)):
    if not name.endswith('.json'):
        continue
    with open(os.path.join(root, name), encoding='utf-8') as source:
        value = json.load(source)
    if value.get('handoff_id') == handoff_id:
        print(value['cohort_id'])
        break
PY
)"
  if [ -n "$recovery_cohort_id" ] \
    && sudo -n test -e "$P36_RUNTIME_PARENT/$recovery_cohort_id/roles/broker/bootstrap.json" \
    && sudo -n test -e "$p36_state/cohorts/$recovery_cohort_id/binding.json"; then
    break
  fi
  sleep 0.05
done
if [ -z "$recovery_cohort_id" ]; then
  fail "$TEST_NAME did not expose a real recovery cohort for exact worker visibility checks"
  wait_for_background_host "$recovery_runner_pid"
  recovery_wait_status=$?
  if [ "$recovery_wait_status" -ne 0 ]; then
    printf 'recovery runner also failed while handling missing cohort (status=%s)\n' "$recovery_wait_status" >&2
  fi
  finalize_test
  exit 1
fi

assert_worker_paths_denied "$stage_root/recovery-worker-visible.json" \
  root_handoff_record "$p35_handoff_root/handoff-$recovery_handoff_id.json" \
  root_cohort_binding "$p36_state/cohorts/$recovery_cohort_id/binding.json" \
  broker_service_secret "$P36_RUNTIME_PARENT/$recovery_cohort_id/roles/broker/bootstrap.json" \
  broker_peer_config "$P36_RUNTIME_PARENT/$recovery_cohort_id/roles/broker/peer.json" || {
  wait_for_background_host "$recovery_runner_pid"
  recovery_wait_status=$?
  if [ "$recovery_wait_status" -ne 0 ]; then
    printf 'recovery runner also failed while handling worker-visibility failure (status=%s)\n' "$recovery_wait_status" >&2
  fi
  finalize_test
  exit 1
}

wait_for_background_host "$recovery_runner_pid"
recovery_run_status=$?
if [ "$recovery_run_status" -ne 0 ]; then
  fail "new real P3.5 handoff did not recover the abandoned outsider cohort: expected '0', got '$recovery_run_status'"
  sed -n '1,180p' "$recovery_err" >&2
  finalize_test
  exit 1
fi
assert_eq "$recovery_run_status" "0" "new real P3.5 handoff recovers the abandoned outsider cohort"
assert_contains "$(cat "$recovery_out")" '"status":"p36_durable_cohort_verified"' "recovered cohort reaches only the no-effect verified lifecycle"
assert_contains "$(cat "$recovery_out")" '"effect_authority":"none"' "recovered cohort keeps effect authority disabled"
assert_contains "$(cat "$recovery_out")" '"acceptance":"not_available"' "recovered cohort keeps acceptance unavailable"
assert_eq "$(sudo -n /usr/bin/python3 -I - "$p36_state/attempts/$outsider_cohort_id.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    print(json.load(source)['state'])
PY
)" "recovered_abandoned" "next admission records the already-terminal outsider cohort as recovered"
assert_eq "$(sudo -n /usr/bin/python3 -I - "$p36_state/attempts/$forged_ack_cohort_id.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding='utf-8') as source:
    print(json.load(source)['state'])
PY
)" "recovered_abandoned" "next admission records the forged ACK cohort as recovered"
assert_root_path_exists "$p36_state/probe-evidence/$recovery_cohort_id.json" "real recovered cohort retains root probe evidence"
assert_root_path_exists "$p36_state/receipt-audits/$recovery_cohort_id.json" "real recovered cohort retains independent receipt audit evidence"
assert_contains "$(sudo -n cat "$p36_state/probe-evidence/$recovery_cohort_id.json")" '"code":"BROKER_EFFECTS_DISABLED"' "recovered cohort records only the broker disabled refusal"
assert_not_contains "$(sudo -n cat "$p36_state/probe-evidence/$recovery_cohort_id.json")" '"permit"' "recovered root evidence contains no permit material"
assert_not_contains "$(sudo -n cat "$p36_state/probe-evidence/$recovery_cohort_id.json")" '"action"' "recovered root evidence contains no action descriptor material"

audit_out="$stage_root/p36-recovery-audit.out"
audit_err="$stage_root/p36-recovery-audit.err"
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$p36_install/sbin/supervised-production-substrate-durable-host.py" audit \
  --cohort-id "$recovery_cohort_id" >"$audit_out" 2>"$audit_err"
audit_status=$?
if [ "$audit_status" -ne 0 ]; then
  fail "root audit did not verify the real recovered receipt chain: expected '0', got '$audit_status'"
  cat "$audit_err" >&2
  finalize_test
  exit 1
fi
assert_eq "$audit_status" "0" "root audit verifies the retained real receipt chain before mutation"
assert_contains "$(cat "$audit_out")" '"status":"verified"' "root audit reports a bounded receipt-chain verification"

# This is a root-adversary mutation, not a worker threat claim. It rewrites the
# witness journal from its header with valid internal hashes, then requires the
# separately owned receipt anchor to make the installed audit fail.
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I - \
  "$p36_install/lib/supervised_production_substrate_durable.py" \
  "$p36_state/cohorts/$recovery_cohort_id/binding.json" \
  "$p36_state/cohorts/$recovery_cohort_id/witness/leaf/journal.jsonl" <<'PY'
import importlib.util
import json
import os
import sys

module_path, binding_path, journal_path = sys.argv[1:]
spec = importlib.util.spec_from_file_location('p0_a0_installed_durable', module_path)
durable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(durable)
with open(binding_path, encoding='utf-8') as source:
    binding = durable.normalize_binding(json.load(source))
with open(journal_path, encoding='utf-8') as source:
    values = [json.loads(line) for line in source.read().splitlines()]
header = values[0]
source_record = next(value for value in values[1:] if value['record_type'] == 'mutation')
request = json.loads(source_record['request_canonical'])
request['event_hash'] = durable.sha256_value('p0-a0-rewritten-event')
request['event_payload_hash'] = durable.sha256_value('p0-a0-rewritten-payload')
request_canonical = durable.canonical(request)
request_hash = durable.sha256_value(request_canonical)
event = {'event_hash': request['event_hash'], 'event_payload_hash': request['event_payload_hash']}
receipt = durable.witness_receipt(request['stream_id'], 1, None, event, request_hash)
record = {
    'schema_version': 1,
    'kind': 'p36_durable_witness_record',
    'record_type': 'mutation',
    'operation': request['operation'],
    'request_id': request['request_id'],
    'request_canonical': request_canonical,
    'request_hash': request_hash,
    'request_envelope_hash': source_record['request_envelope_hash'],
    'stream_id': request['stream_id'],
    'expected_head': None,
    'events': [event],
    'receipts': [receipt],
    'previous_journal_hash': header['journal_hash'],
}
record['journal_hash'] = durable.DurableWitness(
    os.path.dirname(journal_path), binding, root_audit=True
)._record_hash(record)
descriptor = os.open(journal_path, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW)
try:
    os.write(descriptor, (durable.canonical(header) + '\n').encode('utf-8'))
    os.write(descriptor, (durable.canonical(record) + '\n').encode('utf-8'))
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
rewrite_status=$?
if [ "$rewrite_status" -ne 0 ]; then
  fail "$TEST_NAME could not build a self-consistent root-only witness rewrite"
  finalize_test
  exit 1
fi
sudo -n env PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -I \
  "$p36_install/sbin/supervised-production-substrate-durable-host.py" audit \
  --cohort-id "$recovery_cohort_id" >"$stage_root/p36-rewrite-audit.out" 2>"$stage_root/p36-rewrite-audit.err"
rewrite_audit_status=$?
if [ "$rewrite_audit_status" -eq 0 ]; then
  fail "self-consistent witness rewrite unexpectedly passed the independent receipt audit"
fi
assert_neq "$rewrite_audit_status" "0" "independent receipt audit rejects a self-consistent witness rewrite"
assert_contains "$(cat "$stage_root/p36-rewrite-audit.err")" "DURABLE_RECEIPT_AUDIT_FAILED" "installed audit names the independent receipt mismatch"

echo "p0_a0_real_p35_v2_to_p36=true"
echo "p0_a0_same_uid_outside_cgroup_before_frame=true"
echo "p0_a0_same_uid_forged_root_ack_rejected=true"
echo "p0_a0_exact_worker_secret_classes_denied=true"
echo "p0_a0_installed_snapshot_tamper_rejected=true"
echo "p0_a0_root_rewrite_detected_by_receipt_anchor=true"
finalize_test
