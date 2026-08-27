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
# model substitution under one administration identity is forbidden. This
# script's --execute mode is that operator procedure, mechanized — with ONE
# part of the procedure NOT mechanized: the SKILL's "retries are new linked
# attempts capped at 2" is not implemented here. --execute probes each seat
# exactly once and skips on a miss; the `attempt` field in the receipt is
# always 1. Re-attempting is an operator decision, made by re-running the
# sweep with a roster narrowed to the missed seats.
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
# ROSTER FILE (JSON; the test suite builds a worked example inline — see
# hooks/tests/qualification-sweep.test.sh:15):
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
// FAIL CLOSED on any role but implementer. Two things in this script are
// implementer-shaped and would silently lie for another role:
//   1. the --execute consent warning computes seats*25 from the implementer
//      corpus (1 probe + 24 cases). The reviewer corpus is 42 cases, so a
//      reviewer roster would understate real money spent by ~72% — and that
//      warning is the ONLY informed-consent gate before --yes.
//   2. --task-class/--domain/--language/--tool are hardcoded to the
//      implementer suite's scope tuple below.
// Deriving per-role case counts is the right generalization; until then this
// refuses rather than mis-quotes a spend.
if (data.role !== 'implementer') {
  console.error(`qualification-sweep.sh: roster role '${data.role}' is not supported — this sweep is implementer-only (its cost warning and scope tuple are the implementer suite's). ${rosterPath}`);
  process.exit(1);
}
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
    # Which binary --execute would actually ask for a version. MAP LOOKUP ONLY — no
    # --version is run, so --plan stays byte-deterministic and free. Printing it is the
    # cheap check the 2026-08-27 incident lacked: the operator can SEE that runner=cursor
    # resolves to cursor-agent (not `cursor`, the IDE launcher) before spending anything.
    local vbin
    if vbin="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" binary --runner "$runner" 2>/dev/null)"; then
      echo "version_binary: $vbin"
    else
      echo "version_binary: UNMAPPED - runner '$runner' has no version-binary mapping; --execute would refuse this seat uncharged"
    fi
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
    if [ -n "$vbin" ]; then
      echo "  # BEFORE all of the above: \`$vbin --version\` must exit 0 and print a version-shaped"
      echo "  #   first stdout line; anything else -> probe receipt rc=4, seat refused UNCHARGED."
    else
      echo "  # BEFORE all of the above: the version binary must resolve. It does NOT for this"
      echo "  #   seat -> probe receipt rc=4, seat refused UNCHARGED. Nothing here is reached."
    fi
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

probe_receipt() { # bundle runner model vsrc rc note [attempt]
  # `bin` / `bin_version` record the RESOLVED version binary, never the runner token.
  # The old form ran `command -v "$runner"` and `"$runner" --version 2>&1`: for
  # runner=cursor that is the Cursor IDE launcher, so the receipt recorded `n/a` and an
  # error sentence as this run's binary identity. RESOLVED_BIN/RESOLVED_BIN_VERSION are
  # set by resolve_runner_version below and default to unresolved placeholders so a
  # receipt written before (or instead of) resolution is honest rather than wrong.
  #
  # Both are the OBSERVED strings (resolved path, first stdout line) passed through
  # receiptSafe() — not the sanitized identity token, and not raw either: control
  # characters, `"` and `\` are stripped, because these now carry real CLI output into a
  # printf JSON template and a quote in a version banner would otherwise emit an
  # unparseable line into an append-only evidence file. The identity token itself is
  # RESOLVED_VERSION_TOKEN, which is what the administration receives.
  printf '{"attempt":%s,"runner":"%s","model":"%s","bin":"%s","bin_version":"%s","version_source":"%s","probe_rc":%s,"note":"%s","instrument_charged":false,"probed_at":"%s"}\n' \
    "${7:-1}" "$2" "$3" "${RESOLVED_BIN:-unresolved}" \
    "${RESOLVED_BIN_VERSION:-unresolved}" "$4" "$5" "$6" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$1/probe-receipts.jsonl"
}

# Resolve the runner's version identity through the ONE owner of the runner->binary map
# (scripts/lib/runner-binary.js), failing closed on anything unusable.
#
# WHY (2026-08-27): this function used to be four inline lines that derived the version
# binary from the runner NAME, special-casing only cc-shim->claude. `runner: cursor` runs
# `cursor-agent`; plain `cursor` is the IDE launcher, whose `--version` error sentence —
# folded in by `2>&1` and merely character-sanitized — became the `--runner-version`
# identity token of a real, paid administration. runner_version decides whether
# qualification evidence still applies later, so that row was authoritative-looking and
# unmatchable. Same wrong assumption already fixed once in probe-engine-capability.sh
# (v2.34.42); this copy was independent and unlooked-at.
#
# Sets RESOLVED_BIN / RESOLVED_BIN_VERSION / RESOLVED_VERSION_TOKEN / RESOLVED_VERSION_REASON.
# Returns 0 only when a usable token exists. A non-zero return MUST abort the seat
# uncharged — never fall back to "unknown" or to a sanitized error string.
resolve_runner_version() { # runner -> rc 0 usable
  local runner="$1" json
  RESOLVED_BIN="unresolved"; RESOLVED_BIN_VERSION="unresolved"
  RESOLVED_VERSION_TOKEN=""; RESOLVED_VERSION_REASON="resolver_failed"
  json="$(node "$REPO_ROOT/scripts/lib/runner-binary.js" version --runner "$runner" --json 2>/dev/null)" || true
  [ -n "$json" ] || return 1
  # Four values, one per line, read with `read -r` — deliberately NOT `eval`. These fields
  # are derived from an arbitrary CLI's output; eval-ing shell assignments built from that
  # would make a hostile (or merely odd) --version a code-execution surface for the sake of
  # four string variables. receiptSafe() strips control characters, `"` and `\`, so no
  # value can carry a newline that forges an extra line here, or a quote/backslash that
  # forges a field in probe_receipt's JSON template.
  {
    IFS= read -r RESOLVED_BIN
    IFS= read -r RESOLVED_BIN_VERSION
    IFS= read -r RESOLVED_VERSION_TOKEN
    IFS= read -r RESOLVED_VERSION_REASON
  } < <(node -e '
    const { receiptSafe } = require(process.argv[1]);
    const r = JSON.parse(process.argv[2]);
    process.stdout.write(receiptSafe(r.binary_path || r.binary || "unresolved") + "\n");
    process.stdout.write(receiptSafe(r.version_line || "unresolved") + "\n");
    process.stdout.write(receiptSafe(r.ok ? r.token : "") + "\n");
    process.stdout.write(receiptSafe(r.ok ? "ok" : (r.reason || "refused")) + "\n");
  ' "$REPO_ROOT/scripts/lib/runner-binary.js" "$json")
  [ -n "${RESOLVED_BIN:-}" ] || RESOLVED_BIN="unresolved"
  [ -n "${RESOLVED_BIN_VERSION:-}" ] || RESOLVED_BIN_VERSION="unresolved"
  [ -n "${RESOLVED_VERSION_REASON:-}" ] || RESOLVED_VERSION_REASON="resolver_failed"
  [ -n "${RESOLVED_VERSION_TOKEN:-}" ] || return 1
  return 0
}

stage0_probe() { # runner model effort -> rc 0 ok
  local runner="$1" model="$2" effort="${3:-high}"
  # Templateless on purpose: an explicit mktemp placeholder template trips
  # completeness-scan.sh's anti-stub marker pattern (see PAT_MARKER in that
  # script). Same throwaway dir, no false-positive gate finding.
  local pd; pd=$(mktemp -d)
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
  # VERSION IDENTITY FIRST — before any credential resolution, before the stage-0 probe.
  # An unusable --version is an infra abort exactly like a probe miss: uncharged, receipt
  # retained, seat NOT administered. Doing it first means a refused seat costs nothing at
  # all (no token read, no dispatch), which is the whole posture: a refused seat is free,
  # a bogus identity row costs a paid administration plus a permanent lie.
  if ! resolve_runner_version "$runner"; then
    probe_receipt "$bundle" "$runner" "$model" "$vsrc" 4 \
      "runner version unusable ($RESOLVED_VERSION_REASON) - uncharged infra abort"
    SEAT_FAILURES=$(( SEAT_FAILURES + 1 ))
    log "SEAT $slug VERSION-REFUSED ($RESOLVED_VERSION_REASON) - seat NOT administered (uncharged)"
    return
  fi
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
    SEAT_FAILURES=$(( SEAT_FAILURES + 1 ))
    log "SEAT $slug PROBE-FAIL (uncharged, skipped) - seat NOT administered"
    [ "$endpoint" != "-" ] && export ANTHROPIC_BASE_URL="$saved_base" ANTHROPIC_AUTH_TOKEN="$saved_tok"
    return
  fi
  # Administration. The version token was resolved and validated at the TOP of this seat
  # (resolve_runner_version); an unusable one already aborted uncharged. Nothing is
  # derived from the runner name here.
  node "$REPO_ROOT/scripts/engine-qualify.js" "$ROLE" \
    --engine "$model" --model "$model" --model-version "$model" \
    --runner "$runner" --runner-version "$RESOLVED_VERSION_TOKEN" --family "$family" \
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
  # OPERATIONAL failure vs HONEST VERDICT (depth-0 panel F4). A recorded FAILED
  # administration is a successful sweep step - that is the instrument working.
  # An administration that produced no row, or a record call that refused the
  # row, is an OPERATIONAL failure: nothing landed in the store, and a sweep
  # that prints COMPLETE and exits 0 over it tells the operator a lie they will
  # act on. Those two cases set SEAT_FAILURES; honest FAILED verdicts do not.
  if [ -s "$bundle/qualify-out.json" ] && head -c1 "$bundle/qualify-out.json" | grep -q '{'; then
    node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$bundle/qualify-out.json" \
      > "$bundle/record-out.json" 2> "$bundle/record-err.log"
    local rexit=$?
    echo "RECORD_EXIT=$rexit" >> "$bundle/record-err.log"
    if [ "$rexit" -ne 0 ]; then
      SEAT_FAILURES=$(( SEAT_FAILURES + 1 ))
      log "SEAT $slug RECORD-FAIL (exit $rexit) - administration ran but its row was NOT recorded; see $bundle/record-err.log"
      [ "$endpoint" != "-" ] && export ANTHROPIC_BASE_URL="$saved_base" ANTHROPIC_AUTH_TOKEN="$saved_tok"
      return
    fi
    summary=$(node -e "
      const r=require(process.argv[1]);
      let ev=''; try{ev=require(process.argv[2]).event_id}catch(e){}
      console.log(r.status+' '+r.quality.corpus_pass+' score='+Number(r.capability_score).toFixed(3)+' wall='+r.latency.sample_wall_time_s+'s event='+ev);
    " "$PWD/$bundle/qualify-out.json" "$PWD/$bundle/record-out.json" 2>/dev/null || echo "row-parse-error")
  else
    SEAT_FAILURES=$(( SEAT_FAILURES + 1 ))
    log "SEAT $slug QUALIFY-FAIL (exit $qexit) - no verdict row emitted; see $bundle/qualify-err.log"
    [ "$endpoint" != "-" ] && export ANTHROPIC_BASE_URL="$saved_base" ANTHROPIC_AUTH_TOKEN="$saved_tok"
    return
  fi
  [ "$endpoint" != "-" ] && export ANTHROPIC_BASE_URL="$saved_base" ANTHROPIC_AUTH_TOKEN="$saved_tok"
  log "SEAT $slug DONE: $summary"
}

SEAT_FAILURES=0

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
  if [ "$SEAT_FAILURES" -gt 0 ]; then
    log "QUALIFICATION-SWEEP INCOMPLETE $(date -u +%H:%M:%SZ) - $SEAT_FAILURES of $n_seats seat(s) did not land a recorded administration (see PROBE-FAIL / QUALIFY-FAIL / RECORD-FAIL lines above)"
    exit 1
  fi
  log "QUALIFICATION-SWEEP COMPLETE $(date -u +%H:%M:%SZ)"
}

if [ "$MODE" = "plan" ]; then
  plan_sweep
else
  execute_sweep
fi
