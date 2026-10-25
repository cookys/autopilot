#!/usr/bin/env bash
# auth-stop.sh -- shell front of scripts/lib/auth-stop.js (BL-0294): source it, then after every paid call
#   auth_stop_check <id> [--stderr FILE | --log FILE | --text STR]...  || <clean up>; exit 6
# returns 0 = no authentication failure, 6 = authentication failure (the line "STOP_AUTH after <id>: ..."
# is already on stderr), 2 = usage. See auth-stop.js for what counts as an authentication failure.
_AUTH_STOP_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auth-stop.js"
AUTH_STOP_EXIT=6
auth_stop_check() {
  local id="$1"; shift
  node "$_AUTH_STOP_JS" check --id "$id" "$@" < /dev/null
}
