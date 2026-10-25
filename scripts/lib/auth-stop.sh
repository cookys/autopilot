#!/usr/bin/env bash
# auth-stop.sh -- shell front of scripts/lib/auth-stop.js (BL-0294): source it, then after every paid call
#   auth_stop_check <id> (--failed 0|1 | --failed-from F | --failed-from-json F | --failed-from-stream F)...
#                        [--stderr F | --log F | --dispatch F | --text S]...  || <clean up>; exit 6
# The failure signal of the call is mandatory (text phrases only count for a failed call; see auth-stop.js).
# returns 0 = no authentication failure, 6 = authentication failure (the line "STOP_AUTH after <id>: ..."
# is already on stderr), 2 = usage. See auth-stop.js for what counts as an authentication failure.
_AUTH_STOP_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auth-stop.js"
AUTH_STOP_EXIT=6
auth_stop_check() {
  local id="$1"; shift
  node "$_AUTH_STOP_JS" check --id "$id" "$@" < /dev/null
}
