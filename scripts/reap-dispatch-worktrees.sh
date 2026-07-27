#!/usr/bin/env bash
# Deterministic lifecycle controller for schema-2 dispatch worktrees.

set -uo pipefail

usage() {
  local exit_code="${1:-2}"
  printf '%s\n' \
    'usage: reap-dispatch-worktrees.sh scan|check|journal|reap --repo <dir> --root-run-id <id> [--path <absolute>] [--expected-tip <sha>] [--yes]' \
    '  scan: classify exact schema-2 leaves without destructive mutation' \
    '  check: exit 1 while exact owned or pending leaves remain' \
    '  journal: validate and journal one exact clean/dead --path without removal' \
    '  reap: require --yes; remove exact clean/dead leaves after durable branch inventory' \
    '  identity: --root-run-id is the campaign worktree root, not the watcher lineage root' \
    '  durability: cross-bound root anchor + journal sentinel reject missing/replaced journals' \
    '  output: pass the complete JSON unchanged to reap-dispatch-branches.sh --inventory-file' >&2
  exit "$exit_code"
}

die_env() {
  printf 'error: %s\n' "$*" >&2
  exit 2
}

command_name="${1:-}"
case "$command_name" in
  scan|check|journal|reap) shift ;;
  --help|-h) usage 0 ;;
  *) usage ;;
esac

repo="."
root_run_id=""
target_path=""
expected_tip=""
yes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --root-run-id) [ "$#" -ge 2 ] || usage; root_run_id="$2"; shift 2 ;;
    --path) [ "$#" -ge 2 ] || usage; target_path="$2"; shift 2 ;;
    --expected-tip) [ "$#" -ge 2 ] || usage; expected_tip="$2"; shift 2 ;;
    --yes) [ "$command_name" = "reap" ] || usage; yes=1; shift ;;
    --help|-h) usage 0 ;;
    *) usage ;;
  esac
done

[[ "$root_run_id" =~ ^[A-Za-z0-9._-]+$ ]] \
  || die_env "--root-run-id must match [A-Za-z0-9._-]+"
[ "$command_name" != "reap" ] || [ "$yes" -eq 1 ] \
  || die_env "reap requires --yes"
[ -z "$target_path" ] \
  || { [[ "$command_name" = "reap" || "$command_name" = "journal" ]] \
    && [[ "$target_path" = /* ]]; } \
  || die_env "--path requires journal/reap and an absolute path"
[ "$command_name" != "journal" ] || [ -n "$target_path" ] \
  || die_env "journal requires --path"
[ -z "$expected_tip" ] \
  || { [ "$command_name" = "reap" ] && [ -n "$target_path" ] \
    && [[ "$expected_tip" =~ ^[0-9a-f]{40,64}$ ]]; } \
  || die_env "--expected-tip requires reap --path and a commit id"

repo="$(cd "$repo" 2>/dev/null && pwd -P)" \
  || die_env "repository directory is not readable"
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 \
  || die_env "not a git repository: $repo"

self_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/json-emit.sh
. "$self_dir/lib/json-emit.sh"
# shellcheck source=lib/worktree-reap.sh
. "$self_dir/lib/worktree-reap.sh"

common_dir="$(_wt_resolve_common_dir "$repo")" \
  || die_env "cannot resolve canonical git common directory"
repo_identity="git-common-dir:$common_dir"

git_common() {
  git --git-dir="$common_dir" "$@"
}

lifecycle_lock="$common_dir/autopilot-worktree-budget.lock"
inherited_lifecycle_fd="${AUTOPILOT_LIFECYCLE_LOCK_FD:-}"
if [[ "$inherited_lifecycle_fd" =~ ^[0-9]+$ ]]; then
  inherited_fd_path="/proc/$$/fd/$inherited_lifecycle_fd"
  [ -e "$inherited_fd_path" ] || inherited_fd_path="/dev/fd/$inherited_lifecycle_fd"
  [ -f "$inherited_fd_path" ] && [ "$inherited_fd_path" -ef "$lifecycle_lock" ] \
    && flock -n "$inherited_lifecycle_fd" \
    || die_env "inherited lifecycle lock fd is invalid or unlocked"
  lifecycle_fd="$inherited_lifecycle_fd"
else
  _wt_open_lock_fd "$lifecycle_lock" \
    || die_env "cannot open repository lifecycle lock"
  lifecycle_fd="$_WT_SAFE_LOCK_FD"
  flock -x "$lifecycle_fd" || die_env "cannot acquire repository lifecycle lock"
fi

declare -a owned_items=() clean_items=() dirty_items=() live_items=()
declare -a unsupported_items=() malformed_items=() legacy_items=()
declare -a status_unsupported_items=() pending_items=() raced_items=() reaped_items=()
declare -a inventory_record_items=()
declare -A snapshot_head=() snapshot_branch=()
declare -a snapshot_paths=()
inventory_dir="$common_dir/autopilot-worktree-branch-inventory"
inventory_root_dir="$common_dir/autopilot-worktree-lifecycle-roots"
inventory_root_key="$(
  printf '%s\0%s\0' "$repo_identity" "$root_run_id" | sha256sum | awk '{print $1}'
)"
[[ "$inventory_root_key" =~ ^[0-9a-f]{64}$ ]] \
  || die_env "cannot derive lifecycle inventory root key"

ensure_inventory_root_anchor() {
  node - "$inventory_dir" "$inventory_root_dir" "$repo_identity" "$root_run_id" <<'NODE'
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const [inventoryDirectory, anchorDirectory, repoIdentity, rootRunId] =
  process.argv.slice(2);
const uid = process.getuid();
const anchorDirectoryExisted = fs.existsSync(anchorDirectory);
function secureDirectory(directory, create, requirePrivate) {
  if (!fs.existsSync(directory)) {
    if (!create) return false;
    fs.mkdirSync(directory, { mode: 0o700 });
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || stat.uid !== uid
      || (requirePrivate && (stat.mode & 0o777) !== 0o700)) process.exit(2);
  return true;
}
const key = crypto.createHash("sha256")
  .update(`${repoIdentity}\0${rootRunId}\0`).digest("hex");
const gitDirectory = path.dirname(inventoryDirectory);
const authorityRef = `refs/autopilot/lifecycle-roots/${key}`;
function git(args, input) {
  const result = spawnSync("git", ["--git-dir", gitDirectory, ...args], {
    input,
    encoding: "utf8",
  });
  if (result.status !== 0) process.exit(2);
  return result.stdout.trim();
}
function readAuthority(required) {
  const result = spawnSync(
    "git", ["--git-dir", gitDirectory, "rev-parse", "--verify", authorityRef],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    if (required) process.exit(2);
    return null;
  }
  const oid = result.stdout.trim();
  const bytes = `${git(["cat-file", "blob", oid])}\n`;
  const value = JSON.parse(bytes);
  if (Object.keys(value).sort().join(",")
        !== "generation,journal_birthtime_ns,journal_device,journal_inode,journal_nonce,journal_records,repo_identity,root_run_id,schema"
      || value.schema !== 1 || value.repo_identity !== repoIdentity
      || value.root_run_id !== rootRunId
      || !Number.isSafeInteger(value.generation) || value.generation < 0
      || !/^[0-9a-f]{64}$/.test(value.journal_nonce)
      || !/^[1-9][0-9]*$/.test(value.journal_birthtime_ns)
      || !/^[0-9]+$/.test(value.journal_device)
      || !/^[0-9]+$/.test(value.journal_inode)
      || !Array.isArray(value.journal_records)
      || value.journal_records.some((item) =>
        typeof item !== "string"
        || !/^[0-9a-f]{64}:[0-9a-f]{64}$/.test(item))
      || new Set(value.journal_records).size !== value.journal_records.length
      || value.journal_records.join("\n")
        !== [...value.journal_records].sort().join("\n")
      || bytes !== `${JSON.stringify(value)}\n`) process.exit(2);
  return { oid, value };
}
function createAuthority(value) {
  if (readAuthority(false)) process.exit(2);
  const bytes = `${JSON.stringify(value)}\n`;
  const oid = git(["hash-object", "-w", "--stdin"], bytes);
  git(["update-ref", authorityRef, oid, ""]);
}
const anchor = path.join(anchorDirectory, `${key}.json`);
const sentinel = path.join(inventoryDirectory, `${key}.root.json`);
const registry = `${anchorDirectory}.registry.json`;
function directoryIdentity() {
  const stat = fs.lstatSync(inventoryDirectory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) process.exit(2);
  return {
    journal_birthtime_ns: stat.birthtimeNs.toString(),
    journal_device: stat.dev.toString(),
    journal_inode: stat.ino.toString(),
  };
}
function readBinding(file) {
  if (!fs.existsSync(file)) process.exit(2);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid
      || (stat.mode & 0o777) !== 0o600) process.exit(2);
  const bytes = fs.readFileSync(file, "utf8");
  const value = JSON.parse(bytes);
  if (Object.keys(value).sort().join(",")
      !== "generation,journal_birthtime_ns,journal_device,journal_inode,journal_nonce,journal_records,repo_identity,root_run_id,schema"
      || value.schema !== 1 || value.repo_identity !== repoIdentity
      || value.root_run_id !== rootRunId
      || !Number.isSafeInteger(value.generation) || value.generation < 0
      || !/^[0-9a-f]{64}$/.test(value.journal_nonce)
      || !/^[1-9][0-9]*$/.test(value.journal_birthtime_ns)
      || !/^[0-9]+$/.test(value.journal_device)
      || !/^[0-9]+$/.test(value.journal_inode)
      || !Array.isArray(value.journal_records)
      || value.journal_records.some((item) =>
        typeof item !== "string"
        || !/^[0-9a-f]{64}:[0-9a-f]{64}$/.test(item))
      || new Set(value.journal_records).size !== value.journal_records.length
      || value.journal_records.join("\n")
        !== [...value.journal_records].sort().join("\n")
      || bytes !== `${JSON.stringify(value)}\n`) process.exit(2);
  return { bytes, value };
}
function writeBinding(file, bytes) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
}
function readRegistry() {
  if (!fs.existsSync(registry)) {
    if (anchorDirectoryExisted) process.exit(2);
    const initial = `${JSON.stringify({
      schema: 1,
      repo_identity: repoIdentity,
      roots: {},
    })}\n`;
    writeBinding(registry, initial);
  }
  const stat = fs.lstatSync(registry);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid
      || (stat.mode & 0o777) !== 0o600) process.exit(2);
  const bytes = fs.readFileSync(registry, "utf8");
  const value = JSON.parse(bytes);
  if (Object.keys(value).sort().join(",") !== "repo_identity,roots,schema"
      || value.schema !== 1 || value.repo_identity !== repoIdentity
      || !value.roots || typeof value.roots !== "object"
      || Array.isArray(value.roots)
      || Object.entries(value.roots).some(([rootKey, root]) =>
        !/^[0-9a-f]{64}$/.test(rootKey)
        || !root || typeof root !== "object" || Array.isArray(root)
        || Object.keys(root).sort().join(",") !== "generation,journal_records,state"
        || !["initializing", "active"].includes(root.state)
        || !Number.isSafeInteger(root.generation) || root.generation < 0
        || !Array.isArray(root.journal_records)
        || root.journal_records.some((item) =>
          typeof item !== "string"
          || !/^[0-9a-f]{64}:[0-9a-f]{64}$/.test(item))
        || new Set(root.journal_records).size !== root.journal_records.length
        || root.journal_records.join("\n")
          !== [...root.journal_records].sort().join("\n"))
      || bytes !== `${JSON.stringify(value)}\n`) process.exit(2);
  return value;
}
function writeRegistry(value) {
  const ordered = {};
  for (const rootKey of Object.keys(value.roots).sort()) {
    ordered[rootKey] = value.roots[rootKey];
  }
  value.roots = ordered;
  writeBinding(registry, `${JSON.stringify(value)}\n`);
}
function reconcileRecordCopies(authority) {
  const authoritative = new Set(authority.value.journal_records);
  function readCopy(file) {
    if (!fs.existsSync(file)) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid
        || (stat.mode & 0o777) !== 0o600) process.exit(2);
    return fs.readFileSync(file, "utf8");
  }
  const pattern = new RegExp(`^${key}\\.([0-9a-f]{64})\\.intent\\.json$`);
  for (const name of fs.readdirSync(anchorDirectory).sort()) {
    const match = name.match(pattern);
    if (!match) continue;
    const intentFile = path.join(anchorDirectory, name);
    const stat = fs.lstatSync(intentFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid
        || (stat.mode & 0o777) !== 0o600) process.exit(2);
    const intentBytes = fs.readFileSync(intentFile, "utf8");
    const intent = JSON.parse(intentBytes);
    const recordKey = match[1];
    if (Object.keys(intent).sort().join(",")
          !== "record_key,record_sha256,root_run_id,schema"
        || intent.schema !== 1 || intent.root_run_id !== rootRunId
        || intent.record_key !== recordKey
        || !/^[0-9a-f]{64}$/.test(intent.record_sha256)
        || intentBytes !== `${JSON.stringify(intent)}\n`) process.exit(2);
    const primaryFile = path.join(inventoryDirectory, `${recordKey}.json`);
    const mirrorFile = path.join(
      anchorDirectory, `${key}.${recordKey}.record.json`,
    );
    const primaryBytes = readCopy(primaryFile);
    const mirrorBytes = readCopy(mirrorFile);
    if (primaryBytes !== null && mirrorBytes !== null
        && primaryBytes !== mirrorBytes) process.exit(2);
    const bytes = primaryBytes ?? mirrorBytes;
    if (bytes === null) {
      fs.unlinkSync(intentFile);
      continue;
    }
    if (crypto.createHash("sha256").update(bytes).digest("hex")
        !== intent.record_sha256) process.exit(2);
    const commitment = `${recordKey}:${intent.record_sha256}`;
    if (authoritative.has(commitment)) {
      // Both atomic copies precede the authority CAS. Once committed, a
      // missing copy is unexplained evidence loss, never a repairable tear.
      if (primaryBytes === null || mirrorBytes === null) process.exit(2);
    } else {
      if (primaryBytes !== null) fs.unlinkSync(primaryFile);
      if (mirrorBytes !== null) fs.unlinkSync(mirrorFile);
    }
    fs.unlinkSync(intentFile);
  }
}
const registryValue = readRegistry();
// Registry admission precedes creation of the per-root anchor directory. A
// kill after either step can resume without mistaking partial admission for
// unexplained evidence loss.
secureDirectory(anchorDirectory, true, true);
let rootRecord = registryValue.roots[key];
let rootState = rootRecord?.state;
if (fs.existsSync(anchor)) {
  if (!rootState) process.exit(2);
  const authority = readAuthority(rootState === "active");
  secureDirectory(inventoryDirectory, false, true) || process.exit(2);
  if (rootState === "initializing" && !fs.existsSync(sentinel)) {
    writeBinding(sentinel, readBinding(anchor).bytes);
  }
  const anchorBinding = readBinding(anchor);
  const sentinelBinding = readBinding(sentinel);
  const identity = directoryIdentity();
  if (anchorBinding.value.repo_identity !== sentinelBinding.value.repo_identity
      || anchorBinding.value.root_run_id !== sentinelBinding.value.root_run_id
      || anchorBinding.value.journal_nonce !== sentinelBinding.value.journal_nonce
      || anchorBinding.value.journal_birthtime_ns !== sentinelBinding.value.journal_birthtime_ns
      || anchorBinding.value.journal_device !== sentinelBinding.value.journal_device
      || anchorBinding.value.journal_inode !== sentinelBinding.value.journal_inode
      || anchorBinding.value.journal_birthtime_ns !== identity.journal_birthtime_ns
      || anchorBinding.value.journal_device !== identity.journal_device
      || anchorBinding.value.journal_inode !== identity.journal_inode) process.exit(2);
  if (authority
      && (authority.value.journal_nonce !== anchorBinding.value.journal_nonce
        || authority.value.journal_birthtime_ns
          !== anchorBinding.value.journal_birthtime_ns
        || authority.value.journal_device !== anchorBinding.value.journal_device
        || authority.value.journal_inode !== anchorBinding.value.journal_inode)) {
    process.exit(2);
  }
  if (rootState === "active") reconcileRecordCopies(authority);
  if (rootState === "initializing") {
    if (!authority) {
      createAuthority({
        schema: 1,
        repo_identity: repoIdentity,
        root_run_id: rootRunId,
        generation: anchorBinding.value.generation,
        journal_nonce: anchorBinding.value.journal_nonce,
        journal_birthtime_ns: anchorBinding.value.journal_birthtime_ns,
        journal_device: anchorBinding.value.journal_device,
        journal_inode: anchorBinding.value.journal_inode,
        journal_records: [...anchorBinding.value.journal_records],
      });
    } else if (authority.value.generation !== anchorBinding.value.generation
        || authority.value.journal_nonce !== anchorBinding.value.journal_nonce
        || authority.value.journal_birthtime_ns
          !== anchorBinding.value.journal_birthtime_ns
        || authority.value.journal_device !== anchorBinding.value.journal_device
        || authority.value.journal_inode !== anchorBinding.value.journal_inode
        || authority.value.journal_records.join("\n")
          !== anchorBinding.value.journal_records.join("\n")) {
      process.exit(2);
    }
    rootRecord.state = "active";
    rootRecord.generation = anchorBinding.value.generation;
    rootRecord.journal_records = [...anchorBinding.value.journal_records];
    writeRegistry(registryValue);
  }
  process.exit(0);
}
if (rootState === "active") process.exit(2);
if (!rootState) {
  rootRecord = { state: "initializing", generation: 0, journal_records: [] };
  registryValue.roots[key] = rootRecord;
  writeRegistry(registryValue);
  rootState = "initializing";
}
secureDirectory(inventoryDirectory, true, true);
if (fs.existsSync(sentinel)) process.exit(2);
const identity = directoryIdentity();
const journalRecords = [];
for (const name of fs.readdirSync(inventoryDirectory).sort()) {
  if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
  const file = path.join(inventoryDirectory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid
      || (stat.mode & 0o777) !== 0o600) process.exit(2);
  const bytes = fs.readFileSync(file, "utf8");
  const value = JSON.parse(bytes);
  if (value.root_run_id !== rootRunId) continue;
  if (Object.keys(value).sort().join(",")
        !== "branch,captured_at,marker_sha256,path,root_run_id,schema,tip"
      || value.schema !== 1 || typeof value.path !== "string"
      || !path.isAbsolute(value.path) || /\u0000/.test(value.path)
      || typeof value.branch !== "string"
      || /[\u0000-\u001f\u007f]/.test(value.branch)
      || !/^[0-9a-f]{40,64}$/.test(value.tip)
      || !/^[0-9a-f]{64}$/.test(value.marker_sha256)
      || !Number.isSafeInteger(value.captured_at) || value.captured_at < 1) process.exit(2);
  const recordKey = crypto.createHash("sha256")
    .update(`${rootRunId}\0${value.path}\0${value.branch}\0${value.tip}\0`)
    .digest("hex");
  if (name !== `${recordKey}.json`) process.exit(2);
  const mirror = path.join(anchorDirectory, `${key}.${recordKey}.record.json`);
  if (fs.existsSync(mirror)) {
    const mirrorStat = fs.lstatSync(mirror);
    if (!mirrorStat.isFile() || mirrorStat.isSymbolicLink()
        || mirrorStat.uid !== uid || (mirrorStat.mode & 0o777) !== 0o600
        || fs.readFileSync(mirror, "utf8") !== bytes) process.exit(2);
  } else {
    fs.writeFileSync(mirror, bytes, { flag: "wx", mode: 0o600 });
  }
  journalRecords.push(`${recordKey}:${crypto.createHash("sha256").update(bytes).digest("hex")}`);
}
const binding = `${JSON.stringify({
  schema: 1,
  repo_identity: repoIdentity,
  root_run_id: rootRunId,
  generation: 0,
  journal_nonce: crypto.randomBytes(32).toString("hex"),
  journal_birthtime_ns: identity.journal_birthtime_ns,
  journal_device: identity.journal_device,
  journal_inode: identity.journal_inode,
  journal_records: journalRecords.sort(),
})}\n`;
writeBinding(anchor, binding);
writeBinding(sentinel, binding);
createAuthority({
  schema: 1,
  repo_identity: repoIdentity,
  root_run_id: rootRunId,
  generation: 0,
  journal_nonce: JSON.parse(binding).journal_nonce,
  journal_birthtime_ns: identity.journal_birthtime_ns,
  journal_device: identity.journal_device,
  journal_inode: identity.journal_inode,
  journal_records: [...journalRecords].sort(),
});
rootRecord.state = "active";
rootRecord.generation = 0;
rootRecord.journal_records = [...journalRecords].sort();
writeRegistry(registryValue);
NODE
}

ensure_inventory_root_anchor \
  || die_env "worktree branch inventory root is missing, unsafe, or inconsistent"

commit_inventory_record() {
  local record_key="$1" record="$2"
  node - "$inventory_root_dir/$inventory_root_key.json" \
    "$inventory_dir/$inventory_root_key.root.json" \
    "$inventory_root_dir.registry.json" "$inventory_root_key" \
    "$record_key" "$record" <<'NODE'
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const [anchor, sentinel, registry, rootKey, recordKey, record] =
  process.argv.slice(2);
const gitDirectory = path.dirname(registry);
const authorityRef = `refs/autopilot/lifecycle-roots/${rootKey}`;
function git(args, input) {
  const result = spawnSync("git", ["--git-dir", gitDirectory, ...args], {
    input,
    encoding: "utf8",
  });
  if (result.status !== 0) process.exit(2);
  return result.stdout.trim();
}
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o600) process.exit(2);
  return fs.readFileSync(file, "utf8");
}
const anchorBytes = read(anchor);
const anchorValue = JSON.parse(anchorBytes);
const sentinelValue = JSON.parse(read(sentinel));
for (const field of [
  "repo_identity", "root_run_id", "journal_nonce", "journal_birthtime_ns",
  "journal_device", "journal_inode",
]) {
  if (anchorValue[field] !== sentinelValue[field]) process.exit(2);
}
const recordBytes = read(record);
const commitment = `${recordKey}:${
  crypto.createHash("sha256").update(recordBytes).digest("hex")
}`;
const registryBytes = read(registry);
const registryValue = JSON.parse(registryBytes);
const root = registryValue.roots?.[rootKey];
const authorityOid = git(["rev-parse", "--verify", authorityRef]);
const authorityValue = JSON.parse(
  `${git(["cat-file", "blob", authorityOid])}\n`,
);
if (!root || root.state !== "active" || !Number.isSafeInteger(root.generation)
    || !Array.isArray(root.journal_records)
    || authorityValue.repo_identity !== anchorValue.repo_identity
    || authorityValue.root_run_id !== anchorValue.root_run_id
    || authorityValue.journal_nonce !== anchorValue.journal_nonce
    || authorityValue.journal_birthtime_ns !== anchorValue.journal_birthtime_ns
    || authorityValue.journal_device !== anchorValue.journal_device
    || authorityValue.journal_inode !== anchorValue.journal_inode
    || !Number.isSafeInteger(authorityValue.generation)
    || !Array.isArray(authorityValue.journal_records)
    || root.generation > authorityValue.generation
    || anchorValue.generation > authorityValue.generation
    || root.journal_records.some((item) =>
      !authorityValue.journal_records.includes(item))
    || anchorValue.journal_records.some((item) =>
      !authorityValue.journal_records.includes(item))) {
  process.exit(2);
}
if (!authorityValue.journal_records.includes(commitment)) {
  if (authorityValue.journal_records.some((item) =>
    item.startsWith(`${recordKey}:`))) process.exit(2);
  authorityValue.journal_records.push(commitment);
  authorityValue.journal_records.sort();
  authorityValue.generation += 1;
  const authorityBytes = `${JSON.stringify(authorityValue)}\n`;
  const nextOid = git(["hash-object", "-w", "--stdin"], authorityBytes);
  git(["update-ref", authorityRef, nextOid, authorityOid]);
}
function replace(file, bytes) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
}
if (process.env.AUTOPILOT_TEST_MODE === "1"
    && process.env.AUTOPILOT_TEST_LIFECYCLE_KILL_AFTER_AUTHORITY === recordKey) {
  process.kill(process.pid, "SIGKILL");
}
anchorValue.generation = authorityValue.generation;
anchorValue.journal_records = [...authorityValue.journal_records];
replace(anchor, `${JSON.stringify(anchorValue)}\n`);
root.generation = authorityValue.generation;
root.journal_records = [...authorityValue.journal_records];
replace(registry, `${JSON.stringify(registryValue)}\n`);
NODE
}

append_item() {
  local array_name="$1" value="$2"
  local -n target="$array_name"
  target+=("$value")
}

emit_array() {
  local array_name="$1" first=1 value
  local -n source="$array_name"
  printf '['
  for value in "${source[@]}"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '%s' "$value"
  done
  printf ']'
}

worktree_object() {
  local path="$1" branch="$2" tip="$3" state="$4" reason="$5"
  printf '{"path":"%s","branch":"%s","tip":"%s","state":"%s","reason":"%s"}' \
    "$(json_escape "$path")" "$(json_escape "$branch")" "$(json_escape "$tip")" \
    "$(json_escape "$state")" "$(json_escape "$reason")"
}

persist_branch_inventory() {
  local path="$1" branch="$2" tip="$3" marker_sha="$4"
  local key record mirror intent tmp
  _INVENTORY_RECORD_PATH=""
  ensure_inventory_root_anchor || return 1
  [ -d "$inventory_dir" ] && [ ! -L "$inventory_dir" ] && [ -O "$inventory_dir" ] \
    && [ "$(stat -c '%a' "$inventory_dir")" = "700" ] \
    || return 1
  key="$(
    printf '%s\0%s\0%s\0%s\0' "$root_run_id" "$path" "$branch" "$tip" \
      | sha256sum | awk '{print $1}'
  )"
  [[ "$key" =~ ^[0-9a-f]{64}$ ]] || return 1
  node - "$inventory_dir" "$root_run_id" "$branch" "$tip" <<'NODE' \
    || return 1
const fs = require("fs");
const path = require("path");
const [directory, rootRunId, branch, tip] = process.argv.slice(2);
for (const name of fs.readdirSync(directory)) {
  if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) process.exit(2);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.root_run_id === rootRunId && value.branch === branch
      && value.tip !== tip) process.exit(2);
}
NODE
  record="$inventory_dir/$key.json"
  mirror="$inventory_root_dir/$inventory_root_key.$key.record.json"
  intent="$inventory_root_dir/$inventory_root_key.$key.intent.json"
  tmp="$(mktemp "$inventory_dir/.inventory.XXXXXX")" || return 1
  if ! printf \
    '{"schema":1,"root_run_id":"%s","path":"%s","branch":"%s","tip":"%s","marker_sha256":"%s","captured_at":%s}\n' \
    "$(json_escape "$root_run_id")" "$(json_escape "$path")" "$(json_escape "$branch")" \
    "$(json_escape "$tip")" "$(json_escape "$marker_sha")" "$(date +%s)" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  if ! node - "$tmp" "$mirror" "$intent" "$root_run_id" "$key" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const [source, mirror, intent, rootRunId, recordKey] = process.argv.slice(2);
function atomicCreate(file, bytes) {
  const temporary = `${file}.${process.pid}.${
    crypto.randomBytes(6).toString("hex")
  }.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
}
let bytes = fs.readFileSync(source, "utf8");
if (fs.existsSync(mirror)) {
  const stat = fs.lstatSync(mirror);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o600) process.exit(2);
  const priorBytes = fs.readFileSync(mirror, "utf8");
  const prior = JSON.parse(priorBytes);
  const next = JSON.parse(bytes);
  next.captured_at = prior.captured_at;
  if (priorBytes !== `${JSON.stringify(next)}\n`) process.exit(2);
  bytes = priorBytes;
  fs.writeFileSync(source, bytes, { flag: "w", mode: 0o600 });
} else {
  // The intent is durable before either final record copy is published.
}
const intentValue = {
  schema: 1,
  root_run_id: rootRunId,
  record_key: recordKey,
  record_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
};
const intentBytes = `${JSON.stringify(intentValue)}\n`;
if (fs.existsSync(intent)) {
  if (fs.readFileSync(intent, "utf8") !== intentBytes) process.exit(2);
} else {
  atomicCreate(intent, intentBytes);
}
if (!fs.existsSync(mirror)) {
  atomicCreate(mirror, bytes);
}
NODE
  then
    rm -f "$tmp"
    return 1
  fi
  if [ "${AUTOPILOT_TEST_MODE:-0}" = "1" ] \
     && [ "${AUTOPILOT_TEST_LIFECYCLE_KILL_AFTER_MIRROR:-0}" = "1" ]; then
    kill -KILL "$$"
  fi
  mv -f "$tmp" "$record" || { rm -f "$tmp"; return 1; }
  commit_inventory_record "$key" "$record" || return 1
  rm -f "$intent" || return 1
  _INVENTORY_RECORD_PATH="$record"
}

load_journal_branch_inventory() {
  _JOURNAL_BRANCH_INVENTORY='[]'
  ensure_inventory_root_anchor || return 1
  [ -d "$inventory_dir" ] && [ ! -L "$inventory_dir" ] && [ -O "$inventory_dir" ] \
    && [ "$(stat -c '%a' "$inventory_dir")" = "700" ] \
    || return 1
  _JOURNAL_BRANCH_INVENTORY="$(
    node - "$inventory_dir" "$root_run_id" "$common_dir/autopilot-branch-dispositions" \
      "$repo_identity" "$inventory_root_dir" "$inventory_root_key" <<'NODE'
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const directory = process.argv[2];
const rootRunId = process.argv[3];
const dispositionDirectory = process.argv[4];
const repoIdentity = process.argv[5];
const mirrorDirectory = process.argv[6];
const rootKey = process.argv[7];
const branches = new Map();
const journalRecords = new Map();
for (const name of fs.readdirSync(directory).sort()) {
  if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) process.exit(2);
  const bytes = fs.readFileSync(file, "utf8");
  const value = JSON.parse(bytes);
  if (value.root_run_id !== rootRunId) continue;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "branch,captured_at,marker_sha256,path,root_run_id,schema,tip"
      || value.schema !== 1 || typeof value.branch !== "string"
      || /[\u0000-\u001f\u007f]/.test(value.branch)
      || typeof value.path !== "string" || !path.isAbsolute(value.path)
      || /\u0000/.test(value.path)
      || !/^[0-9a-f]{40,64}$/.test(value.tip)
      || !/^[0-9a-f]{64}$/.test(value.marker_sha256)
      || !Number.isSafeInteger(value.captured_at) || value.captured_at < 1) process.exit(2);
  const expectedName = `${crypto.createHash("sha256")
    .update(`${rootRunId}\0${value.path}\0${value.branch}\0${value.tip}\0`)
    .digest("hex")}.json`;
  if (name !== expectedName) process.exit(2);
  if (branches.has(value.branch)) process.exit(2);
  branches.set(value.branch, value.tip);
  journalRecords.set(name, bytes);
}
const mirrorRecords = new Map();
const mirrorPattern = new RegExp(`^${rootKey}\\.([0-9a-f]{64})\\.record\\.json$`);
for (const name of fs.readdirSync(mirrorDirectory).sort()) {
  const match = name.match(mirrorPattern);
  if (!match) continue;
  const file = path.join(mirrorDirectory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o600) process.exit(2);
  mirrorRecords.set(`${match[1]}.json`, fs.readFileSync(file, "utf8"));
}
if (journalRecords.size !== mirrorRecords.size) process.exit(2);
for (const [name, bytes] of journalRecords) {
  if (mirrorRecords.get(name) !== bytes) process.exit(2);
}
const commitments = [...journalRecords.entries()]
  .map(([name, bytes]) =>
    `${name.slice(0, -5)}:${crypto.createHash("sha256").update(bytes).digest("hex")}`)
  .sort();
const registryPath = `${mirrorDirectory}.registry.json`;
const registryStat = fs.lstatSync(registryPath);
if (!registryStat.isFile() || registryStat.isSymbolicLink()
    || registryStat.uid !== process.getuid()
    || (registryStat.mode & 0o777) !== 0o600) process.exit(2);
const registryValue = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const rootRecord = registryValue.roots?.[rootKey];
if (registryValue.schema !== 1 || registryValue.repo_identity !== repoIdentity
    || !rootRecord || rootRecord.state !== "active"
    || !Number.isSafeInteger(rootRecord.generation)
    || !Array.isArray(rootRecord.journal_records)) process.exit(2);
const anchorPath = path.join(mirrorDirectory, `${rootKey}.json`);
const anchorValue = JSON.parse(fs.readFileSync(anchorPath, "utf8"));
const authorityRef = `refs/autopilot/lifecycle-roots/${rootKey}`;
function git(args, input) {
  const result = spawnSync("git", ["--git-dir", path.dirname(directory), ...args], {
    input,
    encoding: "utf8",
  });
  if (result.status !== 0) process.exit(2);
  return result.stdout.trim();
}
let authorityOid = git(["rev-parse", "--verify", authorityRef]);
const authorityValue = JSON.parse(
  `${git(["cat-file", "blob", authorityOid])}\n`,
);
if (!Number.isSafeInteger(anchorValue.generation)
    || !Array.isArray(anchorValue.journal_records)
    || authorityValue.repo_identity !== repoIdentity
    || authorityValue.root_run_id !== rootRunId
    || authorityValue.journal_nonce !== anchorValue.journal_nonce
    || authorityValue.journal_birthtime_ns !== anchorValue.journal_birthtime_ns
    || authorityValue.journal_device !== anchorValue.journal_device
    || authorityValue.journal_inode !== anchorValue.journal_inode
    || !Number.isSafeInteger(authorityValue.generation)
    || !Array.isArray(authorityValue.journal_records)
    || rootRecord.generation > authorityValue.generation
    || anchorValue.generation > authorityValue.generation
    || rootRecord.journal_records.some((item) =>
      !authorityValue.journal_records.includes(item))
    || anchorValue.journal_records.some((item) =>
      !authorityValue.journal_records.includes(item))) process.exit(2);
const actualSet = new Set(commitments);
if (authorityValue.journal_records.some((item) => !actualSet.has(item))
    || commitments.some((item) =>
      !authorityValue.journal_records.includes(item))) process.exit(2);
function replace(file, value) {
  const temporary = `${file}.${process.pid}.${
    crypto.randomBytes(6).toString("hex")
  }.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}
if (anchorValue.generation !== authorityValue.generation
    || anchorValue.journal_records.join("\n")
      !== authorityValue.journal_records.join("\n")) {
  anchorValue.generation = authorityValue.generation;
  anchorValue.journal_records = [...authorityValue.journal_records];
  replace(anchorPath, anchorValue);
}
if (rootRecord.generation !== authorityValue.generation
    || rootRecord.journal_records.join("\n")
      !== authorityValue.journal_records.join("\n")) {
  rootRecord.generation = authorityValue.generation;
  rootRecord.journal_records = [...authorityValue.journal_records];
  replace(registryPath, registryValue);
}
const resolved = new Map();
if (fs.existsSync(dispositionDirectory)) {
  const directoryStat = fs.lstatSync(dispositionDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) process.exit(2);
  for (const name of fs.readdirSync(dispositionDirectory).sort()) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const file = path.join(dispositionDirectory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) process.exit(2);
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.root_run_id !== rootRunId) continue;
    const keys = Object.keys(value).sort().join(",");
    if (keys !== "acknowledged,branch,bundle,disposition,inventory_digest,recorded_at,repo_identity,root_run_id,schema,tip"
        || value.schema !== 1 || value.repo_identity !== repoIdentity
        || !branches.has(value.branch) || branches.get(value.branch) !== value.tip
        || !["reaped", "preserved", "failed"].includes(value.disposition)
        || typeof value.acknowledged !== "boolean"
        || (value.disposition !== "preserved" && value.acknowledged)
        || !(value.bundle === null || typeof value.bundle === "string")
        || !/^[0-9a-f]{64}$/.test(value.inventory_digest)
        || !Number.isSafeInteger(value.recorded_at) || value.recorded_at < 1) process.exit(2);
    const expectedName = `${crypto.createHash("sha256")
      .update(`${rootRunId}\0${value.branch}\0${value.tip}\0`)
      .digest("hex")}.json`;
    if (name !== expectedName || resolved.has(value.branch)) process.exit(2);
    resolved.set(value.branch, value);
  }
}
process.stdout.write(JSON.stringify(
  [...branches.entries()]
    .filter(([branch]) => {
      const value = resolved.get(branch);
      let refExists = false;
      if (value?.disposition === "reaped") {
        const ref = `refs/heads/${branch}`;
        refExists = spawnSync("git", [
          "--git-dir", path.dirname(directory),
          "show-ref", "--verify", "--quiet", ref,
        ]).status === 0 || spawnSync("git", [
          "--git-dir", path.dirname(directory),
          "symbolic-ref", "-q", ref,
        ]).status === 0;
      }
      return !value || refExists || !(value.disposition === "reaped"
        || (value.disposition === "preserved" && value.acknowledged));
    })
    .map(([branch, tip]) => ({ branch, tip }))
    .sort((left, right) => left.branch.localeCompare(right.branch)),
));
NODE
  )" || return 1
}

load_worktree_snapshot() {
  local list_file token path="" head="" branch=""
  snapshot_paths=()
  snapshot_head=()
  snapshot_branch=()
  list_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-worktree-list.XXXXXX")" || return 1
  if ! git_common worktree list --porcelain -z > "$list_file" 2>/dev/null; then
    rm -f "$list_file"
    return 1
  fi
  while IFS= read -r -d '' token; do
    if [ -z "$token" ]; then
      if [ -n "$path" ]; then
        snapshot_paths+=("$path")
        snapshot_head["$path"]="$head"
        snapshot_branch["$path"]="$branch"
      fi
      path=""; head=""; branch=""
      continue
    fi
    case "$token" in
      worktree\ *) path="${token#worktree }" ;;
      HEAD\ *) head="${token#HEAD }" ;;
      branch\ refs/heads/*) branch="${token#branch refs/heads/}" ;;
    esac
  done < "$list_file"
  rm -f "$list_file"
}

current_metadata() {
  local expected="$1" list_file token path="" head="" branch=""
  _CURRENT_FOUND=0
  _CURRENT_HEAD=""
  _CURRENT_BRANCH=""
  list_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-worktree-current.XXXXXX")" || return 2
  if ! git_common worktree list --porcelain -z > "$list_file" 2>/dev/null; then
    rm -f "$list_file"
    return 2
  fi
  while IFS= read -r -d '' token; do
    if [ -z "$token" ]; then
      if [ "$path" = "$expected" ]; then
        _CURRENT_FOUND=1
        _CURRENT_HEAD="$head"
        _CURRENT_BRANCH="$branch"
        rm -f "$list_file"
        return 0
      fi
      path=""; head=""; branch=""
      continue
    fi
    case "$token" in
      worktree\ *) path="${token#worktree }" ;;
      HEAD\ *) head="${token#HEAD }" ;;
      branch\ refs/heads/*) branch="${token#branch refs/heads/}" ;;
    esac
  done < "$list_file"
  rm -f "$list_file"
  return 0
}

probe_is_current() {
  local path="$1" fd="$2" lock="$path/.autopilot-worktree.lock" fd_path
  fd_path="/proc/$$/fd/$fd"
  [ -e "$fd_path" ] || fd_path="/dev/fd/$fd"
  [ -f "$lock" ] && [ ! -L "$lock" ] && [ -O "$lock" ] \
    && [ -f "$fd_path" ] && [ -O "$fd_path" ] && [ "$fd_path" -ef "$lock" ]
}

load_pending_records() {
  local pending_dir="$common_dir/autopilot-worktree-creation"
  local record fields=()
  [ -d "$pending_dir" ] || return 0
  for record in "$pending_dir"/*.json; do
    [ -e "$record" ] || continue
    [ -f "$record" ] && [ ! -L "$record" ] && [ -O "$record" ] || continue
    mapfile -t fields < <(node -e '
const fs = require("fs");
try {
  const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const keys = ["root_run_id", "run_id", "loop_id", "branch", "base_sha", "planned_path"];
  if (!v || v.schema !== 1 || keys.some(k => typeof v[k] !== "string")) process.exit(2);
  for (const k of keys) console.log(v[k]);
} catch (_) { process.exit(2); }
' "$record" 2>/dev/null)
    if [ "${#fields[@]}" -ne 6 ]; then
      append_item malformed_items "$(worktree_object \
        "$record" "" "" "malformed" "invalid_pending_record")"
      continue
    fi
    [ "${fields[0]}" = "$root_run_id" ] || continue
    if ! [[ "${fields[0]}" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "${fields[1]}" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "${fields[2]}" =~ ^[A-Za-z0-9._-]+$ ]] \
       || ! [[ "${fields[4]}" =~ ^[0-9a-f]{40,64}$ ]] \
       || [[ "${fields[5]}" != /* ]] \
       || _wt_has_control_chars "${fields[5]}" \
       || ! git check-ref-format --branch "${fields[3]}" >/dev/null 2>&1; then
      append_item malformed_items "$(worktree_object \
        "$record" "${fields[3]}" "${fields[4]}" "malformed" "invalid_pending_identity")"
      continue
    fi
    append_item pending_items "$(printf \
      '{"record":"%s","path":"%s","branch":"%s","base_sha":"%s","run_id":"%s","loop_id":"%s"}' \
      "$(json_escape "$record")" "$(json_escape "${fields[5]}")" \
      "$(json_escape "${fields[3]}")" "$(json_escape "${fields[4]}")" \
      "$(json_escape "${fields[1]}")" "$(json_escape "${fields[2]}")")"
  done
}

load_worktree_snapshot || die_env "cannot enumerate registered worktrees"
load_pending_records

observed_owned_count=0
remaining_owned_count=0
target_journaled=0

for path in "${snapshot_paths[@]}"; do
  marker="$path/.autopilot-worktree"
  [ -e "$marker" ] || [ -L "$marker" ] || continue
  branch="${snapshot_branch[$path]:-}"
  tip="${snapshot_head[$path]:-}"

  if [ -f "$marker" ] && [ ! -L "$marker" ] && [ -O "$marker" ] \
     && grep -qx 'schema=1' "$marker" 2>/dev/null; then
    item="$(worktree_object "$path" "$branch" "$tip" "legacy" "schema_1_unknown_lineage")"
    append_item legacy_items "$item"
    continue
  fi
  if ! _wt_read_schema2_marker "$marker"; then
    item="$(worktree_object "$path" "$branch" "$tip" "malformed" "invalid_schema_2_marker")"
    append_item malformed_items "$item"
    continue
  fi
  [ "$_WT_MARKER_ROOT_RUN_ID" = "$root_run_id" ] || continue

  observed_owned_count=$((observed_owned_count + 1))
  marker_branch="$_WT_MARKER_BRANCH"
  marker_base="$_WT_MARKER_BASE_SHA"
  marker_digest="$(sha256sum < "$marker" 2>/dev/null | awk '{print $1}')"
  path_common="$(_wt_resolve_common_dir "$path" 2>/dev/null || true)"
  ref_tip="$(git_common rev-parse --verify --quiet "refs/heads/$marker_branch" 2>/dev/null || true)"

  if [ -z "$marker_digest" ] || [ "$path_common" != "$common_dir" ] \
     || [ "$branch" != "$marker_branch" ] || [ "$tip" != "$ref_tip" ] \
     || ! git_common merge-base --is-ancestor "$marker_base" "$tip" 2>/dev/null; then
    item="$(worktree_object "$path" "$branch" "$tip" "malformed" "ownership_identity_mismatch")"
    append_item owned_items "$item"
    append_item malformed_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    continue
  fi

  marker_run="$_WT_MARKER_RUN_ID"
  marker_loop="$_WT_MARKER_LOOP_ID"
  if [ "$command_name" = "reap" ] && [ "$path" = "$target_path" ] \
     && [ -n "$expected_tip" ] && [ "$tip" != "$expected_tip" ]; then
    item="$(worktree_object "$path" "$branch" "$tip" "raced" "expected_tip_changed")"
    append_item owned_items "$item"
    append_item raced_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    continue
  fi
  _wt_is_live "$path"
  live_rc=$?
  probe_fd="${_WT_PROBE_FD:-}"
  if [ "$live_rc" -eq 1 ]; then
    item="$(worktree_object "$path" "$branch" "$tip" "live" "lifetime_lock_held")"
    append_item owned_items "$item"
    append_item live_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    continue
  fi
  if [ "$live_rc" -eq 2 ]; then
    item="$(worktree_object "$path" "$branch" "$tip" "lock_unsupported" "lifetime_lock_unavailable")"
    append_item owned_items "$item"
    append_item unsupported_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    continue
  fi

  _wt_is_clean "$path"
  clean_rc=$?
  if [ "$clean_rc" -ne 0 ]; then
    if [ "$clean_rc" -eq 2 ]; then
      item="$(worktree_object "$path" "$branch" "$tip" "status_unsupported" "status_command_failed")"
      append_item status_unsupported_items "$item"
    else
      item="$(worktree_object "$path" "$branch" "$tip" "dirty" "worktree_not_clean")"
      append_item dirty_items "$item"
    fi
    append_item owned_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    continue
  fi

  clean_item="$(worktree_object "$path" "$branch" "$tip" "clean_dead" "eligible")"
  if [ "$command_name" = "journal" ]; then
    if [ "$path" = "$target_path" ] \
       && persist_branch_inventory "$path" "$branch" "$tip" "$marker_digest"; then
      target_journaled=1
      append_item inventory_record_items "$(printf \
        '{"path":"%s","branch":"%s","tip":"%s","record":"%s"}' \
        "$(json_escape "$path")" "$(json_escape "$branch")" "$(json_escape "$tip")" \
        "$(json_escape "$_INVENTORY_RECORD_PATH")")"
    fi
    append_item owned_items "$clean_item"
    append_item clean_items "$clean_item"
    remaining_owned_count=$((remaining_owned_count + 1))
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    continue
  fi
  if [ "$command_name" != "reap" ]; then
    append_item owned_items "$clean_item"
    append_item clean_items "$clean_item"
    remaining_owned_count=$((remaining_owned_count + 1))
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    continue
  fi

  if [ "$command_name" = "reap" ] && [ -n "$target_path" ] \
     && [ "$path" != "$target_path" ]; then
    append_item owned_items "$clean_item"
    append_item clean_items "$clean_item"
    remaining_owned_count=$((remaining_owned_count + 1))
    [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
    _WT_PROBE_FD=""
    continue
  fi

  if [ "${AUTOPILOT_TEST_MODE:-0}" = "1" ] \
     && [ "${AUTOPILOT_TEST_WORKTREE_REAP_RACE_PATH:-}" = "$path" ]; then
    printf '%s\n' "race" > "$path/.autopilot-test-race"
  fi
  if [ "${AUTOPILOT_TEST_MODE:-0}" = "1" ] \
     && [ "${AUTOPILOT_TEST_WORKTREE_REAP_LOCK_RACE_PATH:-}" = "$path" ]; then
    rm -f "$path/.autopilot-worktree.lock"
    : > "$path/.autopilot-worktree.lock"
  fi
  if [ "${AUTOPILOT_TEST_MODE:-0}" = "1" ] \
     && [ "${AUTOPILOT_TEST_WORKTREE_REAP_MARKER_RACE_PATH:-}" = "$path" ]; then
    printf '%s\n' "marker-race=1" >> "$marker"
  fi

  current_metadata "$path"
  metadata_rc=$?
  raced_reason=""
  [ "$metadata_rc" -eq 0 ] || raced_reason="worktree_enumeration_failed"
  [ -n "$raced_reason" ] || [ "$_CURRENT_FOUND" -eq 1 ] \
    || raced_reason="registration_changed"
  [ -n "$raced_reason" ] || [ "$_CURRENT_HEAD" = "$tip" ] \
    || raced_reason="head_changed"
  [ -n "$raced_reason" ] || [ "$_CURRENT_BRANCH" = "$branch" ] \
    || raced_reason="branch_changed"
  if [ -z "$raced_reason" ]; then
    _wt_is_clean "$path"
    clean_rc=$?
    if [ "$clean_rc" -eq 2 ]; then
      raced_reason="status_command_failed"
    elif [ "$clean_rc" -ne 0 ]; then
      raced_reason="cleanliness_changed"
    fi
  fi
  [ -n "$raced_reason" ] || probe_is_current "$path" "$probe_fd" \
    || raced_reason="lifetime_lock_changed"
  [ -n "$raced_reason" ] \
    || [ "$(git_common rev-parse --verify --quiet "refs/heads/$branch" 2>/dev/null || true)" = "$tip" ] \
    || raced_reason="branch_tip_changed"
  [ -n "$raced_reason" ] \
    || [ "$(sha256sum < "$marker" 2>/dev/null | awk '{print $1}')" = "$marker_digest" ] \
    || raced_reason="marker_changed"
  if [ -z "$raced_reason" ]; then
    if ! _wt_read_schema2_marker "$marker" \
       || [ "$_WT_MARKER_ROOT_RUN_ID" != "$root_run_id" ] \
       || [ "$_WT_MARKER_RUN_ID" != "$marker_run" ] \
       || [ "$_WT_MARKER_LOOP_ID" != "$marker_loop" ] \
       || [ "$_WT_MARKER_BRANCH" != "$branch" ] \
       || [ "$_WT_MARKER_BASE_SHA" != "$marker_base" ]; then
      raced_reason="marker_identity_changed"
    fi
  fi
  if [ -z "$raced_reason" ]; then
    persist_branch_inventory "$path" "$branch" "$tip" "$marker_digest" \
      || raced_reason="inventory_persist_failed"
  fi

  if [ -z "$raced_reason" ] && git_common worktree remove "$path" >/dev/null 2>&1; then
    reaped_item="$(worktree_object "$path" "$branch" "$tip" "reaped" "dead_clean_exact")"
    append_item reaped_items "$reaped_item"
    append_item inventory_record_items "$(printf \
      '{"path":"%s","branch":"%s","tip":"%s","record":"%s"}' \
      "$(json_escape "$path")" "$(json_escape "$branch")" "$(json_escape "$tip")" \
      "$(json_escape "$_INVENTORY_RECORD_PATH")")"
  else
    [ -n "$raced_reason" ] || raced_reason="remove_failed"
    item="$(worktree_object "$path" "$branch" "$tip" "raced" "$raced_reason")"
    append_item owned_items "$item"
    append_item raced_items "$item"
    remaining_owned_count=$((remaining_owned_count + 1))
  fi
  [ -n "$probe_fd" ] && exec {probe_fd}>&- || true
  _WT_PROBE_FD=""
done

load_journal_branch_inventory \
  || die_env "cannot reconstruct exact branch inventory journal"

printf '{"schema":1,"command":"%s","repo":"%s","git_common_dir":"%s","root_run_id":"%s","observed_owned_count":%s,"owned_worktree_count":%s,"unresolved_pending_count":%s,"owned":' \
  "$command_name" "$(json_escape "$repo")" "$(json_escape "$common_dir")" \
  "$(json_escape "$root_run_id")" "$observed_owned_count" "$remaining_owned_count" \
  "${#pending_items[@]}"
emit_array owned_items
printf ',"clean_dead":'; emit_array clean_items
printf ',"dirty":'; emit_array dirty_items
printf ',"live":'; emit_array live_items
printf ',"lock_unsupported":'; emit_array unsupported_items
printf ',"status_unsupported":'; emit_array status_unsupported_items
printf ',"malformed":'; emit_array malformed_items
printf ',"legacy":'; emit_array legacy_items
printf ',"pending_creation":'; emit_array pending_items
printf ',"raced":'; emit_array raced_items
printf ',"reaped":'; emit_array reaped_items
printf ',"branch_inventory":'; emit_array reaped_items
printf ',"branch_inventory_records":'; emit_array inventory_record_items
printf ',"journal_branch_inventory":%s' "$_JOURNAL_BRANCH_INVENTORY"
printf '}\n'

exec {lifecycle_fd}>&-
if [ "$command_name" = "check" ] \
   && { [ "$remaining_owned_count" -ne 0 ] || [ "${#pending_items[@]}" -ne 0 ]; }; then
  exit 1
fi
[ "$command_name" != "journal" ] || [ "$target_journaled" -eq 1 ] || exit 1
exit 0
