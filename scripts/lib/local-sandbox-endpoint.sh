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
