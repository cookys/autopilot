#!/usr/bin/env bash
# bpack-tree — t_tree_run from a Bash call that executes scripts/dispatch-tree.js.
set -u
. "${ONOFF_LIB:-$(cd "$(dirname "$0")/../../lib-bpack" && pwd)}/bpack-markers.sh"
bpack_tree_markers
