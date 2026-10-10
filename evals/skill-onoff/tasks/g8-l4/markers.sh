#!/usr/bin/env bash
# markers (g8 eval) — see lib/g8-markers.sh. Reads tool-call commands from the transcript, never the agent prose.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/g8-markers.sh"
g8_markers g8-l4
