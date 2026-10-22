#!/usr/bin/env bash
# gdorm-tree — t_tree_run from a Bash call of scripts/tree.js, or a tree event file.
set -u
. "${ONOFF_LIB:-$(cd "$(dirname "$0")/../../lib-gdorm" && pwd)}/gdorm-markers.sh"
gdorm_tree_markers
