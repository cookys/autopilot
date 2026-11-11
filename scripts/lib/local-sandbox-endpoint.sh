# local_sandbox_endpoint_listed <name>
# One list: scripts/lib/local-sandbox-endpoints.json (PM 01M748P8G8).
# Exit 0 = listed, 1 = not listed, 2 = registry unreadable or malformed.
# The name is the predicate. transport_security is the usage-ledger account alias
# and is not consulted here, so this does not read endpoints.env.
local_sandbox_endpoint_listed() {
  local _here
  _here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const name = process.argv[2];
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { process.exit(2); }
    const list = doc && doc.local_sandbox_endpoints;
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string" || x.length === 0)) process.exit(2);
    process.exit(list.indexOf(name) >= 0 ? 0 : 1);
  ' "$_here/local-sandbox-endpoints.json" "$1"
}

# local_sandbox_worktree_parent
# One per-uid directory, mode 0700, owned by this user. Prints the path.
# Base is ${TMPDIR:-/tmp} only when neither it nor any ancestor holds a .git;
# otherwise /tmp. Does not remove the directory: dispatch-hetero removes the
# child worktree, and a later call reuses this parent.
_local_sandbox_ensure_parent() {
  local dir="$1" mode
  if [ -e "$dir" ] || [ -L "$dir" ]; then
    [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ] || return 1
  else
    { (umask 077; mkdir "$dir" 2>/dev/null) || [ -d "$dir" ]; } && [ ! -L "$dir" ] && [ -O "$dir" ] || return 1
  fi
  mode="$(stat -c '%a' "$dir" 2>/dev/null || stat -f '%Lp' "$dir" 2>/dev/null)" || return 1
  case "$mode" in 700|0700) ;; *) return 1 ;; esac
}

local_sandbox_worktree_parent() {
  local uid candidate base d
  uid="$(id -u)"
  candidate="${TMPDIR:-/tmp}/autopilot-local-sbx-${uid}"
  base="$(dirname "$candidate")"
  d="$base"
  while [ -n "$d" ]; do
    if [ -e "$d/.git" ]; then
      candidate="/tmp/autopilot-local-sbx-${uid}"
      break
    fi
    [ "$d" = "/" ] && break
    d="$(dirname "$d")"
  done
  _local_sandbox_ensure_parent "$candidate" || return 1
  printf '%s\n' "$candidate"
}
