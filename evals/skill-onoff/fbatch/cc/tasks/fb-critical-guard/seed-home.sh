#!/usr/bin/env bash
# Runs before the agent starts, with the scratch HOME as $1: the cell TMPDIR and the HOME name list (see _lib/fixture.sh).
set -eu
. "$(dirname "$0")/../_lib/fixture.sh"
fb_seed_home "$1"
