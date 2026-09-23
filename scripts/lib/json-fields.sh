# shellcheck shell=bash
# json-fields.sh — read several fields of one JSON document with ONE node process.
# No side effects at source time; functions only. Double-source is a no-op.
#
# Why: a node start costs ~20 ms. Reading N fields as N `$(node -e '…argv[1]).field…')` calls
# pays that N times; resolve-review-loop.sh did it for up to 18 fields per run, and the review
# loop resolves on every dispatch.
#
# json_fields <array-name> <json> <path>...
#   Fills the named array with one element per <path>, in order. A <path> is a dot-separated key
#   chain ("engine", "s0.runner"). Each element is exactly what
#     "$(node -e 'process.stdout.write(String(<value> || ""))' …)"
#   would have produced: falsy ⇒ "", non-string ⇒ String(v), trailing newlines stripped (as
#   command substitution does). A path ending in ":json" yields `v ? JSON.stringify(v) : ""`
#   instead. Unparseable JSON, a missing key, or a node failure ⇒ "" for every affected path —
#   never an error, matching the one-call-per-field code it replaces.

[ -n "${_AUTOPILOT_JSON_FIELDS_SH:-}" ] && return 0
_AUTOPILOT_JSON_FIELDS_SH=1

json_fields() {
  local __jf_name="$1" __jf_json="$2"
  shift 2
  local -a __jf_out=()
  mapfile -d '' -t __jf_out < <(node -e '
let doc;
try { doc = JSON.parse(process.argv[1]); } catch { doc = undefined; }
for (const p of process.argv.slice(2)) {
  const asJson = p.endsWith(":json");
  let v = doc;
  try { for (const k of (asJson ? p.slice(0, -5) : p).split(".")) v = v[k]; } catch { v = undefined; }
  let s;
  try { s = asJson ? (v ? JSON.stringify(v) : "") : String(v || ""); } catch { s = ""; }
  process.stdout.write(s.replace(/\n+$/, "") + "\0");
}' "$__jf_json" "$@" 2>/dev/null)
  # A node that never started leaves fewer elements than paths; pad so every slot exists.
  while [ "${#__jf_out[@]}" -lt "$#" ]; do __jf_out+=(""); done
  local -n __jf_ref="$__jf_name"
  __jf_ref=("${__jf_out[@]}")
}
