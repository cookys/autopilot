# local_sandbox_endpoint_listed <name>
# One list: scripts/lib/local-sandbox-endpoints.json (PM 01M748P8G8).
# Exit 0 = listed, 1 = not listed, 2 = registry unreadable or malformed.
# The name is the predicate, compared case-insensitively. resolve-endpoint.sh
# uppercases the name into AUTOPILOT_ENDPOINT_<NAME>_*, so QWEN_LOCAL and
# qwen_local are one seat. transport_security is the usage-ledger account alias
# and is not consulted here, so this does not read endpoints.env.
local_sandbox_endpoint_listed() {
  local _here
  _here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const name = String(process.argv[2] == null ? "" : process.argv[2]).toLowerCase();
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { process.exit(2); }
    const list = doc && doc.local_sandbox_endpoints;
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string" || x.length === 0)) process.exit(2);
    process.exit(list.some((x) => x.toLowerCase() === name) ? 0 : 1);
  ' "$_here/local-sandbox-endpoints.json" "$1"
}

# local_sandbox_worktree_parent
# One per-uid directory, mode 0700, owned by this user. Prints the path.
# The implementation is scripts/lib/local-sandbox-parent.js (also required by
# the engine): realpath the temp dir, walk that real path for .git, one lstat
# after mkdir. A relative temp dir, a realpath error, or a .git ancestor uses
# /tmp. Non-zero from node refuses the dispatch. Does not remove the directory:
# dispatch-hetero removes the child worktree, and a later call reuses this parent.
local_sandbox_worktree_parent() {
  local _here raw out
  _here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # The suffix is the registered residue prefix. Node receives its directory.
  raw="${TMPDIR:-/tmp}/autopilot-local-sbx-$(id -u)"
  out="$(node "$_here/local-sandbox-parent.js" "$(dirname "$raw")")" || return 1
  printf '%s\n' "$out"
}
