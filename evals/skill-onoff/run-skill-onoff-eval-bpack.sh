#!/usr/bin/env bash
# run-skill-onoff-eval-bpack.sh — bpack copy of the single-run arm runner.
# Same as run-skill-onoff-eval-gdorm.sh: the shared run-skill-onoff-eval.sh stays
# byte-identical to develop because frozen rows digest it. This copy adds
# seed-home.sh, ONOFF_CELL_HOME, an unset of AUTOPILOT_CONFIG_FILE, and the ONOFF_OUT export.
#
# Measures whether skills/dev-flow content, loaded as a REAL plugin skill at depth 0
# (routing + loading channel, not prompt injection), changes orchestrator behavior on
# micro-tasks with deterministic markers. Three arms: full | card | off — the ONLY
# variable is the dev-flow pack content; companion roster, prompt bytes, and repo
# fixtures are identical across arms (plan: docs/plans/_archive/2026/08/2026-08-18-dev-flow-contract-card.md §3).
#
# Usage:
#   run-skill-onoff-eval.sh --task d1-s-tiny-feature --arm full|card|off \
#     --model <model> [--out <dir>] [--rep <n>] [--runner cc|stub]
#
# Generic arms (mods P1W E1-E5; the dev-flow full|card|off arms above stay byte-identical):
#   run-skill-onoff-eval.sh --task <id> --skill <name> --arm base|change \
#     [--pack-base <packs/ dir name>] [--pack-change <packs/ dir name>] \
#     [--with-pack <skill>=<packs/ dir name>]... [--fixture-scripts <packs/ dir name>] \
#     [--check-skill <name>] --model <m> ...
#   --skill/--arm base|change  the ONLY variable is skills/<name>/ = the digest-verified pack
#                              (default dir names <skill>-base / <skill>-change; manifest key = dir name).
#                              Companions are copied except <skill> and any --with-pack skill.
#   --with-pack s=dir          also load skill s from pack dir, identically in both arms.
#   --fixture-scripts dir      pack root copied onto the fixture repo root BEFORE the frozen base
#                              commit, identically in both arms (helpers under test; E3).
#   --check-skill name         manipulation check (E5): row carries "skill_invoked" for <name>
#                              instead of the dev-flow-only skill_invoked_devflow field
#                              (implied by --skill).
# Multi-pack arms (P5 arm builder; every flag above keeps its exact behavior):
#   run-skill-onoff-eval.sh --task <id> --arm-manifest <file.json> --model <m> ...
#   --arm-manifest f   the arm is a SET of packs: {"schema_version":1,"arm":"base|change|red|...",
#                      "skills":{"<skill>":"<packs/ dir name>",...},      every skill pack -> skills/<skill>/
#                      "files":"<packs/ dir name>" | ["<dir>",...],      non-skill guidance files -> plugin ROOT
#                      "fixture_scripts":["<dir>",...]}                   copied onto the fixture repo root
#                      (after any --fixture-scripts dirs, so a manifest pack overlays a row's helper pack).
#                      The row's "arm" is the manifest's arm (--arm, when also given, must agree). Companions of the
#                      same name as a manifest skill are NOT copied; every pack is digest-verified exact. Row carries
#                      skill_invoked/check_skill (default dev-flow). Not combinable with --skill/--pack-*/--with-pack.
#   --fixture-scripts a,b   a comma list is applied in order (later overlays earlier) — manifest arms only.
# Per-cell isolation (E4, every run; state root on tmpfs, see below): AUTOPILOT_LIVE_DIR / AUTOPILOT_TASK_STATUS_DIR
# point under a per-cell temp dir (the decision ledger default lives in the fixture repo git-common-dir); copied to $OUT/state/ for evidence.
#
# Env: ONOFF_PROMPT_PREFIX (optional preface line before task.md, both arms; amend-2) · ONOFF_TIMEOUT (default 10m) · ONOFF_TIMEOUT_IS_COMPLETE=1 (a timeout stop with a non-empty transcript is a complete cell, row carries stopped_by_timeout; default off) · ONOFF_STUB_BIN (required for --runner stub)
#      ONOFF_REQUIRE_PLUGIN_SCRIPTS (comma list of plugin-root-relative scripts, e.g. scripts/session-mode.js; before the agent starts each is
#        require()d from the assembled scratch plugin, so its whole require graph must resolve; any failure is infra_fail/plugin_script_unresolvable
#        and the runner is never started. The g67 rows set it from the prereg; default off = no check)
#      ONOFF_PACKS_DIR (override packs dir; tests) · ONOFF_STATE_BASE (tmpfs base for per-cell state; none writable = exit 2) · ONOFF_SHM_DIR (default /dev/shm)
# Optional second turn (only when tasks/<id>/turn2.sh is executable; every other task emits the
# same row as before). turn2.sh runs in the cell repo and prints the follow-up prompt, or nothing
# (row.turn2 = skipped_no_card, b_ markers false). Otherwise the same claude -p flags resume the
# session id from the first system/init event. Stub: ONOFF_TURN=1 then ONOFF_TURN=2 <prompt-file>.
# Before that block, tasks with an executable turn2.sh copy decision files to
# $OUT/decisions-pre-turn2/{live,git} and export DCARD_DECISIONS_PRE_TURN2. When turn 2 does not
# run or is skipped (for example the nohook arm: turn 2 prints no body, state skipped_no_card),
# the snapshot is still taken, and equals the final state. The row then also carries turn2_exit
# (integer, 0 when turn2.sh ran clean). ONOFF_TASKS_DIR overrides the tasks root (tests only).
# Emits: $OUT/result.json (single-line JSONL row), $OUT/transcript.jsonl, $OUT/prompt.md
# Exit: 0 = row emitted (marker outcomes live IN the row) · 2 = harness/config error

set -euo pipefail

TASK_ID=""; ARM=""; MODEL=""; OUT_DIR=""; REP="1"; RUNNER="cc"
SKILL=""; PACK_BASE=""; PACK_CHANGE=""; FIXTURE_SCRIPTS=""; CHECK_SKILL=""; WITH_PACKS=(); ARM_MANIFEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK_ID="$2"; shift 2 ;;
    --arm) ARM="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --rep) REP="$2"; shift 2 ;;
    --runner) RUNNER="$2"; shift 2 ;;
    --skill) SKILL="$2"; shift 2 ;;
    --pack-base) PACK_BASE="$2"; shift 2 ;;
    --pack-change) PACK_CHANGE="$2"; shift 2 ;;
    --with-pack) WITH_PACKS+=("$2"); shift 2 ;;
    --fixture-scripts) FIXTURE_SCRIPTS="$2"; shift 2 ;;
    --check-skill) CHECK_SKILL="$2"; shift 2 ;;
    --arm-manifest) ARM_MANIFEST="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
MAN_SKILLS=""; MAN_FILES=""; MAN_FIXTURES=""
if [ -n "$ARM_MANIFEST" ]; then
  [ -f "$ARM_MANIFEST" ] || { echo "ERROR: arm manifest not found: $ARM_MANIFEST" >&2; exit 2; }
  if [ -n "$SKILL$PACK_BASE$PACK_CHANGE" ] || [ "${#WITH_PACKS[@]}" -gt 0 ]; then
    echo "ERROR: --arm-manifest cannot combine with --skill/--pack-*/--with-pack" >&2; exit 2
  fi
  # one US(0x1f)-separated line (NOT tab: tab is IFS-whitespace, so an empty field collapses and shifts the next one, BL-0196): arm, "skill=pack ...", "files pack ...", "fixture pack ..." (a bad shape is exit 2)
  MAN_LINE=$(node -e '
    const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const bare=/^[a-z0-9][a-z0-9._-]*$/, bad=(m)=>{console.error("arm manifest: "+m);process.exit(2)};
    if(j.schema_version!==1) bad("schema_version must be 1");
    if(typeof j.arm!=="string"||!bare.test(j.arm)) bad("arm must be a bare name");
    const sk=j.skills||{}; const fl=[].concat(j.files||[]); const fx=[].concat(j.fixture_scripts||[]);
    if(typeof sk!=="object"||Array.isArray(sk)) bad("skills must be an object");
    for(const [k,v] of Object.entries(sk)) if(!bare.test(k)||typeof v!=="string"||!bare.test(v)) bad("bad skill entry "+k);
    for(const v of [...fl,...fx]) if(typeof v!=="string"||!bare.test(v)) bad("bad pack name "+v);
    if(!Object.keys(sk).length&&!fl.length) bad("empty arm (no skills, no files)");
    process.stdout.write([j.arm,Object.entries(sk).map(([k,v])=>k+"="+v).join(" "),fl.join(" "),fx.join(" ")].join("\x1f"));
  ' "$ARM_MANIFEST") || exit 2
  IFS=$'\x1f' read -r M_ARM MAN_SKILLS MAN_FILES MAN_FIXTURES <<< "$MAN_LINE"
  [ -z "$ARM" ] || [ "$ARM" = "$M_ARM" ] || { echo "ERROR: --arm $ARM disagrees with manifest arm $M_ARM" >&2; exit 2; }
  ARM="$M_ARM"
fi
if [ -z "$TASK_ID" ] || [ -z "$ARM" ] || [ -z "$MODEL" ]; then
  echo "Usage: $0 --task <id> --arm full|card|off --model <m> [--out <dir>] [--rep <n>] [--runner cc|stub]" >&2
  exit 2
fi
if [ -n "$ARM_MANIFEST" ]; then
  [ -n "$CHECK_SKILL" ] || CHECK_SKILL="dev-flow"
elif [ -n "$SKILL" ]; then
  case "$ARM" in base|change) ;; *) echo "ERROR: with --skill the arm must be base|change" >&2; exit 2 ;; esac
  case "$SKILL" in *[!a-z0-9-]*|"") echo "ERROR: bad --skill name: $SKILL" >&2; exit 2 ;; esac
else
  case "$ARM" in full|card|off) ;; *) echo "ERROR: arm must be full|card|off (base|change need --skill)" >&2; exit 2 ;; esac
  if [ -n "$PACK_BASE$PACK_CHANGE" ] || [ "${#WITH_PACKS[@]}" -gt 0 ]; then
    echo "ERROR: --pack-base/--pack-change/--with-pack need --skill" >&2; exit 2
  fi
fi
[ -z "$SKILL" ] || [ -n "$CHECK_SKILL" ] || CHECK_SKILL="$SKILL"
case "$RUNNER" in cc|stub) ;; *) echo "ERROR: runner must be cc|stub" >&2; exit 2 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_DIR="$REPO_ROOT/evals/skill-onoff"
TASKS_ROOT="${ONOFF_TASKS_DIR:-$BASE_DIR/tasks}"
TASK_DIR="$TASKS_ROOT/$TASK_ID"
PACKS_DIR="${ONOFF_PACKS_DIR:-$BASE_DIR/packs}"
[ -d "$TASK_DIR" ] || { echo "ERROR: task dir not found: $TASK_DIR" >&2; exit 2; }
[ -f "$TASK_DIR/task.md" ] || { echo "ERROR: task.md missing: $TASK_DIR" >&2; exit 2; }
[ -f "$TASK_DIR/markers.sh" ] || { echo "ERROR: markers.sh missing: $TASK_DIR" >&2; exit 2; }

if [ -z "$OUT_DIR" ]; then OUT_DIR=$(mktemp -d -t "onoff-out-${TASK_ID}-${ARM}-XXXXXX"); fi
mkdir -p "$OUT_DIR"

pack_name() { # $1 = packs/ dir name (no path separators; must exist)
  case "$1" in */*|*..*|"") echo "ERROR: pack name must be a bare packs/ dir name: $1" >&2; exit 2 ;; esac
  [ -d "$PACKS_DIR/$1" ] || { echo "ERROR: pack dir not found: $PACKS_DIR/$1" >&2; exit 2; }
  printf '%s' "$1"
}

# ── digest integrity: every pack file consumed must match the frozen manifest ──
verify_pack() { # $1 = pack key (e.g. dev-flow-card) · $2 = "exact": also reject files the manifest does not list
  node -e '
    const fs=require("fs"),crypto=require("crypto"),path=require("path");
    const [packsDir,key]=process.argv.slice(1);
    const man=JSON.parse(fs.readFileSync(path.join(packsDir,"manifest.json"),"utf8"));
    const files=(man.packs||{})[key];
    if(!files){console.error(`manifest has no pack: ${key}`);process.exit(2);}
    if(process.argv[3]==="exact"){
      const walk=(d,pre)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name),pre+e.name+"/"):[pre+e.name]);
      for(const f of walk(path.join(packsDir,key),key+"/")) if(!(f in files)){console.error(`unlisted file in pack ${key}: ${f}`);process.exit(2);}
    }
    for(const [rel,digest] of Object.entries(files)){
      const p=path.join(packsDir,rel);
      const got=crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      if(got!==digest){console.error(`digest mismatch: ${rel}`);process.exit(2);}
    }
  ' "$PACKS_DIR" "$1" "${2:-}"
}

# ── temp repo with per-task branch topology (frozen fixture: repo/ + init-repo.sh) ──
TEMP_REPO=$(mktemp -d -t "onoff-repo-${TASK_ID}-XXXXXX")
SCRATCH_HOME=$(mktemp -d -t "onoff-home-XXXXXX")
SCRATCH_CONFIG="$SCRATCH_HOME/.claude-config"
SCRATCH_PLUGIN=$(mktemp -d -t "onoff-plugin-XXXXXX")
# E4: per-cell live/task-status/ledger dirs. scripts/lib/live-state-dir.js ACCEPTS an
# $AUTOPILOT_LIVE_DIR override only when it is tmpfs/ramfs, owned, mode 0700 — otherwise it silently
# falls through to the REAL $XDG_RUNTIME_DIR/autopilot. So the state root goes on tmpfs when one exists.
STATE_BASE=""
for cand in "${ONOFF_STATE_BASE:-}" "${XDG_RUNTIME_DIR:-}" "${ONOFF_SHM_DIR:-/dev/shm}"; do
  if [ -n "$cand" ] && [ -d "$cand" ] && [ -w "$cand" ]; then
    case "$(stat -f -c %T "$cand" 2>/dev/null)" in tmpfs|ramfs) STATE_BASE="$cand"; break ;; esac
  fi
done
if [ -z "$STATE_BASE" ]; then
  # fail closed: without a tmpfs base the resolver rejects the override and would write the REAL live dir
  echo "ERROR: no writable tmpfs base for the per-cell live dir (tried ONOFF_STATE_BASE, XDG_RUNTIME_DIR, /dev/shm); set ONOFF_STATE_BASE to a tmpfs dir" >&2
  exit 2
fi
CELL_STATE=$(mktemp -d -p "$STATE_BASE" "onoff-state-XXXXXX")
chmod 700 "$CELL_STATE"
mkdir -m 700 "$CELL_STATE/live"; mkdir -p "$CELL_STATE/task-status"
export AUTOPILOT_LIVE_DIR="$CELL_STATE/live" AUTOPILOT_TASK_STATUS_DIR="$CELL_STATE/task-status"
cleanup() { rm -rf "$TEMP_REPO" "$SCRATCH_HOME" "$SCRATCH_PLUGIN" "$CELL_STATE"; }
trap cleanup EXIT

cp -r "$TASK_DIR/repo"/. "$TEMP_REPO"/
if [ -n "$FIXTURE_SCRIPTS" ] && [ -z "$ARM_MANIFEST" ]; then  # E3: identical frozen helper set in BOTH arms, before the base commit
  FS_NAME=$(pack_name "$FIXTURE_SCRIPTS")
  verify_pack "$FS_NAME" exact
  cp -r "$PACKS_DIR/$FS_NAME"/. "$TEMP_REPO"/
fi
if [ -n "$ARM_MANIFEST" ]; then  # P5: ordered fixture-scripts overlay (CLI list first, then the manifest's)
  read -ra FS_LIST <<< "${FIXTURE_SCRIPTS//,/ } $MAN_FIXTURES"
  for fs_one in "${FS_LIST[@]+"${FS_LIST[@]}"}"; do
    FS_NAME=$(pack_name "$fs_one"); verify_pack "$FS_NAME" exact
    cp -r "$PACKS_DIR/$FS_NAME"/. "$TEMP_REPO"/
  done
fi
(
  cd "$TEMP_REPO"
  git init -q
  git config user.name "Autopilot Eval"; git config user.email "eval@example.com"
  git config commit.gpgsign false
  # Task-owned branch topology (d3/d7: develop default + main; d4: main default + develop).
  # init-repo.sh runs AFTER files land and owns all branch/commit layout.
  bash "$TASK_DIR/init-repo.sh"
)
FROZEN_BASE_SHA="$(git -C "$TEMP_REPO" rev-parse HEAD)"

# ── synthetic plugin: companions identical across arms; dev-flow per arm ──
mkdir -p "$SCRATCH_PLUGIN/.claude-plugin"
printf '{"name":"autopilot","version":"0.0.1","description":"skill-onoff eval plugin"}\n' \
  > "$SCRATCH_PLUGIN/.claude-plugin/plugin.json"
WITH_NAMES=" "
for wp in "${WITH_PACKS[@]+"${WITH_PACKS[@]}"}"; do WITH_NAMES="$WITH_NAMES${wp%%=*} "; done
for comp in "$PACKS_DIR/companions"/*/; do
  [ -d "$comp" ] || continue
  name=$(basename "$comp")
  if [ -n "$SKILL" ] && { [ "$name" = "$SKILL" ] || [[ "$WITH_NAMES" == *" $name "* ]]; }; then continue; fi
  if [ -n "$ARM_MANIFEST" ] && [[ " $MAN_SKILLS " == *" $name="* ]]; then continue; fi
  mkdir -p "$SCRATCH_PLUGIN/skills/$name"
  cp -r "$comp". "$SCRATCH_PLUGIN/skills/$name/"
done
verify_pack "companions"
if [ -n "$ARM_MANIFEST" ]; then
  # P5: the arm is a SET of digest-verified packs (every skill + the non-skill guidance files).
  for ms in $MAN_SKILLS; do
    mskill="${ms%%=*}"; mpack="${ms#*=}"
    MK=$(pack_name "$mpack"); verify_pack "$MK" exact
    mkdir -p "$SCRATCH_PLUGIN/skills/$mskill"
    cp -r "$PACKS_DIR/$MK"/. "$SCRATCH_PLUGIN/skills/$mskill/"
  done
  for mf in $MAN_FILES; do
    MK=$(pack_name "$mf"); verify_pack "$MK" exact
    cp -r "$PACKS_DIR/$MK"/. "$SCRATCH_PLUGIN"/
  done
elif [ -n "$SKILL" ]; then
  # E1/E2: generic arms — the target skill is the digest-verified pack; nothing else varies.
  if [ "$ARM" = "base" ]; then PK=$(pack_name "${PACK_BASE:-$SKILL-base}"); else PK=$(pack_name "${PACK_CHANGE:-$SKILL-change}"); fi
  verify_pack "$PK" exact
  mkdir -p "$SCRATCH_PLUGIN/skills/$SKILL"
  cp -r "$PACKS_DIR/$PK"/. "$SCRATCH_PLUGIN/skills/$SKILL/"
  for wp in "${WITH_PACKS[@]+"${WITH_PACKS[@]}"}"; do
    wskill="${wp%%=*}"; wpack="${wp#*=}"
    [ "$wskill" != "$wp" ] && [ "$wskill" != "$SKILL" ] || { echo "ERROR: bad --with-pack (want other-skill=packdir): $wp" >&2; exit 2; }
    WK=$(pack_name "$wpack"); verify_pack "$WK" exact
    mkdir -p "$SCRATCH_PLUGIN/skills/$wskill"
    cp -r "$PACKS_DIR/$WK"/. "$SCRATCH_PLUGIN/skills/$wskill/"
  done
else
case "$ARM" in
  full)
    verify_pack "dev-flow-full"
    mkdir -p "$SCRATCH_PLUGIN/skills/dev-flow"
    cp -r "$PACKS_DIR/dev-flow-full"/. "$SCRATCH_PLUGIN/skills/dev-flow/" ;;
  card)
    verify_pack "dev-flow-card"
    mkdir -p "$SCRATCH_PLUGIN/skills/dev-flow"
    cp -r "$PACKS_DIR/dev-flow-card"/. "$SCRATCH_PLUGIN/skills/dev-flow/" ;;
  off) : ;; # dev-flow absent — plugin + companion catalog still present
esac
fi

# ── scratch HOME + scratch CLAUDE_CONFIG_DIR, credentials-only seeding ──
# NEVER point CLAUDE_CONFIG_DIR at the real ~/.claude (it gets reset); an UNSET
# config dir can leak the operator's installed plugins into the OFF arm (G1-F9),
# so both HOME and CLAUDE_CONFIG_DIR are always exported to scratch paths.
mkdir -p "$SCRATCH_CONFIG"
if [ "$RUNNER" = "cc" ] && [ -f "${HOME}/.claude/.credentials.json" ]; then
  cp "${HOME}/.claude/.credentials.json" "$SCRATCH_CONFIG/"
  chmod 600 "$SCRATCH_CONFIG/.credentials.json"
fi
printf '{"hasCompletedOnboarding":true}\n' > "$SCRATCH_HOME/.claude.json"
# A task may ship seed-home.sh. It receives the scratch HOME and may write only
# under that directory (a task may plant config there).
# Absent => no-op. The real ~/.autopilot is never a seed target.
if [ -x "$TASK_DIR/seed-home.sh" ]; then
  bash "$TASK_DIR/seed-home.sh" "$SCRATCH_HOME"
fi
export ONOFF_CELL_HOME="$SCRATCH_HOME"

# ── prompt: task.md VERBATIM — byte-identical across arms, no artifacts contract ──
PROMPT_FILE="$OUT_DIR/prompt.md"
if [ -n "${ONOFF_PROMPT_PREFIX:-}" ]; then  # prereg amendments (w2a-g/w2b-g amend-2): identical invocation preface in BOTH arms
  { printf '%s\n\n' "$ONOFF_PROMPT_PREFIX"; cat "$TASK_DIR/task.md"; } > "$PROMPT_FILE"
else
  cp "$TASK_DIR/task.md" "$PROMPT_FILE"
fi

TRANSCRIPT="$OUT_DIR/transcript.jsonl"
RAW_ERR="$OUT_DIR/stderr.log"
TIMEOUT_LIMIT="${ONOFF_TIMEOUT:-10m}"
START_TIME=$(date +%s)

# ── instrument self-check: scripts the skill text addresses as <plugin>/scripts/... must load from THIS scratch plugin ──
# (stage-graph-g67 v1: session-mode.js was absent from the plugin, so G6 ON cells measured the instrument, not the text.)
PREFLIGHT_FAIL=""
if [ -n "${ONOFF_REQUIRE_PLUGIN_SCRIPTS:-}" ]; then
  IFS=, read -ra REQ_SCRIPTS <<< "$ONOFF_REQUIRE_PLUGIN_SCRIPTS"
  for rs in "${REQ_SCRIPTS[@]}"; do
    case "$rs" in /*|*..*|"") PREFLIGHT_FAIL="bad required script path: $rs"; break ;; esac
    # fresh empty cwd + scratch HOME: require-time side effects can never land in the eval checkout. A script that guards its
    # main with `require.main === module` (session-mode.js does) only loads its require graph here; main never runs.
    if ! ( cd "$(mktemp -d -p "$SCRATCH_HOME" preflight-XXXXXX)" && HOME="$SCRATCH_HOME" node -e 'require(require("path").join(process.argv[1], process.argv[2]))' "$SCRATCH_PLUGIN" "$rs" ) > "$OUT_DIR/preflight.log" 2>&1; then
      PREFLIGHT_FAIL="plugin script does not load: $rs"; break
    fi
  done
  [ -z "$PREFLIGHT_FAIL" ] || echo "preflight: $PREFLIGHT_FAIL" >> "$OUT_DIR/preflight.log"
fi

# One model turn. $1 prompt file, $2 transcript path, $3 "1" or "2", $4 resume session id (turn 2, cc only).
run_model_turn() {
  local prompt="$1" dest="$2" turn_n="$3" resume="${4:-}"
  if [ "$RUNNER" = "cc" ]; then
    (
      cd "$TEMP_REPO"
      export HOME="$SCRATCH_HOME"
      export CLAUDE_CONFIG_DIR="$SCRATCH_CONFIG"
      # Config follows the scratch HOME. A caller-exported AUTOPILOT_CONFIG_FILE
      # would point the cell at another home's config (the test harness file, or
      # the operator file). a task may plant config here.
      unset AUTOPILOT_CONFIG_FILE
      if [ -n "$resume" ]; then
        timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" --resume "$resume" \
          --plugin-dir "$SCRATCH_PLUGIN" \
          --setting-sources project --strict-mcp-config --dangerously-skip-permissions \
          --output-format stream-json --verbose < "$prompt"
      else
        timeout "$TIMEOUT_LIMIT" claude -p --model "$MODEL" \
          --plugin-dir "$SCRATCH_PLUGIN" \
          --setting-sources project --strict-mcp-config --dangerously-skip-permissions \
          --output-format stream-json --verbose < "$prompt"
      fi
    ) > "$dest" 2>> "$RAW_ERR"
  else
    (
      cd "$TEMP_REPO"
      export HOME="$SCRATCH_HOME"
      export CLAUDE_CONFIG_DIR="$SCRATCH_CONFIG"
      unset AUTOPILOT_CONFIG_FILE
      export ONOFF_ARM="$ARM" ONOFF_TASK="$TASK_ID" ONOFF_PLUGIN_DIR="$SCRATCH_PLUGIN"
      export ONOFF_TURN="$turn_n"
      timeout "$TIMEOUT_LIMIT" "$ONOFF_STUB_BIN" "$prompt"
    ) > "$dest" 2>> "$RAW_ERR"
  fi
}

set +e
RESUME_UNAVAILABLE=0
TURN2_STATE=""
: > "$RAW_ERR"
if [ -n "$PREFLIGHT_FAIL" ]; then
  : > "$TRANSCRIPT"; RUN_EXIT=0   # the agent is never started
elif [ "$RUNNER" = "cc" ]; then
  run_model_turn "$PROMPT_FILE" "$TRANSCRIPT" 1 ""
  RUN_EXIT=$?
else
  [ -n "${ONOFF_STUB_BIN:-}" ] || { echo "ERROR: ONOFF_STUB_BIN not set for stub runner" >&2; exit 2; }
  run_model_turn "$PROMPT_FILE" "$TRANSCRIPT" 1 ""
  RUN_EXIT=$?
fi

# Second turn is opt-in: an executable turn2.sh. Tasks without one keep the single transcript.
# Snapshot first, including when turn 2 does not run or is skipped (for example the nohook arm:
# turn 2 prints no body, state skipped_no_card). The snapshot is still taken, and equals the final state.
DCARD_DECISIONS_PRE_TURN2=""
TURN2_SH_EXIT=""
if [ -x "$TASK_DIR/turn2.sh" ]; then
  DCARD_DECISIONS_PRE_TURN2="$OUT_DIR/decisions-pre-turn2"
  rm -rf "$DCARD_DECISIONS_PRE_TURN2"
  mkdir -p "$DCARD_DECISIONS_PRE_TURN2/live" "$DCARD_DECISIONS_PRE_TURN2/git"
  _snap_glob="${ONOFF_DECISION_GLOB:-*decision*.json}"
  if [ -n "${AUTOPILOT_LIVE_DIR:-}" ] && [ -d "$AUTOPILOT_LIVE_DIR" ]; then
    while IFS= read -r _snap_f; do
      [ -n "$_snap_f" ] || continue
      _snap_rel="${_snap_f#"$AUTOPILOT_LIVE_DIR"/}"
      mkdir -p "$DCARD_DECISIONS_PRE_TURN2/live/$(dirname "$_snap_rel")"
      cp -a "$_snap_f" "$DCARD_DECISIONS_PRE_TURN2/live/$_snap_rel"
    done < <(find "$AUTOPILOT_LIVE_DIR" -type f -name "$_snap_glob" 2>/dev/null || true)
  fi
  _snap_common=$(git -C "$TEMP_REPO" rev-parse --git-common-dir 2>/dev/null || true)
  if [ -n "$_snap_common" ]; then
    case "$_snap_common" in
      /*) ;;
      *) _snap_common="$TEMP_REPO/$_snap_common" ;;
    esac
    _snap_common=$(cd "$_snap_common" 2>/dev/null && pwd) || _snap_common=""
  fi
  if [ -n "$_snap_common" ] && [ -d "$_snap_common/autopilot/decisions" ]; then
    find "$_snap_common/autopilot/decisions" -maxdepth 1 -type f -name '*.json' -exec cp -a {} "$DCARD_DECISIONS_PRE_TURN2/git/" \;
  fi
  unset _snap_glob _snap_f _snap_rel _snap_common
fi
if [ -z "$PREFLIGHT_FAIL" ] && [ -x "$TASK_DIR/turn2.sh" ]; then
  TURN1_FILE="$OUT_DIR/transcript.turn1.jsonl"
  TURN2_FILE="$OUT_DIR/transcript.turn2.jsonl"
  cp "$TRANSCRIPT" "$TURN1_FILE"
  : > "$TURN2_FILE"
  TURN2_PROMPT_BODY=$(cd "$TEMP_REPO" && bash "$TASK_DIR/turn2.sh" 2>> "$RAW_ERR")
  TURN2_SH_EXIT=$?
  if [ "$TURN2_SH_EXIT" -ne 0 ]; then
    RUN_EXIT=$TURN2_SH_EXIT
    TURN2_STATE=ran
  elif [ -z "$(printf '%s' "$TURN2_PROMPT_BODY" | tr -d '[:space:]')" ]; then
    TURN2_STATE=skipped_no_card
    cp "$TURN1_FILE" "$TRANSCRIPT"
  else
    TURN2_STATE=ran
    TURN2_PROMPT="$OUT_DIR/prompt.turn2.md"
    printf '%s\n' "$TURN2_PROMPT_BODY" > "$TURN2_PROMPT"
    if [ "$RUNNER" = "cc" ]; then
      SESSION_ID=$(node -e '
        let sid="";
        try {
          for (const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n")) {
            let j; try { j=JSON.parse(l); } catch { continue; }
            if (j && j.type==="system" && j.subtype==="init" && typeof j.session_id==="string" && j.session_id) { sid=j.session_id; break; }
          }
        } catch {}
        process.stdout.write(sid);
      ' "$TURN1_FILE")
      if [ -z "$SESSION_ID" ]; then
        RESUME_UNAVAILABLE=1
      else
        run_model_turn "$TURN2_PROMPT" "$TURN2_FILE" 2 "$SESSION_ID"
        RUN2_EXIT=$?
        [ "$RUN_EXIT" -eq 0 ] && RUN_EXIT=$RUN2_EXIT
      fi
    else
      run_model_turn "$TURN2_PROMPT" "$TURN2_FILE" 2 ""
      RUN2_EXIT=$?
      [ "$RUN_EXIT" -eq 0 ] && RUN_EXIT=$RUN2_EXIT
    fi
    cat "$TURN1_FILE" "$TURN2_FILE" > "$TRANSCRIPT"
  fi
  export TRANSCRIPT_TURN1="$TURN1_FILE" TRANSCRIPT_TURN2="$TURN2_FILE" DCARD_TURN2="$TURN2_STATE"
fi
set -e
END_TIME=$(date +%s)

# ── markers (deterministic; task-owned) ──
MARKERS_OUT="$OUT_DIR/markers.env"
set +e
export ONOFF_OUT="$OUT_DIR" ONOFF_CELL_HOME="$SCRATCH_HOME"
(
  cd "$TEMP_REPO"
  TRANSCRIPT="$TRANSCRIPT" TRANSCRIPT_TURN1="${TRANSCRIPT_TURN1:-}" TRANSCRIPT_TURN2="${TRANSCRIPT_TURN2:-}" \
  DCARD_TURN2="${DCARD_TURN2:-}" DCARD_DECISIONS_PRE_TURN2="${DCARD_DECISIONS_PRE_TURN2:-}" \
  FROZEN_BASE_SHA="$FROZEN_BASE_SHA" \
  QUERY="$BASE_DIR/lib/transcript-query.js" ONOFF_LIB="${ONOFF_LIB_OVERRIDE:-$BASE_DIR/lib}" \
    bash "$TASK_DIR/markers.sh"
  # optional second marker file (P1W rows add markers to a task without touching its markers.sh)
  if [ -f "$TASK_DIR/markers-extra.sh" ]; then
    TRANSCRIPT="$TRANSCRIPT" TRANSCRIPT_TURN1="${TRANSCRIPT_TURN1:-}" TRANSCRIPT_TURN2="${TRANSCRIPT_TURN2:-}" \
    DCARD_TURN2="${DCARD_TURN2:-}" DCARD_DECISIONS_PRE_TURN2="${DCARD_DECISIONS_PRE_TURN2:-}" \
    FROZEN_BASE_SHA="$FROZEN_BASE_SHA" \
    QUERY="$BASE_DIR/lib/transcript-query.js" ONOFF_LIB="${ONOFF_LIB_OVERRIDE:-$BASE_DIR/lib}" \
      bash "$TASK_DIR/markers-extra.sh"
  fi
) > "$MARKERS_OUT" 2>> "$RAW_ERR"
MARKERS_EXIT=$?
set -e

# ── manipulation check: dev-flow Skill invocation observed in transcript ──
skill_invoked_devflow="false"
if node "$BASE_DIR/lib/transcript-query.js" "$TRANSCRIPT" skill-invoked "${CHECK_SKILL:-dev-flow}" >/dev/null 2>&1; then
  skill_invoked_devflow="true"
fi

# ── failure classification (closed vocabulary; content-free) ──
# claude -p reports login/limit failures as the terminal {"type":"result","is_error":true} line on stdout, not on stderr
# (stage-graph runs: the OAuth expiry cells were classified runner_error). Only that terminal line counts: tool_result
# lines also carry is_error:true and hold arbitrary tool output (code that may say "quota"). No terminal error line = no
# auth/quota verdict from stdout.
TERMINAL_ERR="$(node -e '
  let out="";
  try{for(const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n")){
    let j;try{j=JSON.parse(l)}catch{continue}
    if(j&&j.type==="result"&&j.is_error===true) out=String(j.result||"")+" "+String(j.subtype||"");
  }}catch{}
  process.stdout.write(out);' "$TRANSCRIPT" 2>/dev/null || true)"
ERR_TEXT="$(cat "$RAW_ERR" 2>/dev/null || true)
$TERMINAL_ERR"
AUTH_RE='(^|[^a-z])(unauthorized|forbidden|authentication|invalid[ _-]?(api[ _-]?)?key|login required|token expired|oauth token has expired|please run /login|not logged in)([^a-z]|$)'
QUOTA_RE='(usage limit|weekly limit|rate limit|limit reached|hit your limit|quota|credit balance)'
failure_class="null"; failure_cause="null"; STOPPED_BY_TIMEOUT=0
if [ -n "$PREFLIGHT_FAIL" ]; then
  failure_class='"infra_fail"'; failure_cause='"plugin_script_unresolvable"'
elif [ "$RESUME_UNAVAILABLE" -eq 1 ]; then
  failure_class='"infra_fail"'; failure_cause='"resume_unavailable"'
elif [ "${ONOFF_TIMEOUT_IS_COMPLETE:-0}" = 1 ] && { [ "$RUN_EXIT" -eq 124 ] || [ "$RUN_EXIT" -eq 137 ]; } \
    && [ -s "$TRANSCRIPT" ] && [ "$MARKERS_EXIT" -eq 0 ]; then
  # stage-graph-g67: the markers only need the first minutes, so the per-cell timeout is the registered stop, not a failure.
  # Default off (every other row keeps timeout = infra_fail). The row says so: "stopped_by_timeout":true.
  STOPPED_BY_TIMEOUT=1
elif [ "$RUN_EXIT" -eq 124 ] || [ "$RUN_EXIT" -eq 137 ]; then
  failure_class='"infra_fail"'; failure_cause='"runner_timeout"'
elif [ "$RUN_EXIT" -ne 0 ] && printf '%s\n' "$ERR_TEXT" | grep -Eqi "$QUOTA_RE"; then
  # BL-0112: the matrix driver stops the whole campaign on this cause instead of burning every remaining cell.
  failure_class='"infra_fail"'; failure_cause='"quota"'
elif [ "$RUN_EXIT" -ne 0 ] && printf '%s\n' "$ERR_TEXT" | grep -Eqi "$AUTH_RE"; then
  failure_class='"infra_fail"'; failure_cause='"authentication"'
elif [ "$RUN_EXIT" -ne 0 ]; then
  failure_class='"infra_fail"'; failure_cause='"runner_error"'
elif [ ! -s "$TRANSCRIPT" ]; then
  failure_class='"infra_fail"'; failure_cause='"empty_output"'
elif [ "$MARKERS_EXIT" -ne 0 ]; then
  failure_class='"infra_fail"'; failure_cause='"marker_error"'
fi

runner_version="null"
if [ "$RUNNER" = "cc" ]; then
  runner_version=$(claude --version 2>/dev/null | head -n 1 || echo "unknown")
fi
runner_version_clean=$(printf '%s' "$runner_version" | tr -d '"\\' | head -c 120)

# markers.env (marker_x=true|false lines) → JSON object
markers_json=$(node -e '
  const fs=require("fs");
  const out={};
  try{
    for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){
      const m=line.match(/^marker_([a-z0-9_]+)=(true|false)$/);
      if(m) out[m[1]]=m[2]==="true";
    }
  }catch{}
  process.stdout.write(JSON.stringify(out));
' "$MARKERS_OUT")

cp -r "$CELL_STATE"/. "$OUT_DIR/state/" 2>/dev/null || true

# E5: legacy rows keep the dev-flow-only field byte-identically; --check-skill/--skill rows carry
# "skill_invoked" + "check_skill" for the target skill instead.
if [ -n "$CHECK_SKILL" ]; then
  INVOKED_FIELDS=$(printf '"skill_invoked":%s,"check_skill":"%s"' "$skill_invoked_devflow" "$CHECK_SKILL")
else
  INVOKED_FIELDS=$(printf '"skill_invoked_devflow":%s' "$skill_invoked_devflow")
fi
# Arm-manifest rows additionally carry the sha256 of the manifest file they ran under, so
# scripts/check-guidance-eval.js can refuse a results file produced by a different arm.
ARM_SHA_FIELD=""
if [ -n "$ARM_MANIFEST" ]; then
  if command -v sha256sum >/dev/null 2>&1; then ARM_SHA=$(sha256sum "$ARM_MANIFEST" | cut -d' ' -f1)
  else ARM_SHA=$(shasum -a 256 "$ARM_MANIFEST" | cut -d' ' -f1); fi
  ARM_SHA_FIELD=$(printf ',"arm_manifest_sha256":"%s"' "$ARM_SHA")
fi
[ "$STOPPED_BY_TIMEOUT" -eq 0 ] || ARM_SHA_FIELD="$ARM_SHA_FIELD,\"stopped_by_timeout\":true"
# turn2 and turn2_exit are emitted only for tasks that ship an executable turn2.sh
# (other rows stay byte-identical). turn2_exit is the turn2.sh status, 0 when it ran clean.
if [ -n "$TURN2_STATE" ]; then
  ARM_SHA_FIELD="$ARM_SHA_FIELD,\"turn2\":\"$TURN2_STATE\",\"turn2_exit\":${TURN2_SH_EXIT:-0}"
fi
RESULT_JSON="$OUT_DIR/result.json"
printf '{"task_id":"%s","arm":"%s","model":"%s","runner":"%s","runner_version":"%s","rep":%s,"duration_s":%s,"frozen_base_sha":"%s","markers":%s,%s,"failure_class":%s,"failure_cause":%s%s}\n' \
  "$TASK_ID" "$ARM" "$MODEL" "$RUNNER" "$runner_version_clean" "$REP" \
  "$((END_TIME - START_TIME))" "$FROZEN_BASE_SHA" "$markers_json" \
  "$INVOKED_FIELDS" "$failure_class" "$failure_cause" "$ARM_SHA_FIELD" > "$RESULT_JSON"

cat "$RESULT_JSON"
