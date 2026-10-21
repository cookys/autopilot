#!/usr/bin/env bash
# lib-dcard-v3/p1w-markers.sh — one ONOFF_LIB_OVERRIDE dir for the dcard-v3 campaign.
# a2-within-doa sources p1w-markers.sh from ONOFF_LIB. This file is the lib-r2 amendment
# (live-dir plus git-common-dir decision search) and does not edit lib/ or lib-r2/.
_p1w_dcard_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$_p1w_dcard_dir/../lib-r2/p1w-markers.sh"
