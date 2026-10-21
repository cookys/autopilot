#!/usr/bin/env bash
# lib-dcard/dcard-markers.sh — dcard task markers via the same ONOFF_LIB_OVERRIDE dir as a2.
# The implementation stays in lib/dcard-markers.sh (the file the task sources when the override is unset).
_dcard_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$_dcard_lib_dir/../lib/dcard-markers.sh"
