#!/usr/bin/env bash
# markers (g67 eval) — see lib/g67-markers.sh. Reads tool-call commands from the transcript, never the agent prose.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/g67-markers.sh"
g67_markers g7-close
