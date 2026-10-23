#!/usr/bin/env bash
# bpack-revoked — b_revoked_prefix (review.txt names F1 with a REVOKED: claim) and b_normalizes (real normalizer).
set -u
. "${ONOFF_LIB:-$(cd "$(dirname "$0")/../../lib-bpack" && pwd)}/bpack-markers.sh"
bpack_revoked_markers
