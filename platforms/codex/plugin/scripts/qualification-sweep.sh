#!/usr/bin/env bash
# scripts/qualification-sweep.sh — roster-driven engine qualification sweep.
#
# Formalizes the durable shape of the session-local `sweep.sh`..`sweep5.sh`
# tools used for the Board-ordered 2026-08-22 full-roster implementer sweep
# (see docs/plans/evidence/2026-08-22-implementer-qualification-suite/). Those
# five scripts were byte-identical except for: the seat roster (which models
# ran), the frozen corpus hashes for that date's administration, and a
# session-scratchpad progress-file path. This script keeps the durable
# per-seat sequence — Stage-0 probe -> full administration -> scorecard
# record -> evidence bundle — and takes the session-specific parts as a JSON
# ROSTER file instead of baking them in.
#
# Stage-0 probe rationale: skills/engine-onboarding/SKILL.md documents that
# the qualifier (engine-qualify.js) does NOT write probe receipts itself —
# mechanizing that is an acknowledged BACKLOG row, and until it lands the
# OPERATOR must append one probe receipt per attempt to the evidence bundle's
# probe-receipts.jsonl (append-only) before every administration: runner bin
# path + version output, containment of the EXACT frozen model token, rc,
# timestamp, version_source, instrument_charged:false. A probe miss is an
# UNCHARGED infra abort (receipt retained, no administration attempted);
# retries are new linked attempts capped at 2; model substitution under one
# administration identity is forbidden. This script's --execute mode is that
# operator procedure, mechanized.
#
# USAGE:
#   scripts/qualification-sweep.sh --roster <file> [--plan]
#   scripts/qualification-sweep.sh --roster <file> --execute --yes [--progress <file>]
#   scripts/qualification-sweep.sh --help
#
# MODES (exactly two; --plan is the default when neither is given):
#   --plan     Deterministic, spends NOTHING. Reads the roster and PRINTS, per
#              seat, the exact commands --execute would run: the Stage-0 probe
#              dispatch, the `node scripts/engine-qualify.js <role> ...`
#              administration with every flag resolved from the roster, and
#              the `node scripts/engine-scorecard.js record ...` call. Output
#              is byte-stable across runs for the same roster: no timestamps,
#              PIDs, temp-dir names, or `command -v` output ever appear (the
#              one value --plan cannot resolve ahead of time — the runner's
#              --version-derived --runner-version token — is printed as the
#              literal placeholder `<resolved-at-execute-time>`).
#   --execute  Actually runs the sequence per seat: Stage-0 probe via
#              scripts/dispatch-hetero.sh into a throwaway git repo, a probe
#              receipt appended to <bundle>/probe-receipts.jsonl either way,
#              SKIP-with-retained-receipt on probe miss (never proceeds to a
#              charged administration after a probe miss), then the
#              administration, then the scorecard record, then a one-line
#              per-seat summary appended to the progress file.
#
#              HONESTY REQUIREMENT: --execute spends REAL MONEY on REAL
#              dispatches (1 Stage-0 probe + up to 24 administration
#              dispatches per seat = seats*25 total) and CANNOT be exercised
#              by hooks/tests/qualification-sweep.test.sh — there is no way to
#              cover a real paid dispatch in a hermetic unit test. The test
#              suite covers --plan (fully, including determinism) and the
#              --execute usage/guard surface (no-op without --yes) only. Do
#              not treat --execute as tested; treat it as reviewed-by-reading,
#              ported faithfully from the session-local sweep5.sh.
#              --execute refuses to proceed non-interactively without --yes,
#              and prints the seats*25 dispatch-count warning first either way.
#
# ROSTER FILE (JSON; see hooks/tests/fixtures/qualification-sweep-roster.json
# for a worked example the test suite uses):
#   {
#     "corpus": {
#       "prompt_config_hash": "<sha256 hex>",
#       "semantic_fingerprint": "<sha256 hex>",
#       "containment_fingerprint": "<sha256 hex>",
#       "harness_version": "dispatch-hetero:<short-sha>",
#       "expires_days": 90
#     },
#     "evidence_root": "docs/plans/evidence/<bundle-root>",
#     "role": "implementer",
#     "seats": [
#       { "slug": "sonnet5", "runner": "cc-shim", "model": "claude-sonnet-5",
#         "family": "anthropic", "version_source": "operator-asserted",
#         "endpoint": "anthropic-native", "effort": "high" },
#       ...
#     ]
#   }
#   endpoint is one of: "-" (no credential resolution; the runner uses its own
#   native auth, e.g. codex/grok/agy), "anthropic-native" (cc-shim against the
#   operator's own Claude Code OAuth token), or a named endpoint resolved via
#   scripts/resolve-endpoint.sh (e.g. "glm", "minimax").
#   task-class/domain/language/tool are fixed constants for this sweep shape
#   (bounded_implementation / repository / en / git_commit) — every source
#   sweep script used exactly these, so they are not roster fields.
#
# FLAGS:
#   --roster <file>     Required. Path to the roster JSON (see above).
#   --plan               Plan mode (default).
#   --execute            Execute mode (spends money; see HONESTY REQUIREMENT).
#   --yes                Required with --execute to proceed non-interactively.
#   --progress <file>    --execute only. Per-run progress log. Default:
#                        <evidence_root>/qualification-sweep-progress.txt
#   -h, --help           Print this header and exit 0.
#
# EXIT CODES: 0 success · 1 roster/validation failure (bad path, malformed
#   JSON, missing required field) · 2 usage error (bad/missing flag).
#
# Language choice: bash. This is git/CLI-dispatch glue that never runs inside
# the agy sandbox (CLAUDE.md § "Language choice (sh vs js vs py)"), so Node is
# used only where JSON parsing is unavoidable (`node -e`, not jq — jq is not
# guaranteed present; Node is).
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/.." && pwd)"

print_header() {
  awk '/^#!/{next} /^# ?/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

MODE="plan"
ROSTER=""
YES=0
PROGRESS_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      print_header
      exit 0
      ;;
    --roster)
      [ $# -ge 2 ] || { echo "qualification-sweep.sh: missing value for --roster" >&2; exit 2; }
      ROSTER="$2"
      shift 2
      ;;
    --plan)
      MODE="plan"
      shift
      ;;
    --execute)
      MODE="execute"
      shift
      ;;
    --yes)
      YES=1
      shift
      ;;
    --progress)
      [ $# -ge 2 ] || { echo "qualification-sweep.sh: missing value for --progress" >&2; exit 2; }
      PROGRESS_OVERRIDE="$2"
      shift 2
      ;;
    *)
      echo "qualification-sweep.sh: unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$ROSTER" ]; then
  echo "qualification-sweep.sh: --roster <file> is required" >&2
  exit 2
fi

if [ ! -f "$ROSTER" ]; then
  echo "qualification-sweep.sh: roster file not found: $ROSTER" >&2
  exit 1
fi

# --- roster parsing (Node — jq is not guaranteed present) ---------------
read -r -d '' ROSTER_READER_JS <<'NODE_EOF' || true
const fs = require('fs');
const rosterPath = process.argv[1];
let raw;
try {
  raw = fs.readFileSync(rosterPath, 'utf8');
} catch (e) {
  console.error(`qualification-sweep.sh: cannot read roster: ${rosterPath}`);
  process.exit(1);
}
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`qualification-sweep.sh: malformed JSON in roster: ${rosterPath}`);
  process.exit(1);
}
function req(obj, keys, label) {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v === undefined || v === null || v === '') {
      console.error(`qualification-sweep.sh: roster missing ${label}.${k}: ${rosterPath}`);
      process.exit(1);
    }
  }
}
req(data, ['evidence_root', 'role'], 'roster');
req(data.corpus, [
  'prompt_config_hash', 'semantic_fingerprint', 'containment_fingerprint',
  'harness_version', 'expires_days',
], 'roster.corpus');
if (!Array.isArray(data.seats) || data.seats.length === 0) {
  console.error(`qualification-sweep.sh: roster.seats must be a non-empty array: ${rosterPath}`);
  process.exit(1);
}
const T = '\t';
const corpus = data.corpus;
console.log(['CORPUS', corpus.prompt_config_hash, corpus.semantic_fingerprint,
  corpus.containment_fingerprint, corpus.harness_version, corpus.expires_days,
  data.evidence_root, data.role].join(T));
for (const seat of data.seats) {
  req(seat, ['slug', 'runner', 'model', 'family', 'version_source', 'endpoint', 'effort'], 'roster.seats[]');
  console.log(['SEAT', seat.slug, seat.runner, seat.model, seat.family,
    seat.version_source, seat.endpoint, seat.effort].join(T));
}
NODE_EOF

if ! ROSTER_LINES="$(node -e "$ROSTER_READER_JS" "$ROSTER")"; then
  exit 1
fi

CORPUS_LINE="$(printf '%s\n' "$ROSTER_LINES" | head -n 1)"
IFS=$'\t' read -r _tag PROMPT_HASH SEM_HASH CONTAIN_HASH HARNESS_VERSION EXPIRES_DAYS EVROOT ROLE <<< "$CORPUS_LINE"

SEAT_LINES=()
while IFS= read -r line; do
  [ -n "$line" ] && SEAT_LINES+=("$line")
done < <(printf '%s\n' "$ROSTER_LINES" | tail -n +2)

# --- shared helpers -------------------------------------------------------

seat_field() {
  # seat_field <seat-line> <index 1..7 (slug runner model family vsrc endpoint effort)>
  printf '%s\n' "$1" | cut -f "$(( $2 + 1 ))"
}

# --- plan mode -------------------------------------------------------------

plan_sweep() {
  for seat_line in "${SEAT_LINES[@]}"; do
    IFS=$'\t' read -r _tag slug runner model family vsrc endpoint effort <<< "$seat_line"
    bundle="$EVROOT/$slug-qualify"
    echo "=== SEAT: $slug ==="
    echo "role=$ROLE runner=$runner model=$model family=$family effort=$effort version_source=$vsrc endpoint=$endpoint"
    echo "bundle: $bundle"
    echo
    echo "[stage-0 probe]"
    if [ "$endpoint" = "anthropic-native" ]; then
      echo "  # resolve cc-shim credentials from the operator's own Claude Code OAuth token"
      echo "  #   (~/.claude/.credentials.json .claudeAiOauth.accessToken) -> ANTHROPIC_BASE_URL=https://api.anthropic.com"
    elif [ "$endpoint" != "-" ]; then
      echo "  scripts/resolve-endpoint.sh $endpoint"
    fi
    echo "  scripts/dispatch-hetero.sh --branch probe-1 --prompt-file <tmp>/.prompt.txt \\"
    echo "    --runner $runner --model $model --effort $effort --base HEAD \\"
    echo "    --timeout 240s --scaffold-tier off"
    echo "  # rc 0 + \"status\": \"committed\" -> probe receipt rc=0 appended to $bundle/probe-receipts.jsonl, proceed"
    echo "  # otherwise -> probe receipt rc=1 appended (instrument_charged:false), SKIP administration (uncharged)"
    echo
    echo "[administration]"
    echo "  node scripts/engine-qualify.js $ROLE \\"
    echo "    --engine $model --model $model --model-version $model \\"
    echo "    --runner $runner --runner-version <resolved-at-execute-time> --family $family \\"
    echo "    --harness-version $HARNESS_VERSION --effort $effort \\"
    echo "    --prompt-config-hash $PROMPT_HASH --semantic-fingerprint $SEM_HASH \\"
    echo "    --containment-fingerprint $CONTAIN_HASH \\"
    echo "    --task-class bounded_implementation --domain repository --language en --tool git_commit \\"
    echo "    --version-source $vsrc --expires-days $EXPIRES_DAYS \\"
    echo "    --raw-dir $bundle/raw --emit-row \\"
    echo "    > $bundle/qualify-out.json 2> $bundle/qualify-err.log"
    echo
    echo "[scorecard]"
    echo "  node scripts/engine-scorecard.js record --file $bundle/qualify-out.json \\"
    echo "    > $bundle/record-out.json 2> $bundle/record-err.log"
    echo
  done
}

# --- execute mode ------------------------------------------------------

probe_receipt() { # bundle runner model vsrc rc note
  printf '{"attempt":%s,"runner":"%s","model":"%s","bin":"%s","bin_version":"%s","version_source":"%s","probe_rc":%s,"note":"%s","instrument_charged":false,"probed_at":"%s"}\n' \
    "${7:-1}" "$2" "$3" "$(command -v "$2" 2>/dev/null || echo n/a)" \
    "$("$2" --version 2>&1 | head -1 | tr -cd 'A-Za-z0-9 ().[]:-' )" "$4" "$5" "$6" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$1/probe-receipts.jsonl"
}

stage0_probe() { # runner model effort -> rc 0 ok
  local runner="$1" model="$2" effort="${3:-high}"
  local pd; pd=$(mktemp -d /tmp/qualification-sweep-probe-XXXXXX)
  ( cd "$pd" && git init -q -b main && git config user.email t@t.invalid && git config user.name t \
    && printf 'placeholder\n' > note.md && git add -A && git commit -q -m base ) || { rm -rf "$pd"; return 3; }
  cat > "$pd/.prompt.txt" <<'EOF'
GOAL: Append a single line "verified" to note.md.
SCOPE: modify ONLY note.md.
OUTPUT: exactly one commit on the current branch.
BOUNDARIES: do not push; keep the diff minimal.
EOF
  local out
  out=$(cd "$pd" && timeout 320 bash "$REPO_ROOT/scripts/dispatch-hetero.sh" \
    --branch probe-1 --prompt-file "$pd/.prompt.txt" --runner "$runner" --model "$model" \
    --effort "$effort" --base HEAD --timeout 240s --scaffold-tier off 2>/dev/null | tail -1)
  rm -rf "$pd"
  echo "$out" | grep -q '"status": *"committed"' && return 0
  echo "PROBE_OUT:$out" >&2
  return 1
}

run_seat() { # slug runner model family vsrc endpoint effort
  local slug="$1" runner="$2" model="$3" family="$4" vsrc="$5" endpoint="$6" effort="$7"
  local bundle="$EVROOT/$slug-qualify"
  mkdir -p "$bundle"
  # cc-shim credentials via the canonical resolver (never manual export), ported
  # verbatim from the session-local sweep5.sh (the strongest of the five
  # sources): anthropic-native reads the operator's own Claude Code OAuth
  # token, otherwise scripts/resolve-endpoint.sh resolves a named endpoint.
  local saved_base="${ANTHROPIC_BASE_URL:-}" saved_tok="${ANTHROPIC_AUTH_TOKEN:-}"
  if [ "$endpoint" = "anthropic-native" ]; then
    local tok
    # Node, not python3: CLAUDE.md's language rule puts JSON parsing on Node,
    # and the sweep sources' python3 one-liner was the script's only python
    # dependency. Same file, same key path, same empty-on-failure behavior.
    tok="$(node -e 'try{const d=require(process.argv[1]);process.stdout.write((d.claudeAiOauth&&d.claudeAiOauth.accessToken)||"")}catch(e){}' "$HOME/.claude/.credentials.json" 2>/dev/null)"
    if [ -z "$tok" ]; then
      probe_receipt "$bundle" "$runner" "$model" "$vsrc" 3 "anthropic oauth token unavailable"
      log "SEAT $slug SKIP no-oauth-token"
      return
    fi
    export ANTHROPIC_BASE_URL="https://api.anthropic.com" ANTHROPIC_AUTH_TOKEN="$tok"
  elif [ "$endpoint" != "-" ]; then
    local meta base_url token_env
    meta=$(bash "$REPO_ROOT/scripts/resolve-endpoint.sh" "$endpoint" 2>/dev/null) || meta=""
    base_url=$(echo "$meta" | grep -o '"base_url": *"[^"]*"' | sed 's/.*: *"//;s/"//')
    token_env=$(echo "$meta" | grep -o '"token_env": *"[^"]*"' | sed 's/.*: *"//;s/"//')
    if [ -z "$base_url" ] || [ -z "$token_env" ] || [ -z "${!token_env:-}" ]; then
      probe_receipt "$bundle" "$runner" "$model" "$vsrc" 3 "endpoint_$endpoint unresolved"
      log "SEAT $slug SKIP endpoint-unresolved"
      return
    fi
    export ANTHROPIC_BASE_URL="$base_url" ANTHROPIC_AUTH_TOKEN="${!token_env}"
  fi
  # Stage-0
  if stage0_probe "$runner" "$model" "$effort"; then
    probe_receipt "$bundle" "$runner" "$model" "$vsrc" 0 "probe committed"
  else
    probe_receipt "$bundle" "$runner" "$model" "$vsrc" 1 "probe failed - uncharged infra abort"
    log "SEAT $slug PROBE-FAIL (uncharged, skipped)"
    [ "$endpoint" != "-" ] && export ANTHROPIC_BASE_URL="$saved_base" ANTHROPIC_AUTH_TOKEN="$saved_tok"
    return
  fi
  # Administration
  local rver rtok verbin
  verbin="$runner"; [ "$runner" = "cc-shim" ] && verbin="claude"
  rver="$($verbin --version 2>&1 | head -1)"
  rtok="$(printf %s "$rver" | tr -c 'A-Za-z0-9._:-' '-' | sed -e 's/--*/-/g' -e 's/^-//' -e 's/-$//')"
  [ -n "$rtok" ] || rtok="unknown"
  node "$REPO_ROOT/scripts/engine-qualify.js" "$ROLE" \
    --engine "$model" --model "$model" --model-version "$model" \
    --runner "$runner" --runner-version "$rtok" --family "$family" \
    --harness-version "$HARNESS_VERSION" --effort "$effort" \
    --prompt-config-hash "$PROMPT_HASH" --semantic-fingerprint "$SEM_HASH" \
    --containment-fingerprint "$CONTAIN_HASH" \
    --task-class bounded_implementation --domain repository --language en --tool git_commit \
    --version-source "$vsrc" --expires-days "$EXPIRES_DAYS" \
    --raw-dir "$bundle/raw" --emit-row \
    > "$bundle/qualify-out.json" 2> "$bundle/qualify-err.log"
  local qexit=$?
  echo "QUALIFY_EXIT=$qexit" >> "$bundle/qualify-err.log"
  local summary="no-row"
  if [ -s "$bundle/qualify-out.json" ] && head -c1 "$bundle/qualify-out.json" | grep -q '{'; then
    node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$bundle/qualify-out.json" \
      > "$bundle/record-out.json" 2> "$bundle/record-err.log"
    echo "RECORD_EXIT=$?" >> "$bundle/record-err.log"
    summary=$(node -e "
      const r=require(process.argv[1]);
      let ev=''; try{ev=require(process.argv[2]).event_id}catch(e){}
      console.log(r.status+' '+r.quality.corpus_pass+' score='+Number(r.capability_score).toFixed(3)+' wall='+r.latency.sample_wall_time_s+'s event='+ev);
    " "$PWD/$bundle/qualify-out.json" "$PWD/$bundle/record-out.json" 2>/dev/null || echo "row-parse-error")
  else
    summary="no_verdict/usage (exit $qexit)"
  fi
  [ "$endpoint" != "-" ] && export ANTHROPIC_BASE_URL="$saved_base" ANTHROPIC_AUTH_TOKEN="$saved_tok"
  log "SEAT $slug DONE: $summary"
}

execute_sweep() {
  local n_seats=${#SEAT_LINES[@]}
  local n_dispatches=$(( n_seats * 25 ))
  echo "qualification-sweep.sh --execute: about to run $n_seats seat(s) = $n_dispatches real, paid dispatches (1 Stage-0 probe + up to 24 administration dispatches per seat, sequential)." >&2
  if [ "$YES" -ne 1 ]; then
    echo "qualification-sweep.sh --execute: refusing to proceed without --yes. Nothing dispatched, no bundle created." >&2
    exit 1
  fi

  cd "$REPO_ROOT"
  # shellcheck disable=SC1091
  source "$REPO_ROOT/scripts/load-endpoints-env.sh" && autopilot_load_endpoints_env || true

  PROGRESS="${PROGRESS_OVERRIDE:-$EVROOT/qualification-sweep-progress.txt}"
  mkdir -p "$(dirname "$PROGRESS")"
  : > "$PROGRESS"
  log() { echo "$*" | tee -a "$PROGRESS"; }

  log "QUALIFICATION-SWEEP START $(date -u +%H:%M:%SZ) ($n_seats seats)"
  for seat_line in "${SEAT_LINES[@]}"; do
    IFS=$'\t' read -r _tag slug runner model family vsrc endpoint effort <<< "$seat_line"
    run_seat "$slug" "$runner" "$model" "$family" "$vsrc" "$endpoint" "$effort"
  done
  log "QUALIFICATION-SWEEP COMPLETE $(date -u +%H:%M:%SZ)"
}

if [ "$MODE" = "plan" ]; then
  plan_sweep
else
  execute_sweep
fi
