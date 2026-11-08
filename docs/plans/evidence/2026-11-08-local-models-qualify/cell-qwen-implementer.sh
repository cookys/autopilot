#!/usr/bin/env bash
# qwen x implementer. See cell-local.sh for runner/model/effort/provenance. DRY_RUN=1 for the no-network parameter dry run.
exec bash "$(dirname "${BASH_SOURCE[0]}")/cell-local.sh" qwen implementer
