#!/usr/bin/env bash
# Preserve-first lifecycle tool for local dispatch-owned branches.

set -uo pipefail

usage() {
  local exit_code="${1:-2}"
  printf '%s\n' \
    'usage: reap-dispatch-branches.sh scan|check|reap [options]' \
    '  shared: --repo <dir> --into <ref> --pattern <bash-ere> --inventory-file <json>' \
    '  check:  --ack <integration-candidate-branch>' \
    '  reap:   --dry-run --yes --reap-superseded --bundle-dir <dir> --ack-preserved <branch@tip>' \
    '  exact lifecycle: use the unmodified worktree-controller JSON as --inventory-file;' \
    '    contained tips are bundle-reaped, uncontained tips require exact --ack-preserved' >&2
  exit "$exit_code"
}

die_env() { printf 'error: %s\n' "$*" >&2; exit 2; }

# shellcheck source=lib/json-emit.sh
self_dir="$(cd "$(dirname "$0")" && pwd)"
. "$self_dir/lib/json-emit.sh"
# shellcheck source=lib/worktree-reap.sh
. "$self_dir/lib/worktree-reap.sh"

command_name="${1:-}"
case "$command_name" in
  scan|check|reap) shift ;;
  --help|-h) usage 0 ;;
  *) usage ;;
esac

repo="."
into="develop"
ack_branch=""
yes=0
dry_run=0
reap_superseded=0
bundle_dir=""
inventory_file=""
declare -a extra_patterns=()
declare -a preserve_ack_specs=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) [ "$#" -ge 2 ] || usage; repo="$2"; shift 2 ;;
    --into) [ "$#" -ge 2 ] || usage; into="$2"; shift 2 ;;
    --pattern) [ "$#" -ge 2 ] || usage; extra_patterns+=("$2"); shift 2 ;;
    --inventory-file) [ "$#" -ge 2 ] || usage; inventory_file="$2"; shift 2 ;;
    --ack) [ "$command_name" = check ] && [ "$#" -ge 2 ] || usage; ack_branch="$2"; shift 2 ;;
    --dry-run) [ "$command_name" = reap ] || usage; dry_run=1; shift ;;
    --yes) [ "$command_name" = reap ] || usage; yes=1; shift ;;
    --reap-superseded) [ "$command_name" = reap ] || usage; reap_superseded=1; shift ;;
    --bundle-dir) [ "$command_name" = reap ] && [ "$#" -ge 2 ] || usage; bundle_dir="$2"; shift 2 ;;
    --ack-preserved) [ "$command_name" = reap ] && [ "$#" -ge 2 ] || usage; preserve_ack_specs+=("$2"); shift 2 ;;
    --help|-h) usage 0 ;;
    *) usage ;;
  esac
done

repo="$(cd "$repo" 2>/dev/null && pwd -P)" || die_env "repository directory is not readable"
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || die_env "not a git repository: $repo"
common_raw="$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null)" \
  || die_env "cannot resolve git common dir"
common_dir="$(cd "$repo" && cd "$common_raw" 2>/dev/null && pwd -P)" \
  || die_env "cannot canonicalize git common dir"
repo_identity="git-common-dir:$common_dir"
disposition_dir="$common_dir/autopilot-branch-dispositions"
case "$into" in
  refs/heads/*) into_name="${into#refs/heads/}" ;;
  refs/*) die_env "integration target must be an exact local branch: $into" ;;
  *) into_name="$into" ;;
esac
[ -n "$into_name" ] || die_env "integration target branch name is empty"
git check-ref-format "refs/heads/$into_name" >/dev/null 2>&1 || die_env "invalid integration target branch: $into"
into_ref="refs/heads/$into_name"
into="$into_name"

for pattern in "${extra_patterns[@]}"; do
  [ -n "$pattern" ] || die_env "--pattern ERE must not be empty"
  [[ "" =~ $pattern ]]
  [ "$?" -ne 2 ] || die_env "invalid --pattern ERE: $pattern"
done

candidate_re='^ceo-integration-candidate-r([0-9]+)$'
unit_re='^agent/[a-z0-9-]+-r([0-9]+)-([0-9]{8})$'
intermediate_re='^ceo-[a-z0-9][a-z0-9-]*-r([0-9]+)-([0-9]{8})$'
round_key_re='^(.*)-r([0-9]+)-([0-9]{8})$'

declare -a branches=() candidates=() canonical_candidates=() maximal_candidates=()
declare -a reapable=() superseded=() kept=() candidates_ahead=()
declare -A family=() tip=() ahead=() contained_in=() superseded_by=()
declare -A round=() sibling_key=() canonical_for_tip=() is_maximal_candidate=()
declare -A highest_round=() highest_name=() partition=()
declare -A snapshot_tip=()
declare -a local_branch_names=()
declare -A inventory_expected=()
declare -A inventory_preserve_ack=()
declare -A inventory_reaped_bundle=()
declare -a inventory_names=()
declare -a recovered_reaped_names=()
inventory_root_run_id=""
inventory_digest=""

recover_reaped_inventory() {
  local branch="$1" expected="$2" key record recovered_bundle heads
  local verifier object_format
  key="$(
    printf '%s\0%s\0%s\0' "$inventory_root_run_id" "$branch" "$expected" \
      | sha256sum | awk '{print $1}'
  )"
  record="$disposition_dir/$key.json"
  [ -f "$record" ] && [ ! -L "$record" ] || return 1
  recovered_bundle="$(
    node - "$record" "$repo_identity" "$inventory_root_run_id" \
      "$branch" "$expected" "$inventory_digest" <<'NODE'
const fs = require("fs");
const [file, repoIdentity, rootRunId, branch, tip, inventoryDigest] =
  process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, "utf8"));
if (Object.keys(value).sort().join(",")
      !== "acknowledged,branch,bundle,disposition,inventory_digest,recorded_at,repo_identity,root_run_id,schema,tip"
    || value.schema !== 1 || value.repo_identity !== repoIdentity
    || value.root_run_id !== rootRunId || value.branch !== branch
    || value.tip !== tip || value.inventory_digest !== inventoryDigest
    || value.disposition !== "reaped" || value.acknowledged !== false
    || typeof value.bundle !== "string") process.exit(2);
process.stdout.write(value.bundle);
NODE
  )" || return 1
  [ -f "$recovered_bundle" ] && [ ! -L "$recovered_bundle" ] || return 1
  git -C "$repo" bundle verify "$recovered_bundle" >/dev/null 2>&1 || return 1
  heads="$(git -C "$repo" bundle list-heads "$recovered_bundle" 2>/dev/null)" \
    || return 1
  printf '%s\n' "$heads" \
    | grep -Fqx "$expected refs/heads/$branch" || return 1
  object_format="$(git -C "$repo" rev-parse --show-object-format 2>/dev/null)" \
    || return 1
  verifier="$(mktemp -d "${TMPDIR:-/tmp}/autopilot-bundle-recovery.XXXXXX")" \
    || return 1
  if ! git init --bare -q --object-format="$object_format" "$verifier" \
      || ! git --git-dir="$verifier" bundle unbundle "$recovered_bundle" \
        >/dev/null 2>&1; then
    rm -rf "$verifier"
    return 1
  fi
  rm -rf "$verifier"
  inventory_reaped_bundle["$branch"]="$recovered_bundle"
  recovered_reaped_names+=("$branch")
}

initial_heads_snapshot=""
check_heads_final=""
check_heads_post_evaluation=""
ack_tmp=""
trap 'rm -f "${initial_heads_snapshot:-}" "${check_heads_final:-}" "${check_heads_post_evaluation:-}" "${ack_tmp:-}"' EXIT

snapshot_local_heads() {
  local output="$1" err rc enumeration_error
  err="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-refs-err.XXXXXX")" || return 1
  git -C "$repo" for-each-ref --sort=refname --format='%(refname)%09%(objectname)' refs/heads >"$output" 2>"$err"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    enumeration_error="$(<"$err")"
    rm -f "$err"
    printf '%s' "${enumeration_error:-git for-each-ref failed}"
    return 1
  fi
  rm -f "$err"
  return 0
}

initial_heads_snapshot="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-refs.XXXXXX")" || die_env "cannot create branch enumeration temp file"
enumeration_error="$(snapshot_local_heads "$initial_heads_snapshot")" || die_env "cannot enumerate local branches${enumeration_error:+: $enumeration_error}"
while IFS= read -r ref_line || [ -n "$ref_line" ]; do
  [[ "$ref_line" == *$'\t'* ]] || die_env "malformed local branch snapshot"
  full_ref="${ref_line%%$'\t'*}"
  ref_sha="${ref_line#*$'\t'}"
  [[ "$ref_sha" != *$'\t'* ]] || die_env "malformed local branch snapshot"
  case "$full_ref" in refs/heads/*) name="${full_ref#refs/heads/}" ;; *) die_env "non-local ref in branch snapshot: $full_ref" ;; esac
  [ -n "$name" ] && [ -n "$ref_sha" ] || die_env "malformed local branch snapshot"
  [ -z "${snapshot_tip[$name]:-}" ] || die_env "duplicate local branch in snapshot: $name"
  snapshot_tip["$name"]="$ref_sha"
  local_branch_names+=("$name")
done < "$initial_heads_snapshot"

into_sha="${snapshot_tip[$into_name]:-}"
[ -n "$into_sha" ] || die_env "integration target local branch does not resolve: $into_ref"
git -C "$repo" cat-file -e "${into_sha}^{commit}" 2>/dev/null || die_env "integration target local branch is not a commit: $into_ref"

if [ -n "$inventory_file" ]; then
  _wt_open_lock_fd "$common_dir/autopilot-worktree-budget.lock" \
    || die_env "cannot open exact lifecycle lock"
  exact_lifecycle_fd="$_WT_SAFE_LOCK_FD"
  flock -x "$exact_lifecycle_fd" \
    || die_env "cannot acquire exact lifecycle lock"
  export AUTOPILOT_LIFECYCLE_LOCK_FD="$exact_lifecycle_fd"
  inventory_file="$(realpath -e "$inventory_file" 2>/dev/null)" \
    || die_env "exact inventory file is not readable"
  [ -f "$inventory_file" ] && [ ! -L "$inventory_file" ] \
    || die_env "exact inventory must be a regular file"
  inventory_parse="$(mktemp "${TMPDIR:-/tmp}/autopilot-branch-inventory.XXXXXX")" \
    || die_env "cannot create exact inventory parse file"
  if ! node - "$inventory_file" > "$inventory_parse" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, "utf8"));
let repoIdentity;
let rootRunId;
let branches;
if (value && value.schema === 1
    && (Array.isArray(value.journal_branch_inventory) || Array.isArray(value.branch_inventory))
    && typeof value.git_common_dir === "string"
    && typeof value.root_run_id === "string") {
  repoIdentity = `git-common-dir:${fs.realpathSync(value.git_common_dir)}`;
  rootRunId = value.root_run_id;
  const source = Array.isArray(value.journal_branch_inventory)
    ? value.journal_branch_inventory : value.branch_inventory;
  branches = source.map((item) => ({
    name: item && item.branch,
    tip: item && item.tip,
  }));
} else {
  const keys = Object.keys(value || {}).sort().join(",");
  if (keys !== "branches,repo_identity,root_run_id,schema" || value.schema !== 1
      || typeof value.repo_identity !== "string"
      || typeof value.root_run_id !== "string"
      || !Array.isArray(value.branches)) process.exit(2);
  repoIdentity = value.repo_identity;
  rootRunId = value.root_run_id;
  branches = value.branches;
}
if (!/^[A-Za-z0-9._-]+$/.test(rootRunId)) process.exit(2);
const seen = new Set();
for (const item of branches) {
  if (!item || Object.keys(item).sort().join(",") !== "name,tip"
      || typeof item.name !== "string" || typeof item.tip !== "string"
      || !/^[0-9a-f]{40,64}$/.test(item.tip)
      || /[\u0000-\u001f\u007f]/.test(item.name)
      || seen.has(item.name)) process.exit(2);
  seen.add(item.name);
}
function canonicalize(input) {
  if (Array.isArray(input)) return input.map(canonicalize);
  if (!input || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]),
  );
}
const canonical = JSON.stringify(canonicalize({
  repo_identity: repoIdentity,
  root_run_id: rootRunId,
  branches: branches.map(({ name, tip }) => ({ name, tip })),
}));
const digest = crypto.createHash("sha256").update(canonical).digest("hex");
process.stdout.write(`META\t${repoIdentity}\t${rootRunId}\t${digest}\n`);
for (const item of branches) process.stdout.write(`BRANCH\t${item.name}\t${item.tip}\n`);
NODE
  then
    rm -f "$inventory_parse"
    die_env "exact inventory is malformed or contains duplicate entries"
  fi
  while IFS=$'\t' read -r record_kind field1 field2 field3; do
    case "$record_kind" in
      META)
        [ "$field1" = "$repo_identity" ] || {
          rm -f "$inventory_parse"
          die_env "exact inventory repository identity does not match --repo"
        }
        inventory_root_run_id="$field2"
        inventory_digest="$field3"
        ;;
      BRANCH)
        git check-ref-format --branch "$field1" >/dev/null 2>&1 || {
          rm -f "$inventory_parse"
          die_env "exact inventory contains an invalid branch: $field1"
        }
        [ "$field1" != "$into_name" ] || {
          rm -f "$inventory_parse"
          die_env "integration target cannot enter exact inventory"
        }
        inventory_expected["$field1"]="$field2"
        inventory_names+=("$field1")
        if [ "${snapshot_tip[$field1]:-}" != "$field2" ]; then
          if [ -z "${snapshot_tip[$field1]:-}" ] \
             && recover_reaped_inventory "$field1" "$field2"; then
            :
          else
            rm -f "$inventory_parse"
            die_env "exact inventory branch is missing or moved: $field1"
          fi
        fi
        ;;
      *) rm -f "$inventory_parse"; die_env "exact inventory parser returned malformed output" ;;
    esac
  done < "$inventory_parse"
  rm -f "$inventory_parse"
  [ -n "$inventory_root_run_id" ] && [ -n "$inventory_digest" ] \
    || die_env "exact inventory metadata is missing"
  journal_args=()
  canonical_args=()
  for inventory_name in "${inventory_names[@]}"; do
    journal_args+=("$inventory_name" "${inventory_expected[$inventory_name]}")
    if [ -z "${inventory_reaped_bundle[$inventory_name]:-}" ]; then
      canonical_args+=("$inventory_name" "${inventory_expected[$inventory_name]}")
    fi
  done
  canonical_inventory_scan="$(
    bash "$self_dir/reap-dispatch-worktrees.sh" scan \
      --repo "$repo" --root-run-id "$inventory_root_run_id"
  )" || die_env "cannot independently verify or migrate exact inventory"
  if ! node - "$common_dir/autopilot-worktree-branch-inventory" \
      "$common_dir/autopilot-worktree-lifecycle-roots" "$repo_identity" \
      "$inventory_root_run_id" "${journal_args[@]}" <<'NODE'
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const [directory, anchorDirectory, repoIdentity, rootRunId, ...pairs] =
  process.argv.slice(2);
if (pairs.length % 2 !== 0) process.exit(2);
if (!fs.existsSync(directory)) process.exit(2);
const directoryStat = fs.lstatSync(directory);
if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || directoryStat.uid !== process.getuid()
    || (directoryStat.mode & 0o777) !== 0o700) process.exit(2);
if (!fs.existsSync(anchorDirectory)) process.exit(2);
const anchorDirectoryStat = fs.lstatSync(anchorDirectory);
if (!anchorDirectoryStat.isDirectory() || anchorDirectoryStat.isSymbolicLink()
    || anchorDirectoryStat.uid !== process.getuid()
    || (anchorDirectoryStat.mode & 0o777) !== 0o700) process.exit(2);
const key = crypto.createHash("sha256")
  .update(`${repoIdentity}\0${rootRunId}\0`).digest("hex");
const anchor = path.join(anchorDirectory, `${key}.json`);
const sentinel = path.join(directory, `${key}.root.json`);
const registry = `${anchorDirectory}.registry.json`;
if (!fs.existsSync(registry)) process.exit(2);
const registryStat = fs.lstatSync(registry);
if (!registryStat.isFile() || registryStat.isSymbolicLink()
    || registryStat.uid !== process.getuid()
    || (registryStat.mode & 0o777) !== 0o600) process.exit(2);
const registryBytes = fs.readFileSync(registry, "utf8");
const registryValue = JSON.parse(registryBytes);
if (Object.keys(registryValue).sort().join(",") !== "repo_identity,roots,schema"
    || registryValue.schema !== 1 || registryValue.repo_identity !== repoIdentity
    || !registryValue.roots || typeof registryValue.roots !== "object"
    || Array.isArray(registryValue.roots)
    || !registryValue.roots[key] || registryValue.roots[key].state !== "active"
    || Object.entries(registryValue.roots).some(([rootKey, root]) =>
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
    || registryBytes !== `${JSON.stringify(registryValue)}\n`) process.exit(2);
function readBinding(file) {
  if (!fs.existsSync(file)) process.exit(2);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()
      || stat.uid !== process.getuid()
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
const anchorBinding = readBinding(anchor);
const sentinelBinding = readBinding(sentinel);
const journalStat = fs.lstatSync(directory, { bigint: true });
if (anchorBinding.value.repo_identity !== sentinelBinding.value.repo_identity
    || anchorBinding.value.root_run_id !== sentinelBinding.value.root_run_id
    || anchorBinding.value.journal_nonce !== sentinelBinding.value.journal_nonce
    || anchorBinding.value.journal_birthtime_ns
      !== sentinelBinding.value.journal_birthtime_ns
    || anchorBinding.value.journal_device !== sentinelBinding.value.journal_device
    || anchorBinding.value.journal_inode !== sentinelBinding.value.journal_inode
    || anchorBinding.value.journal_birthtime_ns !== journalStat.birthtimeNs.toString()
    || anchorBinding.value.journal_device !== journalStat.dev.toString()
    || anchorBinding.value.journal_inode !== journalStat.ino.toString()) process.exit(2);
const expected = new Map();
for (let index = 0; index < pairs.length; index += 2) {
  expected.set(pairs[index], pairs[index + 1]);
}
const journal = new Map();
const journalRecords = new Map();
for (const name of fs.readdirSync(directory).sort()) {
  if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) process.exit(2);
  const bytes = fs.readFileSync(file, "utf8");
  const value = JSON.parse(bytes);
  if (value.root_run_id !== rootRunId) continue;
  if (Object.keys(value).sort().join(",")
        !== "branch,captured_at,marker_sha256,path,root_run_id,schema,tip"
      || value.schema !== 1 || typeof value.branch !== "string"
      || /[\u0000-\u001f\u007f]/.test(value.branch)
      || typeof value.path !== "string" || !path.isAbsolute(value.path)
      || /\u0000/.test(value.path)
      || !/^[0-9a-f]{40,64}$/.test(value.tip)
      || !/^[0-9a-f]{64}$/.test(value.marker_sha256)
      || !Number.isSafeInteger(value.captured_at) || value.captured_at < 1
      || journal.has(value.branch)) process.exit(2);
  const expectedName = `${crypto.createHash("sha256")
    .update(`${rootRunId}\0${value.path}\0${value.branch}\0${value.tip}\0`)
    .digest("hex")}.json`;
  if (name !== expectedName) process.exit(2);
  journal.set(value.branch, value.tip);
  journalRecords.set(name, bytes);
}
const mirrorRecords = new Map();
const mirrorPattern = new RegExp(`^${key}\\.([0-9a-f]{64})\\.record\\.json$`);
for (const name of fs.readdirSync(anchorDirectory).sort()) {
  const match = name.match(mirrorPattern);
  if (!match) continue;
  const file = path.join(anchorDirectory, name);
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
const authorityRef = `refs/autopilot/lifecycle-roots/${key}`;
const authorityOid = spawnSync(
  "git", ["--git-dir", path.dirname(directory), "rev-parse", "--verify", authorityRef],
  { encoding: "utf8" },
);
if (authorityOid.status !== 0) process.exit(2);
const authorityBlob = spawnSync(
  "git", [
    "--git-dir", path.dirname(directory), "cat-file", "blob",
    authorityOid.stdout.trim(),
  ],
  { encoding: "utf8" },
);
if (authorityBlob.status !== 0) process.exit(2);
const authorityValue = JSON.parse(authorityBlob.stdout);
if (authorityValue.repo_identity !== repoIdentity
    || authorityValue.root_run_id !== rootRunId
    || authorityValue.journal_birthtime_ns
      !== anchorBinding.value.journal_birthtime_ns
    || authorityValue.journal_nonce !== anchorBinding.value.journal_nonce
    || authorityValue.journal_device !== anchorBinding.value.journal_device
    || authorityValue.journal_inode !== anchorBinding.value.journal_inode
    || !Number.isSafeInteger(authorityValue.generation)
    || !Array.isArray(authorityValue.journal_records)
    || registryValue.roots[key].generation !== authorityValue.generation
    || registryValue.roots[key].journal_records.join("\n")
      !== authorityValue.journal_records.join("\n")
    || anchorBinding.value.generation !== authorityValue.generation
    || anchorBinding.value.journal_records.join("\n")
      !== authorityValue.journal_records.join("\n")
    || authorityValue.journal_records.join("\n")
      !== commitments.join("\n")) process.exit(2);
for (const [branch, tip] of expected) {
  if (journal.get(branch) !== tip) process.exit(2);
}
NODE
  then
    die_env "exact inventory is not bound to the canonical branch inventory journal or current canonical lifecycle state"
  fi
  node - "$inventory_root_run_id" "$canonical_inventory_scan" \
    "${canonical_args[@]}" <<'NODE'
const rootRunId = process.argv[2];
const value = JSON.parse(process.argv[3]);
const pairs = process.argv.slice(4);
if (pairs.length % 2 !== 0) process.exit(2);
const expected = new Map();
for (let index = 0; index < pairs.length; index += 2) {
  expected.set(pairs[index], pairs[index + 1]);
}
if (value.root_run_id !== rootRunId
    || !Array.isArray(value.journal_branch_inventory)) process.exit(2);
const canonical = new Map();
for (const item of value.journal_branch_inventory) {
  if (!item || typeof item.branch !== "string" || typeof item.tip !== "string"
      || canonical.has(item.branch)) process.exit(2);
  canonical.set(item.branch, item.tip);
}
if (canonical.size !== expected.size) process.exit(2);
for (const [branch, tip] of expected) {
  if (canonical.get(branch) !== tip) process.exit(2);
}
NODE
  [ "$?" -eq 0 ] \
    || die_env "exact inventory does not match current canonical lifecycle state"
fi

for preserve_ack_spec in "${preserve_ack_specs[@]}"; do
  preserve_ack_name="${preserve_ack_spec%@*}"
  preserve_ack_tip="${preserve_ack_spec##*@}"
  [ "$preserve_ack_name" != "$preserve_ack_spec" ] \
    && [ -n "$preserve_ack_name" ] \
    && [[ "$preserve_ack_tip" =~ ^[0-9a-f]{40,64}$ ]] \
    || die_env "--ack-preserved requires exact branch@tip"
  [ "${inventory_expected[$preserve_ack_name]:-}" = "$preserve_ack_tip" ] \
    || die_env "--ack-preserved does not match exact inventory: $preserve_ack_name"
  [ -z "${inventory_preserve_ack[$preserve_ack_name]:-}" ] \
    || die_env "duplicate --ack-preserved entry: $preserve_ack_name"
  inventory_preserve_ack["$preserve_ack_name"]="$preserve_ack_tip"
done

for name in "${local_branch_names[@]}"; do
  [ -n "$name" ] || continue
  # Defense in depth: even a custom catch-all pattern cannot classify the
  # authoritative integration branch as dispatch-owned.
  [ "$name" = "$into_name" ] && continue
  matched=0
  if [ -n "$inventory_file" ]; then
    [ -n "${inventory_expected[$name]:-}" ] || continue
    family["$name"]="inventory"
    matched=1
  elif [[ "$name" =~ $candidate_re ]]; then
    family["$name"]="candidate"
    round["$name"]=$((10#${BASH_REMATCH[1]}))
    candidates+=("$name")
    matched=1
  elif [[ "$name" =~ $unit_re ]]; then
    family["$name"]="unit"
    matched=1
  elif [[ "$name" =~ $intermediate_re ]]; then
    family["$name"]="intermediate"
    matched=1
  else
    for pattern in "${extra_patterns[@]}"; do
      if [[ "$name" =~ $pattern ]]; then matched=1; family["$name"]="custom"; break; fi
    done
  fi
  [ "$matched" -eq 1 ] || continue

  branches+=("$name")
  tip["$name"]="${snapshot_tip[$name]}"
  ahead["$name"]="$(git -C "$repo" rev-list --count "$into_sha..${tip[$name]}" 2>/dev/null)" || die_env "cannot compare $name with $into_ref"
  contained_in["$name"]=""
  superseded_by["$name"]=""

  if { [ "${family[$name]}" = unit ] || [ "${family[$name]}" = intermediate ]; } && [[ "$name" =~ $round_key_re ]]; then
    sibling_key["$name"]="${BASH_REMATCH[1]}|${BASH_REMATCH[3]}"
    round["$name"]=$((10#${BASH_REMATCH[2]}))
  fi
done

# One canonical survivor per same-tip integration-candidate group.
for name in "${candidates[@]}"; do
  sha="${tip[$name]}"
  current="${canonical_for_tip[$sha]:-}"
  if [ -z "$current" ] || [ "${round[$name]}" -gt "${round[$current]}" ] \
     || { [ "${round[$name]}" -eq "${round[$current]}" ] && [[ "$name" > "$current" ]]; }; then
    canonical_for_tip["$sha"]="$name"
  fi
done
for name in "${candidates[@]}"; do
  [ "${canonical_for_tip[${tip[$name]}]}" = "$name" ] && canonical_candidates+=("$name")
done

# Only maximal candidates may prove containment; a reapable candidate never
# becomes the sole proof for deleting another branch.
for name in "${canonical_candidates[@]}"; do
  maximal=1
  for other in "${canonical_candidates[@]}"; do
    [ "$name" = "$other" ] && continue
    [ "${tip[$name]}" = "${tip[$other]}" ] && continue
    if git -C "$repo" merge-base --is-ancestor "${tip[$name]}" "${tip[$other]}" 2>/dev/null; then
      maximal=0
      break
    fi
  done
  if [ "$maximal" -eq 1 ]; then
    maximal_candidates+=("$name")
    is_maximal_candidate["$name"]=1
  fi
done

# Highest numeric round per opaque prefix+date sibling group.
for name in "${branches[@]}"; do
  key="${sibling_key[$name]:-}"
  [ -n "$key" ] || continue
  current="${highest_name[$key]:-}"
  if [ -z "$current" ] || [ "${round[$name]}" -gt "${highest_round[$key]}" ] \
     || { [ "${round[$name]}" -eq "${highest_round[$key]}" ] && [[ "$name" > "$current" ]]; }; then
    highest_round["$key"]="${round[$name]}"
    highest_name["$key"]="$name"
  fi
done

for name in "${branches[@]}"; do
  # The integration target is always the first containment proof.
  if git -C "$repo" merge-base --is-ancestor "${tip[$name]}" "$into_sha" 2>/dev/null; then
    contained_in["$name"]="$into"
  else
    for target in "${maximal_candidates[@]}"; do
      [ "$name" = "$target" ] && continue
      if git -C "$repo" merge-base --is-ancestor "${tip[$name]}" "${tip[$target]}" 2>/dev/null; then
        contained_in["$name"]="$target"
        break
      fi
    done
  fi

  if [ "${contained_in[$name]}" = "$into_name" ]; then
    partition["$name"]="reapable"
    reapable+=("$name")
  else
    key="${sibling_key[$name]:-}"
    if [ -n "$key" ] && [ "${round[$name]}" -lt "${highest_round[$key]}" ]; then
      superseded_by["$name"]="${highest_name[$key]}"
      partition["$name"]="superseded"
      superseded+=("$name")
    else
      partition["$name"]="kept"
      kept+=("$name")
    fi
  fi
  if [ "${family[$name]}" = candidate ] && [ "${ahead[$name]}" -gt 0 ]; then
    candidates_ahead+=("$name")
  fi
done

# Post-classification defense assertion (plan §4A): classification must be a
# total, disjoint partition and the integration target must be absent from every
# dispatch-owned set. Abort before emitting/deleting on any internal drift.
declare -A partition_seen=()
for bucket_name in "${reapable[@]}" "${superseded[@]}" "${kept[@]}"; do
  [ "$bucket_name" != "$into_name" ] || die_env "defense assertion: integration target entered dispatch partition"
  [ -z "${partition_seen[$bucket_name]:-}" ] || die_env "defense assertion: duplicate branch partition: $bucket_name"
  partition_seen["$bucket_name"]=1
done
[ "${#partition_seen[@]}" -eq "${#branches[@]}" ] || die_env "defense assertion: incomplete branch partition"
for name in "${branches[@]}"; do
  [ "$name" != "$into_name" ] || die_env "defense assertion: integration target classified as dispatch-owned"
  [ -n "${partition_seen[$name]:-}" ] || die_env "defense assertion: unpartitioned branch: $name"
done

emit_branch_object() {
  local name="$1" ci="null" sb="null"
  [ -n "${contained_in[$name]}" ] && ci="\"$(json_escape "${contained_in[$name]}")\""
  [ -n "${superseded_by[$name]}" ] && sb="\"$(json_escape "${superseded_by[$name]}")\""
  printf '{"name":"%s","family":"%s","tip":"%s","ahead":%s,"contained_in":%s,"superseded_by":%s}' \
    "$(json_escape "$name")" "${family[$name]}" "${tip[$name]}" "${ahead[$name]}" "$ci" "$sb"
}

emit_branch_array() {
  local first=1 name
  printf '['
  for name in "$@"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    emit_branch_object "$name"
  done
  printf ']'
}

emit_scan_json() {
  printf '{"branches":'; emit_branch_array "${branches[@]}"
  printf ',"candidates_ahead":'; emit_branch_array "${candidates_ahead[@]}"
  printf ',"reapable":'; emit_branch_array "${reapable[@]}"
  printf ',"superseded":'; emit_branch_array "${superseded[@]}"
  printf ',"kept":'; emit_branch_array "${kept[@]}"
  printf ',"repo_identity":"%s","root_run_id":' "$(json_escape "$repo_identity")"
  if [ -n "$inventory_root_run_id" ]; then
    printf '"%s"' "$(json_escape "$inventory_root_run_id")"
  else
    printf 'null'
  fi
  printf ',"inventory_digest":'
  if [ -n "$inventory_digest" ]; then
    printf '"%s"' "$inventory_digest"
  else
    printf 'null'
  fi
  printf '}\n'
}

if [ "$command_name" = scan ]; then
  emit_scan_json
  exit 0
fi

if [ "$command_name" = check ]; then
  ack_file="$common_dir/autopilot-reap-ack"
  ack_tmp="$(mktemp "$common_dir/autopilot-reap-ack.tmp.XXXXXX")" || die_env "cannot create ack rewrite"
  declare -A acknowledged=()
  if [ -e "$ack_file" ] && [ ! -f "$ack_file" ]; then
    rm -f "$ack_tmp"
    die_env "ack state is not a regular file"
  fi
  if [ -f "$ack_file" ]; then
    mapfile -t ack_lines < "$ack_file" || { rm -f "$ack_tmp"; die_env "cannot read complete ack state"; }
    for ack_line in "${ack_lines[@]}"; do
      saved_name=""; saved_sha=""; extra=""
      IFS=' ' read -r saved_name saved_sha extra <<< "$ack_line"
      if [ -z "${saved_name:-}" ] || [ -n "${extra:-}" ] || [[ ! "${saved_sha:-}" =~ ^[0-9a-f]{40}$ ]] \
         || [ "${snapshot_tip[${saved_name:-}]:-}" != "$saved_sha" ]; then
        printf 'WARN: dropped stale or malformed ack for %s\n' "${saved_name:-<empty>}" >&2
        continue
      fi
      acknowledged["$saved_name"]="$saved_sha"
      printf '%s %s\n' "$saved_name" "$saved_sha" >> "$ack_tmp" || { rm -f "$ack_tmp"; die_env "cannot rewrite ack state"; }
    done
  fi
  if [ -n "$ack_branch" ]; then
    [ "${family[$ack_branch]:-}" = candidate ] || { rm -f "$ack_tmp"; die_env "--ack branch is not a live integration candidate: $ack_branch"; }
    ack_tip="${tip[$ack_branch]}"
    if [ "${acknowledged[$ack_branch]:-}" != "$ack_tip" ]; then
      printf '%s %s\n' "$ack_branch" "$ack_tip" >> "$ack_tmp" || { rm -f "$ack_tmp"; die_env "cannot append ack state"; }
    fi
    acknowledged["$ack_branch"]="$ack_tip"
  fi

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_AFTER_ACK_WRITE:-}" ]; then
    "${AUTOPILOT_REAP_TEST_HOOK_AFTER_ACK_WRITE}" "$repo" "$ack_branch" || die_env "ack race test hook failed"
  fi

  # A successful check linearizes at check_heads_final: it is byte-identical to
  # the complete refs/heads snapshot used for classification, and remains
  # byte-identical after evaluation. Thus the snapshot contains the exact target
  # SHA and the complete dispatch-candidate name/tip set acknowledged below.
  check_heads_final="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-check-refs.XXXXXX")" || die_env "cannot create final branch snapshot"
  enumeration_error="$(snapshot_local_heads "$check_heads_final")" || die_env "cannot enumerate local branches during final check${enumeration_error:+: $enumeration_error}"
  cmp -s "$initial_heads_snapshot" "$check_heads_final" || die_env "local branch refs changed during check; retry from a fresh snapshot"

  gate=0
  for name in "${candidates[@]}"; do
    [ "${ahead[$name]}" -gt 0 ] || continue
    if [ "${acknowledged[$name]:-}" != "${tip[$name]}" ]; then gate=1; fi
  done

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_AFTER_CHECK_EVALUATION:-}" ]; then
    "${AUTOPILOT_REAP_TEST_HOOK_AFTER_CHECK_EVALUATION}" "$repo" || die_env "post-evaluation race test hook failed"
  fi
  check_heads_post_evaluation="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-check-refs.XXXXXX")" || die_env "cannot create post-evaluation branch snapshot"
  enumeration_error="$(snapshot_local_heads "$check_heads_post_evaluation")" || die_env "cannot enumerate local branches after check evaluation${enumeration_error:+: $enumeration_error}"
  cmp -s "$check_heads_final" "$check_heads_post_evaluation" || die_env "local branch refs changed during check evaluation; retry from a fresh snapshot"
  if [ -s "$ack_tmp" ]; then
    ack_expected_oid="$(git -C "$repo" hash-object "$ack_tmp" 2>/dev/null)" || die_env "cannot fingerprint pending ack state"
    mv -f "$ack_tmp" "$ack_file" || die_env "cannot atomically rewrite ack file"
    if [ ! -f "$ack_file" ] || [ -L "$ack_file" ]; then
      die_env "ack publication did not produce a regular file"
    fi
    ack_actual_oid="$(git -C "$repo" hash-object "$ack_file" 2>/dev/null)" || die_env "cannot verify published ack state"
    [ "$ack_actual_oid" = "$ack_expected_oid" ] || die_env "published ack state differs from the acknowledged snapshot"
  else
    rm -f "$ack_tmp" || die_env "cannot remove empty ack rewrite"
    ack_tmp=""
    rm -f "$ack_file" || die_env "cannot prune empty ack file"
  fi
  ack_tmp=""
  emit_scan_json
  exit "$gate"
fi

# reap
[ "$yes" -eq 1 ] || dry_run=1
declare -a eligible=()
eligible+=("${reapable[@]}")
# Preserve-first is global: --reap-superseded exposes/report supersession but
# never turns a branch uncontained by the authoritative integration target into
# an automatic deletion. Deliberate discard is a separate human/depth-0 act
# after preservation, outside this reaper.

emit_name_array() {
  local first=1 value
  printf '['
  for value in "$@"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '"%s"' "$(json_escape "$value")"
  done
  printf ']'
}

emit_reaped_objects() {
  local first=1 value
  printf '['
  for value in "$@"; do
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '{"branch":"%s","bundle":"%s"}' \
      "$(json_escape "$value")" "$(json_escape "${inventory_reaped_bundle[$value]}")"
  done
  printf ']'
}

persist_inventory_outcomes() {
  local mode="$1" inventory_name disposition acknowledged bundle_value candidate found
  [ "${#inventory_names[@]}" -ne 0 ] || return 0
  if [ -e "$disposition_dir" ] || [ -L "$disposition_dir" ]; then
    [ -d "$disposition_dir" ] && [ ! -L "$disposition_dir" ] && [ -O "$disposition_dir" ] \
      || return 1
  else
    (umask 077; mkdir "$disposition_dir") || return 1
  fi
  for inventory_name in "${inventory_names[@]}"; do
    disposition="preserved"
    acknowledged=false
    bundle_value=""
    found=0
    if [ -n "${inventory_reaped_bundle[$inventory_name]:-}" ]; then
      disposition="reaped"
      bundle_value="${inventory_reaped_bundle[$inventory_name]}"
      found=1
    elif [ "$mode" = "intent" ]; then
      for candidate in "${eligible[@]}"; do
        if [ "$candidate" = "$inventory_name" ]; then
          disposition="reaped"; bundle_value="$bundle"; found=1; break
        fi
      done
    elif [ "$mode" = "final" ]; then
      for candidate in "${reaped_names[@]}"; do
        if [ "$candidate" = "$inventory_name" ]; then
          disposition="reaped"; bundle_value="$bundle"; found=1; break
        fi
      done
      if [ "$found" -eq 0 ]; then
        for candidate in "${failure_names[@]}"; do
          if [ "$candidate" = "$inventory_name" ]; then
            disposition="failed"; found=1; break
          fi
        done
      fi
    elif [ "$mode" = "failed" ]; then
      for candidate in "${eligible[@]}"; do
        [ "$candidate" = "$inventory_name" ] && disposition="failed"
      done
    fi
    if [ "$disposition" = "preserved" ] \
       && [ "${inventory_preserve_ack[$inventory_name]:-}" = "${inventory_expected[$inventory_name]}" ]; then
      acknowledged=true
    fi
    disposition_key="$(
      printf '%s\0%s\0%s\0' "$inventory_root_run_id" "$inventory_name" \
        "${inventory_expected[$inventory_name]}" | sha256sum | awk '{print $1}'
    )"
    disposition_record="$disposition_dir/$disposition_key.json"
    disposition_tmp="$(mktemp "$disposition_dir/.disposition.XXXXXX")" || return 1
    if [ -n "$bundle_value" ]; then
      bundle_json="\"$(json_escape "$bundle_value")\""
    else
      bundle_json="null"
    fi
    printf \
      '{"schema":1,"repo_identity":"%s","root_run_id":"%s","branch":"%s","tip":"%s","disposition":"%s","bundle":%s,"acknowledged":%s,"inventory_digest":"%s","recorded_at":%s}\n' \
      "$(json_escape "$repo_identity")" "$(json_escape "$inventory_root_run_id")" \
      "$(json_escape "$inventory_name")" "${inventory_expected[$inventory_name]}" \
      "$disposition" "$bundle_json" "$acknowledged" "$inventory_digest" "$(date +%s)" \
      > "$disposition_tmp" || { rm -f "$disposition_tmp"; return 1; }
    chmod 600 "$disposition_tmp" || { rm -f "$disposition_tmp"; return 1; }
    mv -f "$disposition_tmp" "$disposition_record" \
      || { rm -f "$disposition_tmp"; return 1; }
  done
}

emit_exact_inventory_fields() {
  local failure_mode="${1:-0}" inventory_name disposition is_eligible candidate acknowledged
  printf ',"repo_identity":"%s","root_run_id":' "$(json_escape "$repo_identity")"
  if [ -n "$inventory_root_run_id" ]; then
    printf '"%s"' "$(json_escape "$inventory_root_run_id")"
  else
    printf 'null'
  fi
  printf ',"inventory_digest":'
  if [ -n "$inventory_digest" ]; then
    printf '"%s"' "$inventory_digest"
  else
    printf 'null'
  fi
  printf ',"inventory_dispositions":['
  local first_inventory=1
  for inventory_name in "${inventory_names[@]}"; do
    disposition="preserved"
    disposition_bundle="null"
    is_eligible=0
    for candidate in "${eligible[@]}"; do
      [ "$candidate" = "$inventory_name" ] && is_eligible=1
    done
    if [ -n "${inventory_reaped_bundle[$inventory_name]:-}" ]; then
      disposition="reaped"
      disposition_bundle="\"$(json_escape "${inventory_reaped_bundle[$inventory_name]}")\""
    elif [ "$failure_mode" -eq 1 ] && [ "$is_eligible" -eq 1 ]; then
      disposition="failed"
    fi
    acknowledged=false
    if [ "$disposition" = "preserved" ] \
       && [ "${inventory_preserve_ack[$inventory_name]:-}" = "${inventory_expected[$inventory_name]}" ]; then
      acknowledged=true
    fi
    [ "$first_inventory" -eq 1 ] || printf ','
    first_inventory=0
    printf '{"name":"%s","tip":"%s","disposition":"%s","bundle":%s,"acknowledged":%s}' \
      "$(json_escape "$inventory_name")" "${inventory_expected[$inventory_name]}" \
      "$disposition" "$disposition_bundle" "$acknowledged"
  done
  printf ']'
}

declare -a preserved_superseded=()
[ "$reap_superseded" -eq 1 ] && preserved_superseded+=("${superseded[@]}")

if [ "$dry_run" -eq 1 ]; then
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}" "${preserved_superseded[@]}"
  printf ',"failures":[],"dry_run":true'
  emit_exact_inventory_fields 0
  printf '}\n'
  exit 0
fi

if [ "${#eligible[@]}" -eq 0 ]; then
  persist_inventory_outcomes preserved \
    || die_env "cannot persist exact branch disposition"
  printf '{"reaped":'; emit_reaped_objects "${recovered_reaped_names[@]}"
  printf ',"kept":'; emit_name_array "${preserved_superseded[@]}"
  printf ',"failures":[],"dry_run":false'
  emit_exact_inventory_fields 0
  printf '}\n'
  exit 0
fi

# Enumerate branch-local config once, before any deletion. Exit 1 means no
# matching keys; every other nonzero status is an environment failure and must
# not be collapsed into "no config".
config_list="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-config.XXXXXX")" || die_env "cannot create config enumeration temp file"
config_err="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-config-err.XXXXXX")" || { rm -f "$config_list"; die_env "cannot create config enumeration error file"; }
git -C "$repo" config --local --name-only --get-regexp '^branch\.' >"$config_list" 2>"$config_err"
config_rc=$?
if [ "$config_rc" -ne 0 ] && [ "$config_rc" -ne 1 ]; then
  config_error="$(<"$config_err")"
  rm -f "$config_list" "$config_err"
  persist_inventory_outcomes failed \
    || die_env "cannot persist failed exact branch disposition"
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}" "${preserved_superseded[@]}"
  printf ',"failures":[{"branch":null,"stage":"config-query","error":"%s"}],"dry_run":false' \
    "$(json_escape "${config_error:-cannot enumerate local branch config}")"
  emit_exact_inventory_fields 1
  printf '}\n'
  exit 1
fi
rm -f "$config_err"
mapfile -t branch_config_keys < "$config_list" || { rm -f "$config_list"; die_env "cannot read complete branch config enumeration"; }
rm -f "$config_list"

declare -a refs=()
bundle_error=""
for name in "${eligible[@]}"; do
  if [[ ! "${tip[$name]}" =~ ^[0-9a-f]{40,64}$ ]]; then
    bundle_error="invalid recorded tip for $name"
    break
  fi
  refs+=("refs/heads/$name")
done
if [ -n "$bundle_error" ]; then
  persist_inventory_outcomes failed \
    || die_env "cannot persist failed exact branch disposition"
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}" "${preserved_superseded[@]}"
  printf ',"failures":[{"branch":null,"stage":"bundle","error":"%s"}],"dry_run":false' "$(json_escape "$bundle_error")"
  emit_exact_inventory_fields 1
  printf '}\n'
  exit 1
fi

if [ -z "$bundle_dir" ]; then
  bundle_dir="$common_dir/autopilot-reap-bundles/$(date -u +%Y-%m-%d)"
elif [[ "$bundle_dir" != /* ]]; then
  bundle_dir="$repo/$bundle_dir"
fi
mkdir -p "$bundle_dir" 2>/dev/null || {
  persist_inventory_outcomes failed \
    || die_env "cannot persist failed exact branch disposition"
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}" "${preserved_superseded[@]}"
  printf ',"failures":[{"branch":null,"stage":"bundle-create","error":"%s"}],"dry_run":false' "$(json_escape "cannot create bundle directory: $bundle_dir")"
  emit_exact_inventory_fields 1
  printf '}\n'
  exit 1
}
bundle="$bundle_dir/reap-$(date -u +%Y%m%dT%H%M%SZ)-$$.bundle"

git -C "$repo" bundle create "$bundle" "${refs[@]}" >/dev/null 2>"$bundle.tmp.err" || bundle_error="$(<"$bundle.tmp.err")"
rm -f "$bundle.tmp.err"
if [ -z "$bundle_error" ]; then
  git -C "$repo" bundle verify "$bundle" >/dev/null 2>"$bundle.tmp.err" || bundle_error="$(<"$bundle.tmp.err")"
  rm -f "$bundle.tmp.err"
fi
if [ -z "$bundle_error" ]; then
  heads="$(git -C "$repo" bundle list-heads "$bundle" 2>"$bundle.tmp.err")" || bundle_error="$(<"$bundle.tmp.err")"
  rm -f "$bundle.tmp.err"
  if [ -z "$bundle_error" ]; then
    for name in "${eligible[@]}"; do
      found=0
      while IFS=' ' read -r listed_sha listed_ref; do
        if [ "$listed_sha" = "${tip[$name]}" ] && [ "$listed_ref" = "refs/heads/$name" ]; then found=1; break; fi
      done <<< "$heads"
      [ "$found" -eq 1 ] || { bundle_error="bundle list-heads missing refs/heads/$name at ${tip[$name]}"; break; }
    done
  fi
fi
if [ -n "$bundle_error" ]; then
  persist_inventory_outcomes failed \
    || die_env "cannot persist failed exact branch disposition"
  printf '{"reaped":[],"kept":'; emit_name_array "${eligible[@]}" "${preserved_superseded[@]}"
  printf ',"failures":[{"branch":null,"stage":"bundle","error":"%s"}],"dry_run":false' "$(json_escape "$bundle_error")"
  emit_exact_inventory_fields 1
  printf '}\n'
  exit 1
fi

persist_inventory_outcomes intent \
  || die_env "cannot persist write-ahead exact branch disposition"

declare -a reaped_names=("${recovered_reaped_names[@]}") kept_names=("${preserved_superseded[@]}") failure_names=() failure_stages=() failure_errors=()

record_failure() {
  kept_names+=("$1")
  failure_names+=("$1")
  failure_stages+=("$2")
  failure_errors+=("$3")
}

# probe_checked_out <branch>: 0=clear, 1=checked out, 2=enumeration failure.
# Process substitution is deliberately forbidden here: its producer status is
# otherwise lost and a partial worktree list would become a fail-open delete.
probe_checked_out() {
  local branch="$1" list_file err_file rc line current_path=""
  checked_path=""
  worktree_probe_error=""
  list_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-worktrees.XXXXXX")" || { worktree_probe_error="cannot create worktree enumeration temp file"; return 2; }
  err_file="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-worktrees-err.XXXXXX")" || { rm -f "$list_file"; worktree_probe_error="cannot create worktree enumeration error file"; return 2; }
  git -C "$repo" worktree list --porcelain >"$list_file" 2>"$err_file"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    worktree_probe_error="$(<"$err_file")"
    [ -n "$worktree_probe_error" ] || worktree_probe_error="git worktree list failed"
    rm -f "$list_file" "$err_file"
    return 2
  fi
  rm -f "$err_file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      worktree\ *) current_path="${line#worktree }" ;;
      "branch refs/heads/$branch") checked_path="$current_path"; rm -f "$list_file"; return 1 ;;
    esac
  done < "$list_file"
  rc=$?
  rm -f "$list_file"
  [ "$rc" -eq 0 ] || { worktree_probe_error="cannot read complete worktree enumeration"; return 2; }
  return 0
}

# validate_delete_proof <branch>: exact ref, current target containment, and
# checked-out occupancy are all re-read immediately before CAS.
validate_delete_proof() {
  local branch="$1" expected="$2" current current_target merge_rc probe_rc
  validation_stage="compare-delete"
  validation_error="tip moved or local branch disappeared before deletion"
  current="$(git -C "$repo" rev-parse --verify "refs/heads/$branch" 2>/dev/null)" || return 1
  [ "$current" = "$expected" ] || return 1
  current_target="$(git -C "$repo" rev-parse --verify "${into_ref}^{commit}" 2>/dev/null)" || {
    validation_stage="containment-recheck"; validation_error="integration target disappeared before deletion"; return 1;
  }
  git -C "$repo" merge-base --is-ancestor "$expected" "$current_target" 2>/dev/null
  merge_rc=$?
  if [ "$merge_rc" -ne 0 ]; then
    validation_stage="containment-recheck"
    if [ "$merge_rc" -eq 1 ]; then validation_error="branch is no longer contained by $into_ref"; else validation_error="cannot revalidate containment against $into_ref"; fi
    return 1
  fi
  probe_checked_out "$branch"
  probe_rc=$?
  if [ "$probe_rc" -eq 1 ]; then
    validation_stage="checked-out"; validation_error="checked out at $checked_path"; return 1
  fi
  if [ "$probe_rc" -eq 2 ]; then
    validation_stage="worktree-list"; validation_error="$worktree_probe_error"; return 1
  fi
  return 0
}

restore_deleted_ref() {
  local branch="$1" expected="$2" ref="refs/heads/$1" current=""
  local tx_dir tx_in tx_out tx_err tx_pid response action="" wait_rc=1
  local in_open=0 out_open=0 protocol_ok=1
  local zero_oid
  printf -v zero_oid '%*s' "${#expected}" ''
  zero_oid="${zero_oid// /0}"
  tx_dir="$(mktemp -d "${TMPDIR:-/tmp}/autopilot-reap-restore.XXXXXX")" || return 1
  tx_in="$tx_dir/in"; tx_out="$tx_dir/out"; tx_err="$tx_dir/err"
  if ! mkfifo "$tx_in" "$tx_out"; then rm -rf "$tx_dir"; return 1; fi

  git -C "$repo" update-ref --stdin <"$tx_in" >"$tx_out" 2>"$tx_err" &
  tx_pid=$!
  if exec 7>"$tx_in"; then in_open=1; else protocol_ok=0; fi
  if [ "$protocol_ok" -eq 1 ]; then
    if exec 8<"$tx_out"; then out_open=1; else protocol_ok=0; fi
  fi
  if [ "$protocol_ok" -eq 1 ] && ! printf 'start\noption no-deref\nupdate %s %s %s\nprepare\n' \
      "$ref" "$expected" "$zero_oid" >&7; then
    protocol_ok=0
  fi
  if [ "$protocol_ok" -eq 1 ]; then
    IFS= read -r -t 10 response <&8 || protocol_ok=0
    [ "$response" = 'start: ok' ] || protocol_ok=0
  fi
  if [ "$protocol_ok" -eq 1 ]; then
    IFS= read -r -t 10 response <&8 || protocol_ok=0
    [ "$response" = 'prepare: ok' ] || protocol_ok=0
  fi
  if [ "$protocol_ok" -eq 1 ]; then
    # prepare holds the ref lock. Inspect the raw ref while that lock is held;
    # a raced symref is foreign state and must be preserved, never overwritten.
    if git -C "$repo" symbolic-ref -q "$ref" >/dev/null 2>&1; then action=abort; else action=commit; fi
    printf '%s\n' "$action" >&7 || protocol_ok=0
  fi
  if [ "$protocol_ok" -eq 1 ]; then
    IFS= read -r -t 10 response <&8 || protocol_ok=0
    [ "$response" = "$action: ok" ] || protocol_ok=0
  fi

  [ "$in_open" -eq 0 ] || exec 7>&-
  [ "$out_open" -eq 0 ] || exec 8<&-
  if [ "$protocol_ok" -ne 1 ]; then kill "$tx_pid" >/dev/null 2>&1 || true; fi
  wait "$tx_pid" >/dev/null 2>&1; wait_rc=$?
  rm -rf "$tx_dir"
  [ "$protocol_ok" -eq 1 ] && [ "$action" = commit ] && [ "$wait_rc" -eq 0 ] || return 1
  git -C "$repo" symbolic-ref -q "$ref" >/dev/null 2>&1 && return 1
  current="$(git -C "$repo" rev-parse --verify "$ref" 2>/dev/null)" || return 1
  [ "$current" = "$expected" ]
}

# Anchor receipt-referenced commits before any ref disappears.
#
# Preserve-first already bundled these branches, but a bundle is an OFFLINE file:
# it does not keep the objects reachable inside this repo. Mission receipts under
# $GIT_COMMON_DIR/autopilot/ bind their evidence to commit SHAs, and git cannot see
# those references — they are JSON, not refs. So deleting the last ref to such a
# commit starts a gc countdown on the evidence itself. That is not theoretical:
# four receipt-anchored commits in this repo were already destroyed that way
# (receipts present, objects absent) before this namespace existed.
#
# Reachability MUST be computed against the refs that will survive. A commit held
# solely by a branch we are about to delete still looks reachable right now, so
# without naming those refs the anchor step would skip exactly the commits it
# exists to protect and orphan them milliseconds later.
#
# Fail-closed on purpose, including when the anchor script is missing. Preserve-
# first is non-waivable here, and a pin that silently did not happen is exactly
# the failure mode this guards against — the loss only becomes visible at the next
# gc, long after the reap reported success.
anchor_script="$self_dir/pin-evidence-anchors.js"
[ -f "$anchor_script" ] || die_env "pin-evidence-anchors.js is missing; refusing to delete branch refs"
anchor_args=(apply --repo-root "$repo")
for name in "${eligible[@]}"; do
  anchor_args+=(--exclude-ref "refs/heads/$name")
done
if ! node "$anchor_script" "${anchor_args[@]}" >/dev/null; then
  die_env "cannot anchor receipt-referenced commits; refusing to delete branch refs"
fi

for name in "${eligible[@]}"; do
  expected_tip="${tip[$name]}"
  if ! validate_delete_proof "$name" "$expected_tip"; then
    record_failure "$name" "$validation_stage" "$validation_error"
    continue
  fi

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_BEFORE_DELETE:-}" ]; then
    if ! "${AUTOPILOT_REAP_TEST_HOOK_BEFORE_DELETE}" "$repo" "$name"; then
      record_failure "$name" "pre-delete-hook" "pre-delete test hook failed"
      continue
    fi
  fi

  # Revalidate again after the race seam and immediately before the exact-tip
  # update-ref CAS. Git has no transaction spanning refs + worktree metadata;
  # the paired post-CAS check below closes the observable window and restores.
  if ! validate_delete_proof "$name" "$expected_tip"; then
    record_failure "$name" "$validation_stage" "$validation_error"
    continue
  fi

  delete_err="$(mktemp "${TMPDIR:-/tmp}/autopilot-reap-delete-err.XXXXXX")" || { record_failure "$name" "compare-delete" "cannot create ref deletion error file"; continue; }
  if ! git -C "$repo" update-ref --no-deref -d "refs/heads/$name" "$expected_tip" 2>"$delete_err"; then
    delete_error="$(<"$delete_err")"; rm -f "$delete_err"
    record_failure "$name" "compare-delete" "${delete_error:-tip moved or ref deletion failed}"
    continue
  fi
  rm -f "$delete_err"

  if [ -n "${AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE:-}" ]; then
    if ! "${AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE}" "$repo" "$name"; then
      if restore_deleted_ref "$name" "$expected_tip"; then
        record_failure "$name" "post-delete-race" "post-delete test hook failed; exact ref restored"
      else
        record_failure "$name" "restore-failed" "post-delete test hook failed; exact ref restoration failed (verified bundle retains tip)"
      fi
      continue
    fi
  fi

  post_invalid=0
  post_error=""
  probe_checked_out "$name"
  probe_rc=$?
  if [ "$probe_rc" -eq 1 ]; then post_invalid=1; post_error="branch became checked out at $checked_path"; fi
  if [ "$probe_rc" -eq 2 ]; then post_invalid=1; post_error="post-delete worktree enumeration failed: $worktree_probe_error"; fi
  post_target="$(git -C "$repo" rev-parse --verify "${into_ref}^{commit}" 2>/dev/null)" || { post_invalid=1; post_error="integration target disappeared after deletion"; }
  if [ -n "${post_target:-}" ]; then
    git -C "$repo" merge-base --is-ancestor "$expected_tip" "$post_target" 2>/dev/null || { post_invalid=1; post_error="containment proof invalidated after deletion"; }
  fi
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$name" \
     || git -C "$repo" symbolic-ref -q "refs/heads/$name" >/dev/null 2>&1; then
    post_invalid=1
    post_error="branch ref was concurrently recreated after deletion"
  fi
  if [ "$post_invalid" -eq 1 ]; then
    if restore_deleted_ref "$name" "$expected_tip"; then
      record_failure "$name" "post-delete-race" "$post_error; exact ref restored"
    else
      record_failure "$name" "restore-failed" "$post_error; exact ref restoration failed (verified bundle retains the tip)"
    fi
    continue
  fi

  reaped_names+=("$name")
  inventory_reaped_bundle["$name"]="$bundle"
  config_present=0
  for config_key in "${branch_config_keys[@]}"; do
    case "$config_key" in "branch.$name."*) config_present=1; break ;; esac
  done
  if [ "$config_present" -eq 1 ] && ! git -C "$repo" config --local --remove-section "branch.$name" >/dev/null 2>&1; then
    failure_names+=("$name"); failure_stages+=("config-cleanup"); failure_errors+=("branch ref deleted and bundled, but local config cleanup failed")
  fi
done

persist_inventory_outcomes final \
  || die_env "cannot persist exact branch disposition"

printf '{"reaped":['
first=1
for name in "${reaped_names[@]}"; do
  [ "$first" -eq 1 ] || printf ','; first=0
  printf '{"branch":"%s","bundle":"%s"}' \
    "$(json_escape "$name")" "$(json_escape "${inventory_reaped_bundle[$name]}")"
done
printf '],"kept":'; emit_name_array "${kept_names[@]}"
printf ',"failures":['
for ((i=0; i<${#failure_names[@]}; i++)); do
  [ "$i" -eq 0 ] || printf ','
  printf '{"branch":"%s","stage":"%s","error":"%s"}' \
    "$(json_escape "${failure_names[$i]}")" "${failure_stages[$i]}" "$(json_escape "${failure_errors[$i]}")"
done
printf '],"dry_run":false'
printf ',"repo_identity":"%s","root_run_id":' "$(json_escape "$repo_identity")"
if [ -n "$inventory_root_run_id" ]; then
  printf '"%s"' "$(json_escape "$inventory_root_run_id")"
else
  printf 'null'
fi
printf ',"inventory_digest":'
if [ -n "$inventory_digest" ]; then
  printf '"%s"' "$inventory_digest"
else
  printf 'null'
fi
printf ',"inventory_dispositions":['
first=1
for inventory_name in "${inventory_names[@]}"; do
  disposition="preserved"
  disposition_bundle="null"
  disposition_acknowledged=false
  for reaped_name in "${reaped_names[@]}"; do
    if [ "$reaped_name" = "$inventory_name" ]; then
      disposition="reaped"
      disposition_bundle="\"$(json_escape "${inventory_reaped_bundle[$inventory_name]}")\""
      break
    fi
  done
  for ((i=0; i<${#failure_names[@]}; i++)); do
    if [ "${failure_names[$i]}" = "$inventory_name" ]; then
      disposition="failed"
      disposition_bundle="null"
      break
    fi
  done
  if [ "$disposition" = "preserved" ] \
     && [ "${inventory_preserve_ack[$inventory_name]:-}" = "${inventory_expected[$inventory_name]}" ]; then
    disposition_acknowledged=true
  fi
  [ "$first" -eq 1 ] || printf ','
  first=0
  printf '{"name":"%s","tip":"%s","disposition":"%s","bundle":%s,"acknowledged":%s}' \
    "$(json_escape "$inventory_name")" "${inventory_expected[$inventory_name]}" \
    "$disposition" "$disposition_bundle" "$disposition_acknowledged"
done
printf ']}\n'
[ "${#failure_names[@]}" -eq 0 ]
