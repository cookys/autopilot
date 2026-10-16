#!/usr/bin/env bash
# cell-kimi-rv6.sh <kimi|kimi28> -- reviewer v6 sitting (reviewer-metamorphic-v6) on the kimi CLI seat, effort high.
# Written like cell-cli-rv6.sh; fingerprints come from identity/reviewer-<lane>.json, harness hash is the current engine-qualify.js.
# Output: out/rv6-kimi-<k3|k28>-high/ (emit-row.json). rc 0 pass, 1 fail, 3 credential unusable.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
LANE="${1:?kimi|kimi28}"
case "$LANE" in kimi) TAG=k3; MV=kimi-code-k3; PROBE=kimi-auth-probe.sh;; kimi28) TAG=k28; MV=kimi-for-coding:K2.8-Preview; PROBE=kimi28-stage-probe.sh;; *) exit 2;; esac
D="$HERE/out/rv6-kimi-$TAG-high"; mkdir -p "$D/raw"; cd "$REPO" || exit 2
idv() { node -e "console.log(require('$HERE/identity/reviewer-$LANE.json')['$1'])"; }
RV="$(node scripts/lib/runner-binary.js version --runner kimi --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).token)')"
HARNESS="engine-qualify-$(sha256sum scripts/engine-qualify.js | cut -c1-8)"
if [ "${DRY_RUN:-0}" = 1 ]; then echo "dry $LANE harness=$HARNESS model=$(idv identity) engine=$(idv engine) mv=$MV"; exit 0; fi
bash "$HERE/$PROBE" > "$D/probe.log" 2>&1 || { echo "rc=3 probe failed" >> "$D/probe.log"; echo 3 > "$D/rc"; exit 3; }
if [ "$LANE" = kimi ]; then STAGING_HOME="$HOME/.autopilot/qualify-staging/reviewer-kimi-k3/kimi-home"; else STAGING_HOME="$HOME/.autopilot/qualify-staging/reviewer-kimi-k2.8-preview/kimi-home"; fi
env QRP_TIMEOUT_MS=570000 QRP_PROMPT_MODE=reviewer QRP_MODEL="$(idv identity)" QRP_PROVIDER=moonshot QRP_TRANSPORT=cli QRP_CLI_KIND=kimi QRP_CLI_HOME="$STAGING_HOME" \
  timeout 18000 bash scripts/engine-qualify.sh reviewer \
  --engine "$(idv engine)" --model "$(idv identity)" --model-version "$MV" \
  --runner kimi --runner-version "$RV" --family moonshot \
  --harness-version "$HARNESS" --effort high \
  --prompt-config-hash "$(idv prompt_config_hash)" --semantic-fingerprint "$(idv semantic_fingerprint)" --containment-fingerprint "$(idv containment_fingerprint)" \
  --remote-provider-cmd "node $REPO/scripts/qualification-review-provider.js" --remote-provider moonshot --remote-timeout-ms 600000 \
  --provider-env QRP_MODEL --provider-env QRP_PROVIDER --provider-env QRP_PROMPT_MODE --provider-env QRP_TRANSPORT \
  --provider-env QRP_CLI_KIND --provider-env QRP_CLI_HOME --provider-env QRP_TIMEOUT_MS \
  --task-class code_review --domain cross-cutting --language en --tool read_only \
  --version-source operator-asserted --raw-dir "$D/raw" --emit-row > "$D/stdout.json" 2> "$D/stderr.log"
rc=$?; cp "$D/stdout.json" "$D/emit-row.json" 2>/dev/null; echo "$rc" > "$D/rc"; exit "$rc"
