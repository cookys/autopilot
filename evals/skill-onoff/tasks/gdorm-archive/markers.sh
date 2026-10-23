#!/usr/bin/env bash
# gdorm-archive — r_archive_import from a Bash import, r_archive_file from the archive dir.
set -u
. "${ONOFF_LIB:-$(cd "$(dirname "$0")/../../lib-gdorm" && pwd)}/gdorm-markers.sh"
gdorm_archive_markers
