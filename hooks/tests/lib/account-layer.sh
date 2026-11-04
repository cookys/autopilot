# hooks/tests/lib/account-layer.sh -- sourced: cp_account_layer <scripts dir of the layout>
# Copies the account layer (claude-account.js + its relative-require closure + eval-account helpers) into a
# throwaway layout from the single declared list account-layer.list. Needs REPO_ROOT (lib.sh sets it).
cp_account_layer() {
  local dest="$1" list rel
  list="$(dirname "${BASH_SOURCE[0]}")/account-layer.list"
  while IFS= read -r rel; do
    case "$rel" in ''|'#'*) continue ;; esac
    mkdir -p "$dest/$(dirname "$rel")"; cp "$REPO_ROOT/scripts/$rel" "$dest/$rel"
  done < "$list"
}
