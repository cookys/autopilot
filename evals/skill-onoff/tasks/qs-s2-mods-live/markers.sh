#!/usr/bin/env bash
# markers (qs eval) — see lib/qs-markers.sh. Reads the suite run log and gate-verdict.md, never agent prose beyond the verdict's first word.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/qs-markers.sh"
qs_markers qs-s2-mods-live
