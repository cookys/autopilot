#!/usr/bin/env bash
# d0-probe.sh -- D0 measurement gate of docs/plans/2026-10-13-dispatch-tree.md (section 4 "D0", section 7 rows a-l).
#
# Runs each section-7 Unknown against the REAL claude CLI and the REAL dispatch rails, then writes
# d0-result.json (one {row, status: pass|bad|not_run, evidence} per row, plus a per-row detail object) and the
# raw dumps (redacted) next to it. No product code is changed; nothing here is a hooks/tests suite.
#
# Rows: a b c d1 d2 e f g h i j k l (l = 3d live check: AUTOPILOT_CHILD_SESSION_ID reaches a hetero cc-shim child's hook env;
#   a real tmux started inside it keeps it, yet a new top-level claude there writes a marker with no parent).
# d2 judges the post-3d rule: the inner marker of a non-Claude harness carries no parent_session_id.
#   bash d0-probe.sh --out <evidence>/d0-result.json [--rows a,b,...] [--omit-sentinel] [--keep-scratch]
#
# Exit 0 when every requested row came back pass|bad|not_run (a bad row is a RESULT, not a probe failure).
# Exit 1 on a probe malfunction (a row left no verdict, secret scan hit, ...).
# --omit-sentinel (negative control): row a only, with no sentinel hook and AUTOPILOT_RUNS_WATCH_AUTOSTART=0;
#   it must come back `bad` (exit 0) -- a probe that cannot go red is not an instrument. Exit 1 if it passes.
#
# ISOLATION (hard rules, enforced here):
#   - the real ~/.claude is never handed to a child: CLAUDE_CONFIG_DIR is a scratch dir seeded ONLY with a COPY of
#     .credentials.json (cp, no symlink); HOME is a scratch dir; every claude child starts under `env -i`.
#   - the real ~/.kimi-code is never touched (kimi is not run: row d2 records not_run for it).
#   - the real ~/.autopilot is never written: session-mode dir, live dir, dispatch runs dir are scratch. The ONLY
#     read of it is endpoints.env (AUTOPILOT_ENDPOINTS_ENV) so the cc-shim rows can use the minimax seat; the token
#     values live only in child process environments and are redacted from every dump.
#   - at most 2 claude processes at a time (d2/f chains are outer+inner); every call has a timeout.
#   - scratch (including the copied credentials) is deleted on exit unless --keep-scratch.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SELF/../../../.." && pwd)"
OUT="$SELF/d0-result.json"; ROWS="a,b,c,d1,d2,e,f,g,h,i,j,k,l"; OMIT=0; KEEP=0; CLAUDE_T=150; RAW_OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?}"; shift 2 ;;
    --rows) ROWS="${2:?}"; shift 2 ;;
    --raw-dir) RAW_OUT="${2:?}"; shift 2 ;;
    --omit-sentinel) OMIT=1; shift ;;
    --keep-scratch) KEEP=1; shift ;;
    --claude-timeout) CLAUDE_T="${2:?}"; shift 2 ;;
    -h|--help) sed -n 2,22p "$0"; exit 0 ;;
    *) echo "d0-probe: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$OMIT" -eq 1 ] && ROWS="a"
[ -n "$RAW_OUT" ] || RAW_OUT="$(dirname "$OUT")/d0-raw"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
case "$RAW_OUT" in /*) ;; *) RAW_OUT="$PWD/$RAW_OUT" ;; esac

REAL_HOME="$HOME"
REAL_CLAUDE="$(command -v claude)" || { echo "d0-probe: claude not on PATH" >&2; exit 2; }
[ -r "$REAL_HOME/.claude/.credentials.json" ] || { echo "d0-probe: no ~/.claude/.credentials.json to copy" >&2; exit 2; }
for t in node jq git; do command -v "$t" >/dev/null || { echo "d0-probe: $t missing" >&2; exit 2; }; done

SCR="$(mktemp -d -t d0probe-XXXXXX)"; chmod 700 "$SCR"
RAW="$SCR/raw"; ROWD="$SCR/rows"; mkdir -p "$RAW" "$ROWD" "$SCR/home" "$SCR/bin" "$SCR/js"
LIVE="$(mktemp -d -p /dev/shm d0probe-live-XXXXXX 2>/dev/null || mktemp -d -t d0probe-live-XXXXXX)"; chmod 700 "$LIVE"
MODE_DIR="$SCR/session-mode"; RUNS_DIR="$SCR/runs"; mkdir -p "$MODE_DIR" "$RUNS_DIR"
CFG="$SCR/cfg-main"; mkdir -p "$CFG"; chmod 700 "$CFG"
cp "$REAL_HOME/.claude/.credentials.json" "$CFG/.credentials.json"; chmod 600 "$CFG/.credentials.json"

log() { printf '[d0] %s\n' "$*" >&2; }

kill_scratch_procs() { # processes whose environment names this probe's scratch (watchers, stragglers): by PID, never by name
  local p envf
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"; [ "$p" = "$$" ] && continue
    envf="/proc/$p/environ"; [ -r "$envf" ] || continue
    if { tr '\0' '\n' < "$envf"; } 2>/dev/null | grep -qxF "AUTOPILOT_LIVE_DIR=$LIVE"; then kill "$p" 2>/dev/null || true; fi
  done
}
cleanup() {
  kill_scratch_procs
  if [ "$KEEP" -eq 0 ]; then rm -rf "$SCR" "$LIVE"; else log "scratch kept: $SCR (holds a copy of the credentials; delete it)"; fi
}
trap cleanup EXIT

# --------------------------------------------------------------------------------------- helpers
uuid() { node -e 'process.stdout.write(require("crypto").randomUUID())'; }
GIT="git -c user.email=d0@probe -c user.name=d0 -c init.defaultBranch=develop -c commit.gpgsign=false"
mk_repo() { # <dir> -- an opted-in git repo (autopilot project config present, committed so worktrees inherit it)
  mkdir -p "$1/.claude"; $GIT -C "$1" init -q
  printf '# dispatch config (d0 probe fixture)\n' > "$1/.claude/dispatch-config.md"
  printf '#!/usr/bin/env bash\necho "ORIGIN=${AUTOPILOT_ORIGIN_AGENT_ID-<unset>} ARGS=$*"\n' > "$1/rail.sh"; chmod +x "$1/rail.sh"
  printf '.claude/settings.json\n' > "$1/.gitignore"
  $GIT -C "$1" add -A; $GIT -C "$1" commit -q -m base
}

# base environment of every claude child: nothing inherited from this (Claude Code) session
base_env() { # prints NAME=VALUE lines
  printf '%s\n' "PATH=$SCR/bin:$PATH" "HOME=$SCR/home" "TERM=dumb" "LANG=${LANG:-C.UTF-8}" "TMPDIR=${TMPDIR:-/tmp}" \
    "DISABLE_AUTOUPDATER=1" "CLAUDE_CONFIG_DIR=$CFG" \
    "AUTOPILOT_SESSION_MODE_DIR=$MODE_DIR" "AUTOPILOT_LIVE_DIR=$LIVE" "AUTOPILOT_DISPATCH_RUNS_DIR=$RUNS_DIR" \
    "AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S=2" "AUTOPILOT_GROK_EFFORT_PROBE=0" "DISPATCH_QUIET=1" \
    "BASH_DEFAULT_TIMEOUT_MS=300000" "BASH_MAX_TIMEOUT_MS=300000"
}
# run <timeout-s> <cwd> [VAR=val ...] -- cmd args...   (stdin passes through; never inherits the caller's env)
run() {
  local t="$1" cwd="$2"; shift 2
  local -a ev=(); while IFS= read -r l; do ev+=("$l"); done < <(base_env)
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do ev+=("$1"); shift; done
  shift
  ( cd "$cwd" && timeout "$t" env -i "${ev[@]}" "$@" )
}

rec() { # <row> <status> <evidence> [detail-json-file]
  local row="$1" st="$2" ev="$3" det="${4:-}"
  case "$st" in pass|bad|not_run) ;; *) echo "d0-probe: bad status $st for $row" >&2; return 1 ;; esac
  if [ -n "$det" ] && [ -s "$det" ]; then
    jq -n --arg row "$row" --arg st "$st" --arg ev "$ev" --slurpfile d "$det" '{row:$row,status:$st,evidence:$ev,detail:$d[0]}' > "$ROWD/$row.json"
  else
    jq -n --arg row "$row" --arg st "$st" --arg ev "$ev" '{row:$row,status:$st,evidence:$ev}' > "$ROWD/$row.json"
  fi
  log "row $row: $st -- $ev"
}

# ---- node helpers (written once) ------------------------------------------------------------------
cat > "$SCR/js/calls.js" <<'EOF'
// calls.js <transcript.jsonl>... : Bash tool calls (+ result/is_error) and Agent results (toolUseResult.agentId)
const fs = require('fs');
const out = { bash: [], agent_results: [] };
for (const f of process.argv.slice(2)) {
  let lines = []; try { lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch (_e) { continue; }
  const uses = new Map();
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch (_e) { continue; }
    const c = o.message && o.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'tool_use' && b.name === 'Bash') uses.set(b.id, { file: require('path').basename(f), id: b.id, command: b.input && b.input.command, is_error: null, result: null });
      if (b.type === 'tool_result') {
        const u = uses.get(b.tool_use_id);
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        if (u) { u.is_error = !!b.is_error; u.result = String(text).slice(0, 1500); }
        const t = o.toolUseResult;
        if (t && typeof t === 'object' && t.agentId) out.agent_results.push({ file: require('path').basename(f), tool_use_id: b.tool_use_id, agentId: t.agentId, status: t.status || null, isAsync: !!t.isAsync });
      }
    }
  }
  out.bash.push(...uses.values());
}
process.stdout.write(JSON.stringify(out));
EOF
cat > "$SCR/js/redact.js" <<'EOF'
// redact.js <dir> <secrets-json-file> : in-place redaction of every text file under dir; exit 3 if anything remains
const fs = require('fs'), path = require('path');
const secrets = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).filter(s => typeof s === 'string' && s.length >= 8);
const pats = [[/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-REDACTED'], [/Bearer\s+[A-Za-z0-9._~+\/=-]{8,}/g, 'Bearer REDACTED'], [/("(?:accessToken|refreshToken|access_token|refresh_token|api_key|apiKey)"\s*:\s*")[^"]+(")/g, '$1REDACTED$2']];
let hits = 0;
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n), st = fs.lstatSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!st.isFile()) continue;
    let s = fs.readFileSync(p, 'utf8'), o = s;
    for (const sec of secrets) s = s.split(sec).join('REDACTED');
    for (const [re, rep] of pats) s = s.replace(re, rep);
    if (s !== o) { fs.writeFileSync(p, s); hits++; }
    for (const sec of secrets) if (s.includes(sec)) { console.error('SECRET REMAINS in ' + p); process.exit(3); }
    if (/\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/.test(s)) { console.error('TOKEN-SHAPED TEXT REMAINS in ' + p); process.exit(3); }
  }
})(process.argv[2]);
console.log('redacted files: ' + hits);
EOF
cat > "$SCR/js/stamp-probe.js" <<'EOF'
// PreToolUse(Bash) probe hook for rows g-i. Mode via PROBE_HOOK_MODE:
//   both          : `echo A` -> `echo B`; `./rail.sh ...` -> `export AUTOPILOT_ORIGIN_AGENT_ID=<v>; ./rail.sh ...`
//   stamp-export  : only the export-prefix stamp (the plan's step 5 form)
//   stamp-inline  : `AUTOPILOT_ORIGIN_AGENT_ID=<v> ./rail.sh ...` (alternative form, informational)
//   none          : log only
// It NEVER returns permissionDecision (that is what row g/h/i measure).
const fs = require('fs');
let raw = ''; process.stdin.on('data', d => raw += d).on('end', () => {
  let p = {}; try { p = JSON.parse(raw); } catch (_e) { /* ignore */ }
  const cmd = (p.tool_input && p.tool_input.command) || '';
  const mode = process.env.PROBE_HOOK_MODE || 'none';
  try { fs.appendFileSync(`${process.env.PROBE_SENTINEL_DIR}/hook-${mode}.log`, JSON.stringify({ event: p.hook_event_name, tool: p.tool_name, agent_id: p.agent_id === undefined ? null : p.agent_id, agent_type: p.agent_type === undefined ? null : p.agent_type, command: cmd, payload_keys: Object.keys(p) }) + '\n'); } catch (_e) { /* ignore */ }
  const v = typeof p.agent_id === 'string' ? (/^[A-Za-z0-9_-]{1,64}$/.test(p.agent_id) ? p.agent_id : null) : 'session';
  let out = null;
  if (mode === 'both' && cmd === 'echo A') out = 'echo B';
  if ((mode === 'both' || mode === 'stamp-export') && /(^|[\s;])\.\/rail\.sh\b/.test(cmd) && v && !/AUTOPILOT_ORIGIN_AGENT_ID/.test(cmd)) out = `export AUTOPILOT_ORIGIN_AGENT_ID=${v}; ${cmd}`;
  if (mode === 'stamp-inline' && /(^|[\s;])\.\/rail\.sh\b/.test(cmd) && v && !/AUTOPILOT_ORIGIN_AGENT_ID/.test(cmd)) out = `AUTOPILOT_ORIGIN_AGENT_ID=${v} ${cmd}`;
  if (out !== null) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: Object.assign({}, p.tool_input, { command: out }) } }));
});
EOF
SENTINEL_HOOK_CMD='cat > "$PROBE_SENTINEL_DIR/$PROBE_TAG-HOOKNAME.json"; env | grep -E "^(AUTOPILOT_PARENT_SESSION_ID|AUTOPILOT_SESSION_MODE_DIR|CLAUDE_CODE_SESSION_ID|AUTOPILOT_PARENT_RUN_ID|HOME)=" > "$PROBE_SENTINEL_DIR/$PROBE_TAG-HOOKNAME.env"'
sentinel_settings() { # <hookname> -> settings JSON with a SessionStart sentinel hook
  jq -n --arg c "${SENTINEL_HOOK_CMD//HOOKNAME/$1}" '{hooks:{SessionStart:[{hooks:[{type:"command",command:$c,timeout:5}]}]}}'
}
mk_mini_plugin() { # <dir> <name>
  mkdir -p "$1/.claude-plugin" "$1/hooks"
  printf '{"name":"%s","version":"0.0.1","description":"d0 sentinel plugin"}\n' "$2" > "$1/.claude-plugin/plugin.json"
  jq -n --arg c "${SENTINEL_HOOK_CMD//HOOKNAME/plugin-$2}" '{hooks:{SessionStart:[{hooks:[{type:"command",command:$c,timeout:5}]}]}}' > "$1/hooks/hooks.json"
}
json_file_field() { # <file> <js-expression over o> -> value or empty
  node -e 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);process.stdout.write(v==null?"":String(v))}catch(e){}' "$1" "$2"
}
copy_raw() { # <row> files... (missing files skipped)
  local row="$1"; shift; mkdir -p "$RAW/$row"; local f
  for f in "$@"; do [ -e "$f" ] && cp -r "$f" "$RAW/$row/" 2>/dev/null || true; done
}
session_transcripts() { # <config-dir> <session-id> -> main + subagent transcripts
  local d; d="$(find "$1/projects" -name "$2.jsonl" 2>/dev/null | head -1)"
  [ -n "$d" ] || return 0
  printf '%s\n' "$d"; ls "${d%.jsonl}"/subagents/agent-*.jsonl 2>/dev/null || true
}

# one-time scratch setup shared by rows --------------------------------------------------------------
mk_mini_plugin "$SCR/mini-dir" d0dir
mk_mini_plugin "$SCR/mkt/plugins/d0user" d0user
mkdir -p "$SCR/mkt/.claude-plugin"
printf '{"name":"d0mkt","owner":{"name":"d0"},"plugins":[{"name":"d0user","source":"./plugins/d0user","description":"d0"}]}\n' > "$SCR/mkt/.claude-plugin/marketplace.json"
if [ "$OMIT" -eq 0 ]; then
  ( cd "$SCR" && run 60 "$SCR" -- "$REAL_CLAUDE" plugin marketplace add "$SCR/mkt" && run 60 "$SCR" -- "$REAL_CLAUDE" plugin install d0user@d0mkt ) > "$SCR/plugin-install.log" 2>&1 \
    || log "user-scope mini plugin install failed (row b user-plugin column will say not measured)"
fi
sentinel_settings settings-flag > "$SCR/settings-flag.json"
node -e 'process.stdout.write(JSON.stringify({a:1}))' >/dev/null

CLAUDE_VERSION="$("$REAL_CLAUDE" --version 2>/dev/null | head -1)"

# ====================================================================================== row a
row_a() {
  local repo="$SCR/repo-a" sent="$SCR/sent-a" u; u="$(uuid)"; mkdir -p "$sent"; mk_repo "$repo"
  local -a ev=("PROBE_SENTINEL_DIR=$sent" "PROBE_TAG=a")
  if [ "$OMIT" -eq 1 ]; then ev+=("AUTOPILOT_RUNS_WATCH_AUTOSTART=0")
  else sentinel_settings cwd-settings > "$repo/.claude/settings.json"; fi
  local prompt='Use the Bash tool exactly once to run this command and nothing else: printenv CLAUDE_CODE_SESSION_ID > "$PROBE_SENTINEL_DIR/a-bash-env.txt" ; after it finishes, reply with the single word DONE.'
  run "$CLAUDE_T" "$repo" "${ev[@]}" -- "$REAL_CLAUDE" -p --session-id "$u" --model haiku --plugin-dir "$REPO" --allowedTools Bash \
    --output-format stream-json --verbose "$prompt" > "$SCR/a.out" 2> "$SCR/a.err"; local rc=$?
  sleep 3; kill_scratch_procs
  local sent_sid="" sent_ok=false marker=false marker_parent="" benv=""
  [ -f "$sent/a-cwd-settings.json" ] && sent_sid="$(json_file_field "$sent/a-cwd-settings.json" 'o.session_id')"
  [ "$sent_sid" = "$u" ] && sent_ok=true
  [ -f "$MODE_DIR/$u.json" ] && { marker=true; marker_parent="$(json_file_field "$MODE_DIR/$u.json" 'o.parent_session_id')"; }
  [ -f "$sent/a-bash-env.txt" ] && benv="$(tr -d '\n' < "$sent/a-bash-env.txt")"
  local fires=false; { [ "$sent_ok" = true ] || [ "$marker" = true ]; } && fires=true
  jq -n --arg u "$u" --argjson rc "$rc" --argjson sent "$sent_ok" --arg ssid "$sent_sid" --argjson marker "$marker" --arg mp "$marker_parent" --arg benv "$benv" --argjson omit "$OMIT" \
    '{session_id_passed:$u,claude_rc:$rc,sentinel_hook_fired_with_payload_id:$sent,sentinel_payload_session_id:$ssid,plugin_path_marker_written:$marker,marker_parent_session_id:$mp,bash_CLAUDE_CODE_SESSION_ID:$benv,omit_sentinel_negative_control:($omit==1)}' > "$SCR/a.detail.json"
  copy_raw a "$sent" "$SCR/a.out" "$SCR/a.err" "$MODE_DIR/$u.json"
  if [ "$fires" = true ] && [ "$benv" = "$u" ]; then rec a pass "SessionStart fired with payload id == --session-id (sentinel=$sent_ok, plugin marker=$marker) and the Bash tool saw CLAUDE_CODE_SESSION_ID == --session-id" "$SCR/a.detail.json"
  else rec a bad "SessionStart evidence=$fires (sentinel=$sent_ok, plugin marker=$marker); Bash CLAUDE_CODE_SESSION_ID='${benv:-<none>}' vs passed $u" "$SCR/a.detail.json"; fi
}

# ====================================================================================== row b
# Four real launches (author/review x claude-native/cc-shim) through the real rails; the wrapper `claude` (put on
# the rail's --bin) records the rail's own argv/env, then adds the three mechanisms step 3a would add (a --settings
# flag hook, a <cwd>/.claude/settings.json hook, a --plugin-dir plugin) and execs the real claude. Each mechanism
# writes its own sentinel named <tag>-<mechanism>.json. cc-shim shapes keep the rail's HOME redirect and run with
# no CLAUDE_CONFIG_DIR (so the user-scope plugin is absent exactly as in production) and the minimax endpoint.
mk_wrapper() { # <path> : wrapper claude
  cat > "$1" <<EOF
#!/usr/bin/env bash
# d0 wrapper: log the rail's launch, add the step-3a candidate mechanisms, exec the real claude
mkdir -p "\$PROBE_SENTINEL_DIR"
{
  echo "cwd=\$PWD"; echo "HOME=\$HOME"; echo "CLAUDE_CONFIG_DIR=\${CLAUDE_CONFIG_DIR-<unset>}"
  echo "AUTOPILOT_PARENT_SESSION_ID=\${AUTOPILOT_PARENT_SESSION_ID-<unset>}"; echo "CLAUDE_CODE_SESSION_ID=\${CLAUDE_CODE_SESSION_ID-<unset>}"
  echo "AUTOPILOT_SESSION_MODE_DIR=\${AUTOPILOT_SESSION_MODE_DIR-<unset>}"
  printf 'ARGV:'; printf ' [%s]' "\$@"; echo
} > "\$PROBE_SENTINEL_DIR/\$PROBE_TAG.wrapper.txt"
mkdir -p "\$PWD/.claude"
cp "$SCR/cwd-settings-\$PROBE_TAG.json" "\$PWD/.claude/settings.json"
EXTRA=(--settings "$SCR/settings-flag.json" --plugin-dir "$SCR/mini-dir")
[ -n "\${PROBE_ADD_AUTOPILOT_PLUGIN:-}" ] && EXTRA+=(--plugin-dir "$REPO")
exec "$REAL_CLAUDE" "\$@" "\${EXTRA[@]}"
EOF
  chmod +x "$1"
}
row_b() {
  local sent="$SCR/sent-b" repo="$SCR/repo-b"; mkdir -p "$sent"; mk_repo "$repo"
  mk_wrapper "$SCR/bin-wrap-claude"; cp "$SCR/bin-wrap-claude" "$SCR/wrap-claude"
  printf 'say ok\n' > "$SCR/b-prompt.txt"; printf '+x\n' > "$SCR/b-diff.txt"
  local shape tag P rc parent_file
  P="$(uuid)"
  jq -n '{}' > "$SCR/b.shapes.json"
  for shape in author-native review-native author-ccshim review-ccshim; do
    tag="b-$shape"; sentinel_settings cwd-settings > "$SCR/cwd-settings-$tag.json"
    local -a ev=("PROBE_SENTINEL_DIR=$sent" "PROBE_TAG=$tag" "CLAUDE_CODE_SESSION_ID=$P" "AUTOPILOT_ENDPOINTS_ENV=$REAL_HOME/.autopilot/endpoints.env")
    local -a cmd
    case "$shape" in
      author-native) cmd=(bash "$REPO/scripts/dispatch-author.sh" --runner claude-native --model haiku --prompt-file "$SCR/b-prompt.txt" --bin "$SCR/wrap-claude") ;;
      review-native) cmd=(bash "$REPO/scripts/dispatch-review.sh" --runner claude-native --model haiku --diff-file "$SCR/b-diff.txt" --bin "$SCR/wrap-claude") ;;
      author-ccshim) cmd=(bash "$REPO/scripts/dispatch-author.sh" --runner cc-shim --model MiniMax-M3 --endpoint minimax --prompt-file "$SCR/b-prompt.txt" --bin "$SCR/wrap-claude") ;;
      review-ccshim) cmd=(bash "$REPO/scripts/dispatch-review.sh" --runner cc-shim --model MiniMax-M3 --endpoint minimax --diff-file "$SCR/b-diff.txt" --bin "$SCR/wrap-claude") ;;
    esac
    # cc-shim: no CLAUDE_CONFIG_DIR (the rail's HOME redirect is the config home, as in production)
    local runs="$SCR/runs-b-$shape"; mkdir -p "$runs"
    case "$shape" in
      *ccshim) run 240 "$repo" "${ev[@]}" "AUTOPILOT_DISPATCH_RUNS_DIR=$runs" "CLAUDE_CONFIG_DIR=" -- env -u CLAUDE_CONFIG_DIR "${cmd[@]}" > "$SCR/$tag.stdout" 2> "$SCR/$tag.stderr"; rc=$? ;;
      *)        run 240 "$repo" "${ev[@]}" "AUTOPILOT_DISPATCH_RUNS_DIR=$runs" -- "${cmd[@]}" > "$SCR/$tag.stdout" 2> "$SCR/$tag.stderr"; rc=$? ;;
    esac
    local mf csid; mf="$(find "$runs" -name '*.manifest.json' | head -1)"; csid=""
    [ -n "$mf" ] && csid="$(json_file_field "$mf" 'o.child_session_id')"
    local f_settings=false f_cwd=false f_plugdir=false f_user=false sid_settings="" sid_cwd="" envp="" menv=""
    [ -f "$sent/$tag-settings-flag.json" ] && { f_settings=true; sid_settings="$(json_file_field "$sent/$tag-settings-flag.json" 'o.session_id')"; }
    [ -f "$sent/$tag-cwd-settings.json" ] && { f_cwd=true; sid_cwd="$(json_file_field "$sent/$tag-cwd-settings.json" 'o.session_id')"; }
    [ -f "$sent/$tag-plugin-d0dir.json" ] && f_plugdir=true
    [ -f "$sent/$tag-plugin-d0user.json" ] && f_user=true
    [ -f "$sent/$tag-settings-flag.env" ] && envp="$(grep -c '^AUTOPILOT_PARENT_SESSION_ID=' "$sent/$tag-settings-flag.env")"
    [ -f "$sent/$tag-settings-flag.env" ] && menv="$(grep '^AUTOPILOT_SESSION_MODE_DIR=' "$sent/$tag-settings-flag.env" | head -1)"
    jq --arg k "$shape" --argjson rc "$rc" --arg csid "$csid" --argjson fs "$f_settings" --argjson fc "$f_cwd" --argjson fp "$f_plugdir" --argjson fu "$f_user" \
       --arg ss "$sid_settings" --arg sc "$sid_cwd" --arg envp "${envp:-0}" --arg menv "$menv" --arg wrapper "$(grep -c . "$sent/$tag.wrapper.txt" 2>/dev/null || echo 0)" \
       '.[$k]={rail_rc:$rc,manifest_child_session_id:$csid,wrapper_reached:($wrapper!="0"),settings_flag_hook_fired:$fs,settings_flag_payload_id_matches_child_session_id:($fs and $ss==$csid and $csid!=""),cwd_settings_hook_fired:$fc,cwd_settings_payload_id_matches:($fc and $sc==$csid and $csid!=""),plugin_dir_hook_fired:$fp,user_scope_plugin_hook_fired:$fu,hook_sees_AUTOPILOT_PARENT_SESSION_ID:($envp!="0"),hook_sees_mode_dir:$menv}' "$SCR/b.shapes.json" > "$SCR/b.shapes.tmp" && mv "$SCR/b.shapes.tmp" "$SCR/b.shapes.json"
    copy_raw "b/$shape" "$sent"/$tag* "$SCR/$tag.stdout" "$SCR/$tag.stderr" "$mf"
  done
  jq '{shapes:., parent_session_id_exported_by_rails:"CLAUDE_CODE_SESSION_ID of the launcher is exported as AUTOPILOT_PARENT_SESSION_ID (check hook_sees_AUTOPILOT_PARENT_SESSION_ID)"}' "$SCR/b.shapes.json" > "$SCR/b.detail.json"
  local ok_all bad_list
  ok_all="$(jq -r '[.shapes[]|select(.wrapper_reached and (.settings_flag_payload_id_matches_child_session_id or .cwd_settings_payload_id_matches))]|length' "$SCR/b.detail.json")"
  bad_list="$(jq -r '[.shapes|to_entries[]|select((.value.wrapper_reached and (.value.settings_flag_payload_id_matches_child_session_id or .value.cwd_settings_payload_id_matches))|not)|.key]|join(",")' "$SCR/b.detail.json")"
  if [ "$ok_all" = 4 ]; then
    local flagdrop; flagdrop="$(jq -r '[.shapes|to_entries[]|select(.value.settings_flag_payload_id_matches_child_session_id|not)|.key]|join(",")' "$SCR/b.detail.json")"
    rec b pass "all 4 shapes: a hook fired with payload id == manifest child_session_id (--settings flag dropped in: ${flagdrop:-none})" "$SCR/b.detail.json"
  else rec b bad "no usable SessionStart hook mechanism in shapes: $bad_list" "$SCR/b.detail.json"; fi
}

# ====================================================================================== rows c + f (one real hetero cc-shim run)
# hetero cc-shim through the minimax endpoint; the wrapper (PATH `claude`) adds --plugin-dir <this repo> so the real
# autopilot SessionStart path runs (opted-in worktree). The child is asked to run a nested stub rail (a grok-stub
# dispatch-review) from its Bash -> row f (a rail from a rail's claude child). Row c: the child's own marker.
mk_inner_cmd() { # <script path> <out dir> <repo> : what a nested Claude's Bash runs
  cat > "$1" <<EOF
#!/usr/bin/env bash
# nested stub rail: dump the lineage-relevant env, then run a real dispatch-review with a stub grok runner
mkdir -p "$2"
for v in CLAUDE_CODE_SESSION_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_ROOT_RUN_ID; do
  printf '%s=%s\n' "\$v" "\${!v-<unset>}"
done > "$2/\${PROBE_TAG:-x}-inner-env.txt"
cd "$3" && bash "$REPO/scripts/dispatch-review.sh" --runner grok --model grok-4.5 --diff-file "$SCR/b-diff.txt" --bin "$SCR/grok-stub" > "$2/\${PROBE_TAG:-x}-inner-review.json" 2>&1
echo "inner-review rc=\$?" >> "$2/\${PROBE_TAG:-x}-inner-env.txt"
EOF
  chmod +x "$1"
  cat > "$SCR/grok-stub" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--list-models" ]; then printf 'Available models\n\ngrok-4.5 - Grok 4.5\n'; exit 0; fi
cat >/dev/null; echo "VERDICT: SHIP-AS-IS"; exit 0
EOS
  chmod +x "$SCR/grok-stub"
}
row_cf() {
  local sent="$SCR/sent-cf" repo="$SCR/repo-cf"; mkdir -p "$sent"; mk_repo "$repo"
  printf '+x\n' > "$SCR/b-diff.txt"
  mk_inner_cmd "$SCR/inner-cmd.sh" "$sent" "$repo"
  # PATH wrapper named `claude` for the rail (hetero has no --bin for cc-shim)
  mkdir -p "$SCR/bin-cf"; cat > "$SCR/bin-cf/claude" <<EOF
#!/usr/bin/env bash
mkdir -p "$sent"
{ echo "cwd=\$PWD"; echo "AUTOPILOT_PARENT_SESSION_ID=\${AUTOPILOT_PARENT_SESSION_ID-<unset>}"; echo "CLAUDE_CODE_SESSION_ID=\${CLAUDE_CODE_SESSION_ID-<unset>}"; printf 'ARGV:'; printf ' [%s]' "\$@"; echo; } > "$sent/cf.wrapper.txt"
exec "$REAL_CLAUDE" "\$@" --plugin-dir "$REPO"
EOF
  chmod +x "$SCR/bin-cf/claude"
  local P; P="$(uuid)"
  printf 'This is a measurement run. Do exactly one thing: use your Bash tool to run this single command, then stop and reply DONE:\nbash %s\nDo not edit any file and do not run anything else.\n' "$SCR/inner-cmd.sh" > "$SCR/cf-prompt.txt"
  local runs="$SCR/runs-cf"; mkdir -p "$runs"
  run 480 "$repo" "PATH=$SCR/bin-cf:$SCR/bin:$PATH" "CLAUDE_CODE_SESSION_ID=$P" "AUTOPILOT_DISPATCH_RUNS_DIR=$runs" "PROBE_TAG=cf" "PROBE_SENTINEL_DIR=$sent" \
    "AUTOPILOT_ENDPOINTS_ENV=$REAL_HOME/.autopilot/endpoints.env" "DISPATCH_DETACH=0" \
    -- bash "$REPO/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 --endpoint minimax --effort high --branch d0/cf-outer --prompt-file "$SCR/cf-prompt.txt" --timeout 7m --base develop > "$SCR/cf.stdout" 2> "$SCR/cf.stderr"; local rc=$?
  sleep 3; kill_scratch_procs
  local outer_mf csid outer_run rail_sid
  outer_mf="$(for m in $(find "$runs" -name '*.manifest.json'); do [ "$(json_file_field "$m" 'o.runner')" = cc-shim ] && echo "$m"; done | head -1)"
  csid=""; outer_run=""; rail_sid=""
  if [ -n "$outer_mf" ]; then csid="$(json_file_field "$outer_mf" 'o.child_session_id')"; outer_run="$(json_file_field "$outer_mf" 'o.run_id')"; rail_sid="$(json_file_field "$outer_mf" 'o.session_id')"; fi
  # ---- row c: the child's own marker
  local mk="$MODE_DIR/$csid.json" mk_ok=false mk_parent="" mk_sid=""
  if [ -n "$csid" ] && [ -f "$mk" ]; then mk_ok=true; mk_parent="$(json_file_field "$mk" 'o.parent_session_id')"; mk_sid="$(json_file_field "$mk" 'o.session_id')"; fi
  jq -n --arg P "$P" --arg csid "$csid" --arg rsid "$rail_sid" --argjson rc "$rc" --argjson mk "$mk_ok" --arg mp "$mk_parent" --arg ms "$mk_sid" --arg wrapper "$(cat "$sent/cf.wrapper.txt" 2>/dev/null | head -3 | tr '\n' ' ')" \
    '{launcher_session_id_P:$P,hetero_rc:$rc,manifest_session_id:$rsid,manifest_child_session_id:$csid,child_marker_exists:$mk,child_marker_session_id:$ms,child_marker_parent_session_id:$mp,wrapper_head:$wrapper}' > "$SCR/c.detail.json"
  if [ -z "$outer_mf" ] || [ -z "$csid" ]; then rec c not_run "hetero cc-shim produced no manifest / child session id (rc=$rc; see raw/c: stdout/stderr)" "$SCR/c.detail.json"
  elif [ "$mk_ok" = true ] && [ "$mk_parent" = "$P" ] && [ "$mk_sid" = "$csid" ]; then rec c pass "hetero cc-shim child wrote marker $csid.json with parent_session_id == launcher P" "$SCR/c.detail.json"
  else rec c bad "child marker exists=$mk_ok session_id='$mk_sid' parent_session_id='${mk_parent:-<none>}' (want session_id=$csid parent=$P)" "$SCR/c.detail.json"; fi
  # ---- row f: the nested rail from the claude child
  local inner_mf="" in_sid="" in_parent="" in_depth="" in_root="" out_depth=""
  for m in $(find "$runs" -name '*.manifest.json'); do [ "$m" = "$outer_mf" ] && continue; inner_mf="$m"; done
  [ -n "$inner_mf" ] && { in_sid="$(json_file_field "$inner_mf" 'o.session_id')"; in_parent="$(json_file_field "$inner_mf" 'o.parent_run_id')"; in_depth="$(json_file_field "$inner_mf" 'o.depth')"; }
  [ -n "$outer_mf" ] && out_depth="$(json_file_field "$outer_mf" 'o.depth')"
  jq -n --arg csid "$csid" --arg outer_run "$outer_run" --arg od "$out_depth" --arg isid "$in_sid" --arg ip "$in_parent" --arg id "$in_depth" --argjson have "$([ -n "$inner_mf" ] && echo true || echo false)" \
    --arg env "$(cat "$sent/cf-inner-env.txt" 2>/dev/null | tr '\n' ' ')" \
    '{outer_run_id:$outer_run,outer_depth:$od,nested_manifest_found:$have,nested_session_id:$isid,nested_parent_run_id:$ip,nested_depth:$id,expected_nested_session_id_is_childs_own:$csid,inner_env:$env}' > "$SCR/f.detail.json"
  if [ -z "$inner_mf" ]; then rec f not_run "no nested manifest: the minimax-driven claude child did not run the nested rail (see raw/f)" "$SCR/f.detail.json"
  elif [ "$in_sid" = "$csid" ] && [ -n "$csid" ] && [ "$in_parent" = "$outer_run" ] && [ -n "$outer_run" ]; then rec f pass "nested rail manifest session_id == the claude child's own id ($csid), parent_run_id == outer run, depth=$in_depth (outer depth $out_depth)" "$SCR/f.detail.json"
  else rec f bad "nested manifest session_id='$in_sid' (want child $csid), parent_run_id='$in_parent' (want $outer_run), depth=$in_depth" "$SCR/f.detail.json"; fi
  copy_raw c "$sent" "$SCR/cf.stdout" "$SCR/cf.stderr" "$outer_mf" "$mk" "$SCR/cf-prompt.txt"
  copy_raw f "$sent/cf-inner-env.txt" "$sent/cf-inner-review.json" "$outer_mf" "$inner_mf"
}

# ====================================================================================== row d1 (foreman with a stub hand)
row_d1() {
  local sbx="$SCR/repo-d1" runs="$SCR/runs-d1" rd="$SCR/foreman-run-d1"; mkdir -p "$runs"; mk_repo "$sbx"
  $GIT -C "$sbx" remote add origin "$SCR/d1-remote.git" 2>/dev/null; git init -q --bare "$SCR/d1-remote.git"
  printf 'brief\n' > "$SCR/d1-brief.md"; printf 'plan\n' > "$SCR/d1-plan.md"; printf 'create ok.txt\n' > "$SCR/d1-hand-prompt.txt"
  local sd="$SCR/d1-stub"; mkdir -p "$sd" "$SCR/bin-d1"
  cat > "$SCR/bin-d1/kimi" <<'STUB'
#!/usr/bin/env bash
echo '{"role":"meta","type":"system.version","version":"0.41.0"}'
printf '{"role":"assistant","tool_calls":[{"type":"function","id":"t1","function":{"name":"Bash","arguments":"{\\"command\\":\\"bash script\\"}"}}]}\n{"role":"tool","tool_call_id":"t1","content":"ok"}\n'
bash "$KIMI_STUB_SCRIPT" > "$KIMI_STUB_DIR/script.out" 2>&1
printf 'done: d1\nnot done: (none)\n' > "$KIMI_STUB_REPORT_DIR/REPORT.md"
printf '{"role":"assistant","content":"DONE"}\n{"role":"meta","type":"session.resume_hint","session_id":"session_stub_0","command":"kimi -r x","content":"x"}\n'
STUB
  chmod +x "$SCR/bin-d1/kimi"
  make_codex_stub "$SCR/codex-stub"
  cat > "$SCR/d1-nested.sh" <<EOF
for v in CLAUDE_CODE_SESSION_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_PARENT_SESSION_ID; do printf '%s=%s\n' "\$v" "\${!v-<unset>}"; done
DISPATCH_DETACH=0 bash "$REPO/scripts/dispatch-hetero.sh" --runner codex --codex-bin "$SCR/codex-stub" --model gpt-5-codex --branch hands/d1/u1 --base develop --prompt-file "$SCR/d1-hand-prompt.txt" --timeout 3m
echo "hetero rc=\$?"
EOF
  local P; P="$(uuid)"
  run 300 "$sbx" "PATH=$SCR/bin-d1:$SCR/bin:$PATH" "CLAUDE_CODE_SESSION_ID=$P" "AUTOPILOT_DISPATCH_RUNS_DIR=$runs" "KIMI_STUB_SCRIPT=$SCR/d1-nested.sh" "KIMI_STUB_DIR=$sd" "KIMI_STUB_REPORT_DIR=$rd" \
    -- bash "$REPO/scripts/dispatch-foreman.sh" --brief-file "$SCR/d1-brief.md" --plan-file "$SCR/d1-plan.md" --run-id d1-foreman --run-dir "$rd" --poll 0.2 --timeout 240 > "$SCR/d1.stdout" 2> "$SCR/d1.stderr"; local rc=$?
  local nested_mf="" fm=""
  for m in $(find "$runs" -name '*.manifest.json'); do
    if [ "$(json_file_field "$m" 'o.runner')" = codex ]; then nested_mf="$m"; else fm="$m"; fi
  done
  local n_sid="" n_par="" n_depth="" fstatus=""
  [ -n "$nested_mf" ] && { n_sid="$(json_file_field "$nested_mf" 'o.session_id')"; n_par="$(json_file_field "$nested_mf" 'o.parent_run_id')"; n_depth="$(json_file_field "$nested_mf" 'o.depth')"; }
  fstatus="$(json_file_field "$SCR/d1.stdout" 'o.status')"
  jq -n --arg P "$P" --argjson rc "$rc" --arg fs "$fstatus" --argjson have "$([ -n "$nested_mf" ] && echo true || echo false)" --arg ns "$n_sid" --arg np "$n_par" --arg nd "$n_depth" \
    --arg inner "$(head -8 "$sd/script.out" 2>/dev/null | tr '\n' ' ' | cut -c1-400)" \
    '{launcher_session_id_exported_to_foreman:$P,foreman_rc:$rc,foreman_status:$fs,nested_manifest_found:$have,nested_session_id:($ns|if .=="" then null else . end),nested_parent_run_id:$np,nested_depth:$nd,nested_env_dump:$inner}' > "$SCR/d1.detail.json"
  copy_raw d1 "$SCR/d1.stdout" "$SCR/d1.stderr" "$nested_mf" "$fm" "$sd/script.out"
  if [ -z "$nested_mf" ]; then rec d1 not_run "no nested hetero manifest under the foreman (foreman status '$fstatus', rc=$rc)" "$SCR/d1.detail.json"
  elif [ -z "$n_sid" ] && [ "$n_par" = d1-foreman ] && [ "$n_depth" = 1 ]; then rec d1 pass "nested rail: session_id null, parent_run_id == foreman run (d1-foreman), depth 1" "$SCR/d1.detail.json"
  else rec d1 bad "nested rail session_id='${n_sid:-null}' parent_run_id='$n_par' depth='$n_depth' (want null / d1-foreman / 1)" "$SCR/d1.detail.json"; fi
}
make_codex_stub() { # <path> : a codex that answers `exec --help` and otherwise runs $CODEX_STUB_HOOK (a script) in its cwd
  cat > "$1" <<'EOS'
#!/usr/bin/env bash
case " $* " in *" --help "*) echo "Usage: codex exec  --dangerously-bypass-hook-trust  --ignore-user-config  --dangerously-bypass-approvals-and-sandbox"; exit 0 ;; esac
[ "${1:-}" = "--version" ] && { echo "codex-cli 0.0.0-d0stub"; exit 0; }
cat >/dev/null
[ -n "${CODEX_STUB_HOOK:-}" ] && bash "$CODEX_STUB_HOOK"
exit 0
EOS
  chmod +x "$1"
}

# ====================================================================================== row d2 (Claude -> hetero(codex stub) -> Claude -> nested rail)
row_d2() {
  local sent="$SCR/sent-d2" repo="$SCR/repo-d2" runs="$SCR/runs-d2"; mkdir -p "$sent" "$runs"; mk_repo "$repo"
  printf '+x\n' > "$SCR/b-diff.txt"; printf 'implement nothing\n' > "$SCR/d2-prompt.txt"
  mk_inner_cmd "$SCR/inner-cmd.sh" "$sent" "$repo"
  make_codex_stub "$SCR/codex-stub"
  local OUTER INNER; OUTER="$(uuid)"; INNER="$(uuid)"
  # what the "codex task" does: record its env, then start claude -p --session-id INNER, which runs the nested stub rail
  cat > "$SCR/d2-codex-hook.sh" <<EOF
for v in CLAUDE_CODE_SESSION_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_ROOT_RUN_ID; do printf '%s=%s\n' "\$v" "\${!v-<unset>}"; done > "$sent/d2-codex-env.txt"
printf 'Measurement run. Use your Bash tool to run this single command, then reply DONE:\nbash %s\n' "$SCR/inner-cmd.sh" > "$SCR/d2-inner-prompt.txt"
PROBE_TAG=d2 "$REAL_CLAUDE" -p --session-id "$INNER" --model haiku --plugin-dir "$REPO" --allowedTools Bash < "$SCR/d2-inner-prompt.txt" > "$sent/d2-inner-claude.out" 2>&1
echo "inner-claude rc=\$?" >> "$sent/d2-codex-env.txt"
EOF
  cat > "$SCR/d2-outer-cmd.sh" <<EOF
#!/usr/bin/env bash
sha256sum "$MODE_DIR/$OUTER.json" > "$sent/d2-outer-marker.before" 2>&1
cd "$repo" && CODEX_STUB_HOOK="$SCR/d2-codex-hook.sh" PROBE_TAG=d2 DISPATCH_DETACH=0 bash "$REPO/scripts/dispatch-hetero.sh" --runner codex --codex-bin "$SCR/codex-stub" --model gpt-5-codex --branch d0/d2-outer --base develop --prompt-file "$SCR/d2-prompt.txt" --timeout 6m > "$sent/d2-hetero.json" 2>&1
echo "hetero rc=\$?" > "$sent/d2-hetero.rc"
sha256sum "$MODE_DIR/$OUTER.json" > "$sent/d2-outer-marker.after" 2>&1
EOF
  chmod +x "$SCR/d2-outer-cmd.sh"
  local prompt; prompt="Measurement run. Use your Bash tool exactly once to run this single command, then reply DONE and nothing else:
bash $SCR/d2-outer-cmd.sh"
  run 420 "$repo" "PROBE_SENTINEL_DIR=$sent" "AUTOPILOT_DISPATCH_RUNS_DIR=$runs" -- "$REAL_CLAUDE" -p --session-id "$OUTER" --model haiku --plugin-dir "$REPO" --allowedTools Bash \
    --output-format stream-json --verbose "$prompt" > "$SCR/d2-outer.out" 2> "$SCR/d2-outer.err"; local rc=$?
  sleep 3; kill_scratch_procs
  local omf="" imf="" m; for m in $(find "$runs" -name '*.manifest.json'); do if [ "$(json_file_field "$m" 'o.runner')" = codex ]; then omf="$m"; else imf="$m"; fi; done
  local outer_run="" nested_parent="" nested_sid="" nested_depth=""
  [ -n "$omf" ] && outer_run="$(json_file_field "$omf" 'o.run_id')"
  [ -n "$imf" ] && { nested_parent="$(json_file_field "$imf" 'o.parent_run_id')"; nested_sid="$(json_file_field "$imf" 'o.session_id')"; nested_depth="$(json_file_field "$imf" 'o.depth')"; }
  local imk="$MODE_DIR/$INNER.json" imk_ok=false imk_parent="" imk_sid="" omk_same=unknown
  [ -f "$imk" ] && { imk_ok=true; imk_parent="$(json_file_field "$imk" 'o.parent_session_id')"; imk_sid="$(json_file_field "$imk" 'o.session_id')"; }
  if [ -f "$sent/d2-outer-marker.before" ] && [ -f "$sent/d2-outer-marker.after" ]; then
    if grep -q 'No such file' "$sent/d2-outer-marker.before"; then omk_same="outer-marker-absent-at-start"
    elif [ "$(awk '{print $1}' "$sent/d2-outer-marker.before")" = "$(awk '{print $1}' "$sent/d2-outer-marker.after")" ]; then omk_same=true; else omk_same=false; fi
  fi
  jq -n --arg O "$OUTER" --arg I "$INNER" --argjson rc "$rc" --argjson imk "$imk_ok" --arg ims "$imk_sid" --arg imp "$imk_parent" --arg omk "$omk_same" --arg orun "$outer_run" --arg npar "$nested_parent" --arg nsid "$nested_sid" --arg nd "$nested_depth" \
    --arg cenv "$(tr '\n' ' ' < "$sent/d2-codex-env.txt" 2>/dev/null)" --arg ienv "$(tr '\n' ' ' < "$sent/d2-inner-env.txt" 2>/dev/null)" \
    '{outer_session:$O,inner_session:$I,outer_claude_rc:$rc,codex_stub_env:$cenv,inner_claude_bash_env:$ienv,inner_marker_exists:$imk,inner_marker_session_id:$ims,inner_marker_parent_session_id:$imp,outer_marker_unchanged:$omk,outer_hetero_run_id:$orun,nested_manifest_parent_run_id:$npar,nested_manifest_session_id:$nsid,nested_manifest_depth:$nd,note:"inner_session is the id the stub codex passed as --session-id; no manifest claims it, so section 3 places the nested rail by a named reason"}' > "$SCR/d2.detail.json"
  copy_raw d2 "$sent" "$omf" "$imf" "$imk" "$SCR/d2-outer.err"
  local why=()
  [ "$imk_ok" = true ] || why+=("inner session marker $INNER.json absent")
  # plan section 7 row d2 note (after 3d): for a non-Claude harness the rail mints no child id, so the inner marker carries NO parent
  { [ "$imk_ok" = true ] && [ -z "$imk_parent" ]; } || why+=("inner marker parent_session_id='${imk_parent:-<none>}' (want none: the codex rail mints no AUTOPILOT_CHILD_SESSION_ID)")
  [ "$omk_same" = true ] || why+=("outer marker unchanged=$omk_same")
  { [ -n "$outer_run" ] && [ "$nested_parent" = "$outer_run" ]; } || why+=("nested manifest parent_run_id='${nested_parent:-<none>}' != harness run '$outer_run'")
  if [ -z "$omf" ]; then rec d2 not_run "the outer Claude did not start the hetero rail (rc=$rc; see raw/d2)" "$SCR/d2.detail.json"
  elif [ "${#why[@]}" -eq 0 ]; then rec d2 pass "Claude->codex(stub)->Claude end to end (post-3d rule, plan section 7 row d2 note): inner marker carries no parent_session_id, outer marker unchanged, nested manifest parent_run_id == harness run" "$SCR/d2.detail.json"
  else rec d2 bad "codex path: $(IFS=';'; echo "${why[*]}"). kimi/agy/opencode: not run (provider credentials are not available under an isolated HOME; real ~/.kimi-code must not be touched) = bad by the plan's rule" "$SCR/d2.detail.json"; fi
}

# ====================================================================================== rows e + k (tools session)
row_ek() {
  local repo="$SCR/repo-e" u; u="$(uuid)"; mk_repo "$repo"
  local prompt='Do these steps in order, using tools. Step 1: use the Bash tool to run exactly: echo TOP=$CLAUDE_CODE_SESSION_ID . Step 2: use the Agent tool (general-purpose subagent, foreground) with the prompt: Use the Bash tool to run exactly: echo SUB=$CLAUDE_CODE_SESSION_ID ; then report the output. Step 3: use the Agent tool again with run_in_background set to true and the prompt: Use the Bash tool to run exactly: echo BG=$CLAUDE_CODE_SESSION_ID ; then report the output. Then wait for the background agent to finish and finish with the word DONE.'
  run "$CLAUDE_T" "$repo" -- "$REAL_CLAUDE" -p --session-id "$u" --model sonnet --allowedTools Bash Agent --output-format stream-json --verbose "$prompt" > "$SCR/ek.out" 2> "$SCR/ek.err"; local rc=$?
  local files; files="$(session_transcripts "$CFG" "$u")"
  local main; main="$(printf '%s\n' "$files" | head -1)"
  # shellcheck disable=SC2086
  node "$SCR/js/calls.js" $files > "$SCR/ek.calls.json"
  local sdir="${main%.jsonl}/subagents"; mkdir -p "$RAW/e" "$RAW/k"
  cp "$sdir"/*.meta.json "$RAW/k/" 2>/dev/null || true; cp "$SCR/ek.calls.json" "$RAW/e/calls.json"; cp "$SCR/ek.out" "$RAW/e/claude-stream.jsonl"
  local top_sid sub_sid
  top_sid="$(jq -r --arg m "$(basename "$main")" '[.bash[]|select(.file==$m)|select(.command|test("TOP="))|.result][0] // ""' "$SCR/ek.calls.json" | sed -n 's/.*TOP=\([0-9a-f-]*\).*/\1/p')"
  sub_sid="$(jq -r --arg m "$(basename "$main")" '[.bash[]|select(.file!=$m)|select(.command|test("SUB="))|.result][0] // ""' "$SCR/ek.calls.json" | sed -n 's/.*SUB=\([0-9a-f-]*\).*/\1/p')"
  local bg_sid; bg_sid="$(jq -r --arg m "$(basename "$main")" '[.bash[]|select(.file!=$m)|select(.command|test("BG="))|.result][0] // ""' "$SCR/ek.calls.json" | sed -n 's/.*BG=\([0-9a-f-]*\).*/\1/p')"
  jq -n --arg u "$u" --arg top "$top_sid" --arg sub "$sub_sid" --arg bg "$bg_sid" --argjson rc "$rc" '{session_id_passed:$u,claude_rc:$rc,top_level_bash_CLAUDE_CODE_SESSION_ID:$top,foreground_subagent_bash_CLAUDE_CODE_SESSION_ID:$sub,background_subagent_bash_CLAUDE_CODE_SESSION_ID:$bg}' > "$SCR/e.detail.json"
  if [ "$top_sid" = "$u" ] && [ "$sub_sid" = "$u" ]; then rec e pass "top-level and foreground-subagent Bash both saw CLAUDE_CODE_SESSION_ID == the session (background subagent saw '${bg_sid:-<no result>}')" "$SCR/e.detail.json"
  else rec e bad "top='${top_sid:-<none>}' sub='${sub_sid:-<none>}' vs session $u" "$SCR/e.detail.json"; fi
  # row k: Agent results in the session transcript vs the subagent meta toolUseId
  local metas=0 matched_fg=false matched_bg=false fg_meta bg_meta
  for mf in "$sdir"/*.meta.json; do [ -f "$mf" ] || continue; metas=$((metas+1)); done
  local k_json='[]'
  for mf in "$sdir"/*.meta.json; do
    [ -f "$mf" ] || continue
    local aid tuid shape depth res_cnt
    aid="$(basename "$mf" .meta.json)"; aid="${aid#agent-}"
    tuid="$(json_file_field "$mf" 'o.toolUseId')"; shape="$(json_file_field "$mf" 'o.requestShape')"; depth="$(json_file_field "$mf" 'o.spawnDepth')"
    res_cnt="$(jq --arg a "$aid" --arg t "$tuid" --arg m "$(basename "$main")" '[.agent_results[]|select(.file==$m and .agentId==$a and .tool_use_id==$t)]|length' "$SCR/ek.calls.json")"
    k_json="$(jq -c --arg a "$aid" --arg t "$tuid" --arg s "$shape" --argjson d "${depth:-0}" --argjson n "$res_cnt" '. + [{agentId:$a,meta_toolUseId:$t,requestShape:$s,spawnDepth:$d,exact_matching_results_in_session_transcript:$n}]' <<<"$k_json")"
    [ "$shape" = foreground ] && [ "$res_cnt" = 1 ] && matched_fg=true
    [ "$shape" = background ] && [ "$res_cnt" = 1 ] && matched_bg=true
  done
  jq -n --argjson agents "$k_json" '{agents:$agents,note:"exact = one tool_result in the session transcript with toolUseResult.agentId == meta agent id AND tool_use_id == meta toolUseId"}' > "$SCR/k.detail.json"
  copy_raw k "$SCR/k.detail.json"
  if [ "$matched_fg" = true ] && [ "$matched_bg" = true ]; then rec k pass "both foreground and background Agent launches carry toolUseResult.agentId + tool_use_id matching the subagent meta (exactly one result each)" "$SCR/k.detail.json"
  else rec k bad "foreground match=$matched_fg background match=$matched_bg (agents seen: $metas)" "$SCR/k.detail.json"; fi
}

# ====================================================================================== rows g, h, i (PreToolUse updatedInput)
# One session per hook mode. Commands are run by the top level and by a subagent. The hook never returns a
# permissionDecision. Observed through the Bash results in the transcripts (headless -p cannot show a prompt: an
# unallowed command comes back as is_error with the reason, which is the observable for "would have asked").
gh_session() { # <tag> <mode> <allow-rule-or-empty> <extra claude args...> -- reads $GH_PROMPT ; sets GH_CALLS (json file)
  local tag="$1" mode="$2" allow="$3"; shift 3
  local repo="$SCR/repo-$tag" sent="$SCR/sent-$tag" u; u="$(uuid)"; mk_repo "$repo"; mkdir -p "$sent"
  jq -n --arg c "node $SCR/js/stamp-probe.js" --arg allow "$allow" \
    '{hooks:{PreToolUse:[{matcher:"Bash",hooks:[{type:"command",command:$c,timeout:10}]}]}} + (if $allow=="" then {} else {permissions:{allow:[$allow]}} end)' > "$SCR/$tag.settings.json"
  run "$CLAUDE_T" "$repo" "PROBE_SENTINEL_DIR=$sent" "PROBE_HOOK_MODE=$mode" -- "$REAL_CLAUDE" -p --session-id "$u" --model sonnet --settings "$SCR/$tag.settings.json" "$@" \
    --output-format stream-json --verbose "$GH_PROMPT" > "$SCR/$tag.out" 2> "$SCR/$tag.err"
  local files; files="$(session_transcripts "$CFG" "$u")"
  # shellcheck disable=SC2086
  node "$SCR/js/calls.js" $files > "$SCR/$tag.calls.json"
  mkdir -p "$RAW/$tag"; cp "$SCR/$tag.calls.json" "$SCR/$tag.settings.json" "$RAW/$tag/"; cp "$sent"/hook-*.log "$RAW/$tag/" 2>/dev/null || true
  GH_CALLS="$SCR/$tag.calls.json"; GH_HOOKLOG="$sent/hook-$mode.log"
}
call_result() { # <calls.json> <regex over command> [nth] -> "<is_error>|<result>"
  jq -r --arg re "$2" --argjson n "${3:-0}" '[.bash[]|select(.command|test($re))][$n] | if .==null then "absent|" else "\(.is_error)|\(.result|gsub("\n";" "))" end' "$1"
}
row_ghi() {
  local want="$1"
  local P1='Run each of these Bash commands as its own Bash tool call, in this order, exactly as written, and report each raw result. If a command is denied or errors, do NOT retry or work around it, just report it. Commands: (1) echo A (2) ./rail.sh x . Then use the Agent tool (general-purpose subagent, foreground) with this prompt: Run these Bash commands one at a time exactly as written and report each raw result, no retries or workarounds: (3) echo A (4) ./rail.sh y . Finally reply DONE.'
  if [[ ",$want," == *,g,* ]] || [[ ",$want," == *,i,* ]]; then
    GH_PROMPT="$P1"
  fi
  if [[ ",$want," == *,g,* ]]; then
    gh_session g both "" --allowedTools Bash Agent
    local c1 c2 c3 c4 aid; c1="$(call_result "$GH_CALLS" '^echo A$' 0)"; c2="$(call_result "$GH_CALLS" '^\./rail\.sh x' 0)"; c3="$(call_result "$GH_CALLS" '^echo A$' 1)"; c4="$(call_result "$GH_CALLS" '^\./rail\.sh y' 0)"
    aid="$(jq -r 'select(.agent_id!=null)|.agent_id' "$GH_HOOKLOG" 2>/dev/null | head -1)"
    local ak; ak="$(jq -r '[.[]|select(.agent_id!=null)]|length' <(jq -s . "$GH_HOOKLOG" 2>/dev/null) 2>/dev/null)"
    jq -n --arg c1 "$c1" --arg c2 "$c2" --arg c3 "$c3" --arg c4 "$c4" --arg aid "${aid:-}" --arg keys "$(jq -c 'select(.agent_id!=null)|.payload_keys' "$GH_HOOKLOG" 2>/dev/null | head -1)" \
      '{top_echo_A:$c1,top_rail:$c2,sub_echo_A:$c3,sub_rail:$c4,subagent_agent_id_in_hook_payload:$aid,subagent_payload_keys:$keys}' > "$SCR/g.detail.json"
    local ok=1
    [[ "$c1" == "false|B"* ]] || ok=0; [[ "$c3" == "false|B"* ]] || ok=0
    [[ "$c2" == "false|ORIGIN=session "* ]] || ok=0
    [ -n "$aid" ] && [[ "$c4" == "false|ORIGIN=$aid "* ]] || ok=0
    if [ "$ok" = 1 ]; then rec g pass "updatedInput applied with no permissionDecision: echo A -> B (top and subagent); rail stamped session / subagent agent_id and the stamp reached the process env" "$SCR/g.detail.json"
    else rec g bad "top echo A='$c1' | top rail='$c2' | sub echo A='$c3' | sub rail='$c4' | agent_id='${aid:-<none>}'" "$SCR/g.detail.json"; fi
  fi
  if [[ ",$want," == *,h,* ]]; then
    local P2='Run each of these Bash commands as its own Bash tool call, in this order, exactly as written, and report each raw result. If a command is denied, do NOT retry or work around it, just report that it was denied. Commands: (1) ./rail.sh x (2) export Z=1; ./rail.sh x . Then use the Agent tool (general-purpose subagent, foreground) with this prompt: Run this Bash command exactly as written and report the raw result; if it is denied, do not retry, just report it: (3) ./rail.sh y . Finally reply DONE.'
    GH_PROMPT="$P2"
    gh_session h1 stamp-export 'Bash(./rail.sh:*)' --allowedTools Agent
    local s1 s2 s3; s1="$(call_result "$GH_CALLS" '^\./rail\.sh x' 0)"; s2="$(call_result "$GH_CALLS" '^export Z=1' 0)"; s3="$(call_result "$GH_CALLS" '^\./rail\.sh y' 0)"
    gh_session h0 none 'Bash(./rail.sh:*)' --allowedTools Agent
    local n1 n2 n3; n1="$(call_result "$GH_CALLS" '^\./rail\.sh x' 0)"; n2="$(call_result "$GH_CALLS" '^export Z=1' 0)"; n3="$(call_result "$GH_CALLS" '^\./rail\.sh y' 0)"
    gh_session h2 stamp-inline 'Bash(./rail.sh:*)' --allowedTools Agent
    local a1 a3; a1="$(call_result "$GH_CALLS" '^\./rail\.sh x' 0)"; a3="$(call_result "$GH_CALLS" '^\./rail\.sh y' 0)"
    jq -n --arg s1 "$s1" --arg s2 "$s2" --arg s3 "$s3" --arg n1 "$n1" --arg n2 "$n2" --arg n3 "$n3" --arg a1 "$a1" --arg a3 "$a3" \
      '{allow_rule:"Bash(./rail.sh:*)",with_export_stamp_hook:{top_rail_x:$s1,top_compound_export_Z_then_rail:$s2,subagent_rail_y:$s3},control_no_rewrite_hook:{top_rail_x:$n1,top_compound_export_Z_then_rail:$n2,subagent_rail_y:$n3},informational_inline_assignment_form:{top_rail_x:$a1,subagent_rail_y:$a3}}' > "$SCR/h.detail.json"
    if [[ "$s1" == "false|ORIGIN=session "* ]] && [[ "$s3" == "false|ORIGIN="* ]] && [[ "$n1" == "false|ORIGIN=<unset> "* ]]; then
      rec h pass "export-prefixed rail command ran under the allow rule with no prompt/denial (control: rule alone allows the plain command; compound control: '${n2:0:60}')" "$SCR/h.detail.json"
    else rec h bad "export-stamped rail: top='${s1:0:90}' sub='${s3:0:90}'; control plain: '${n1:0:70}'; control compound(export Z=1; rail): '${n2:0:90}'" "$SCR/h.detail.json"; fi
  fi
  if [[ ",$want," == *,i,* ]]; then
    GH_PROMPT="$P1"
    gh_session i both "" --plugin-dir "$REPO" --allowedTools Bash Agent
    local c1 c2 c3 c4; c1="$(call_result "$GH_CALLS" '^echo A$' 0)"; c2="$(call_result "$GH_CALLS" '^\./rail\.sh x' 0)"; c3="$(call_result "$GH_CALLS" '^echo A$' 1)"; c4="$(call_result "$GH_CALLS" '^\./rail\.sh y' 0)"
    local pt; pt="$(node -e 'const h=require(process.argv[1]).hooks.PreToolUse||[];console.log(h.filter(g=>/Bash|\.\*/.test(g.matcher||"")).map(g=>g.matcher+": "+g.hooks.map(x=>x.command.replace(/^.*hooks\//,"")).join(",")).join(" ; "))' "$REPO/hooks/hooks.json")"
    jq -n --arg c1 "$c1" --arg c2 "$c2" --arg c3 "$c3" --arg c4 "$c4" --arg pt "$pt" '{plugin_hooks_PreToolUse_matching_Bash:$pt,plugin:"this worktree via --plugin-dir (default-on hooks only; opt-in hooks not enabled)",top_echo_A:$c1,top_rail:$c2,sub_echo_A:$c3,sub_rail:$c4}' > "$SCR/i.detail.json"
    if [[ "$c1" == "false|B"* ]] && [[ "$c2" == "false|ORIGIN=session "* ]] && [[ "$c3" == "false|B"* ]] && [[ "$c4" == "false|ORIGIN="* ]] && [[ "$c4" != *"<unset>"* ]]; then
      rec i pass "rewrite survived the plugin's default-on Bash PreToolUse hooks (echo A -> B, rail stamped; top and subagent)" "$SCR/i.detail.json"
    else rec i bad "with plugin hooks: top echo A='${c1:0:70}' rail='${c2:0:70}' sub echo A='${c3:0:70}' rail='${c4:0:70}'" "$SCR/i.detail.json"; fi
  fi
}

# ====================================================================================== row j
row_j() {
  jq -n '{reason:"needs step 3c (child_transcript copy) to exist and a one-day-later re-check; neither is possible in a same-day D0 run",blocks:"nothing"}' > "$SCR/j.detail.json"
  rec j not_run "step 3c is not implemented (no child_transcript copy to age) and the check is defined as one day later; cannot be measured in D0. Non-blocking row." "$SCR/j.detail.json"
}

# ====================================================================================== row l (3d live check)
# One real hetero cc-shim run (minimax). The claude child's SessionStart hook (a --settings sentinel added by the PATH
# wrapper, next to the autopilot plugin that writes the marker) dumps its env. The child's Bash then starts a SECOND
# `claude -p` inside a real tmux server on a private socket (`tmux -L <unique>`; killed at the end; the user's tmux is
# never touched). The tmux server was started inside the child, so it keeps the child's env incl. AUTOPILOT_CHILD_SESSION_ID.
judge_l() { # <hook.env> <manifest-csid> <argv-session-id> <child-marker> <tmux-marker> <P> -> prints one reason per failed condition
  local henv="$1" csid="$2" asid="$3" cmk="$4" tmk="$5" P="$6" hc="" cp="" cs=""
  [ -f "$henv" ] && hc="$(sed -n 's/^AUTOPILOT_CHILD_SESSION_ID=//p' "$henv" | head -1)"
  { [ -n "$hc" ] && [ "$hc" = "$csid" ] && [ "$hc" = "$asid" ]; } || echo "(1) child hook env AUTOPILOT_CHILD_SESSION_ID='${hc:-<none>}' vs manifest child_session_id='${csid:-<none>}' vs --session-id='${asid:-<none>}'"
  if [ -f "$cmk" ]; then cp="$(jq -r '.parent_session_id // empty' "$cmk")"; cs="$(jq -r '.session_id // empty' "$cmk")"; fi
  { [ -f "$cmk" ] && [ "$cp" = "$P" ] && [ -n "$P" ] && [ "$cs" = "$csid" ]; } || echo "(2) child marker exists=$([ -f "$cmk" ] && echo true || echo false) session_id='${cs:-<none>}' parent_session_id='${cp:-<none>}' (want $csid / $P)"
  if [ ! -f "$tmk" ]; then echo "(3) tmux-started claude wrote no marker"
  elif jq -e 'has("parent_session_id")' "$tmk" >/dev/null; then echo "(3) tmux-started claude marker HAS parent_session_id='$(jq -r '.parent_session_id' "$tmk")'"; fi
}
row_l() {
  local sent="$SCR/sent-l" repo="$SCR/repo-l"; mkdir -p "$sent"; mk_repo "$repo"
  local U2 SOCK; U2="$(uuid)"; SOCK="d0l-$(uuid | cut -c1-8)-$$"
  jq -n --arg c 'cat > "$PROBE_SENTINEL_DIR/$PROBE_TAG-hook.json"; env | grep -E "^(AUTOPILOT_|CLAUDE_CODE_SESSION_ID)" > "$PROBE_SENTINEL_DIR/$PROBE_TAG-hook.env"' \
    '{hooks:{SessionStart:[{hooks:[{type:"command",command:$c,timeout:5}]}]}}' > "$SCR/l-settings.json"
  mkdir -p "$SCR/bin-l"; cat > "$SCR/bin-l/claude" <<EOF
#!/usr/bin/env bash
mkdir -p "$sent"
{ echo "cwd=\$PWD"; echo "AUTOPILOT_CHILD_SESSION_ID=\${AUTOPILOT_CHILD_SESSION_ID-<unset>}"; printf 'ARGV:'; printf ' [%s]' "\$@"; echo; } > "$sent/\$PROBE_TAG.wrapper.txt"
exec "$REAL_CLAUDE" "\$@" --plugin-dir "$REPO" --settings "$SCR/l-settings.json"
EOF
  chmod +x "$SCR/bin-l/claude"
  # the second claude: started by tmux, so its env is the tmux server's (= the claude child's Bash env)
  cat > "$SCR/l2-run.sh" <<EOF
#!/usr/bin/env bash
env | grep -E '^(AUTOPILOT_|CLAUDE_CODE_SESSION_ID)' > "$sent/l2-tmux-env.txt"
PROBE_TAG=l2 claude -p --session-id "$U2" --model MiniMax-M3 "say ok" > "$sent/l2.out" 2>&1
echo "rc=\$?" > "$sent/l2.rc"
EOF
  cat > "$SCR/l-inner.sh" <<EOF
#!/usr/bin/env bash
env | grep -E '^(AUTOPILOT_|CLAUDE_CODE_SESSION_ID)' > "$sent/l-child-bash-env.txt"
tmux -L "$SOCK" -f /dev/null new-session -d -s d0l "bash $SCR/l2-run.sh" > "$sent/l-tmux.log" 2>&1
echo "tmux new rc=\$?" >> "$sent/l-tmux.log"
for i in \$(seq 1 70); do [ -f "$sent/l2.rc" ] && break; sleep 2; done
tmux -L "$SOCK" kill-server >> "$sent/l-tmux.log" 2>&1
echo "kill-server rc=\$?" >> "$sent/l-tmux.log"
EOF
  chmod +x "$SCR/l2-run.sh" "$SCR/l-inner.sh"
  printf 'This is a measurement run. Do exactly one thing: use your Bash tool to run this single command, then stop and reply DONE:\nbash %s\nDo not edit any file and do not run anything else.\n' "$SCR/l-inner.sh" > "$SCR/l-prompt.txt"
  local P; P="$(uuid)"; local runs="$SCR/runs-l"; mkdir -p "$runs"
  run 480 "$repo" "PATH=$SCR/bin-l:$SCR/bin:$PATH" "CLAUDE_CODE_SESSION_ID=$P" "AUTOPILOT_DISPATCH_RUNS_DIR=$runs" "PROBE_TAG=l" "PROBE_SENTINEL_DIR=$sent" \
    "AUTOPILOT_ENDPOINTS_ENV=$REAL_HOME/.autopilot/endpoints.env" "DISPATCH_DETACH=0" \
    -- bash "$REPO/scripts/dispatch-hetero.sh" --runner cc-shim --model MiniMax-M3 --endpoint minimax --effort high --branch d0/l-outer --prompt-file "$SCR/l-prompt.txt" --timeout 7m --base develop > "$SCR/l.stdout" 2> "$SCR/l.stderr"; local rc=$?
  sleep 3
  tmux -L "$SOCK" kill-server >/dev/null 2>&1 || true   # belt and braces: our private socket only
  kill_scratch_procs
  local mf csid; mf="$(for m in $(find "$runs" -name '*.manifest.json'); do [ "$(json_file_field "$m" 'o.runner')" = cc-shim ] && echo "$m"; done | head -1)"; csid=""
  [ -n "$mf" ] && csid="$(json_file_field "$mf" 'o.child_session_id')"
  local asid; asid="$(sed -n 's/.*\[--session-id\] \[\([^]]*\)\].*/\1/p' "$sent/l.wrapper.txt" 2>/dev/null | head -1)"
  local reasons; reasons="$(judge_l "$sent/l-hook.env" "$csid" "$asid" "$MODE_DIR/$csid.json" "$MODE_DIR/$U2.json" "$P")"
  jq -n --arg P "$P" --arg csid "$csid" --arg asid "$asid" --arg U2 "$U2" --argjson rc "$rc" \
    --arg henv "$(tr '\n' ' ' < "$sent/l-hook.env" 2>/dev/null)" --arg benv "$(tr '\n' ' ' < "$sent/l-child-bash-env.txt" 2>/dev/null)" \
    --arg tenv "$(tr '\n' ' ' < "$sent/l2-tmux-env.txt" 2>/dev/null)" --arg t2hook "$(tr '\n' ' ' < "$sent/l2-hook.env" 2>/dev/null)" --arg tlog "$(tr '\n' ' ' < "$sent/l-tmux.log" 2>/dev/null)" \
    --arg cmk "$(jq -c . "$MODE_DIR/$csid.json" 2>/dev/null)" --arg tmk "$(jq -c . "$MODE_DIR/$U2.json" 2>/dev/null)" --arg why "$reasons" \
    '{launcher_session_id_P:$P,hetero_rc:$rc,manifest_child_session_id:$csid,wrapper_argv_session_id:$asid,tmux_started_session_id:$U2,child_hook_env:$henv,child_bash_env:$benv,tmux_server_env_seen_by_second_claude:$tenv,second_claude_hook_env:$t2hook,tmux_log:$tlog,child_marker:$cmk,tmux_claude_marker:$tmk,failed_conditions:$why}' > "$SCR/l.detail.json"
  copy_raw l "$sent" "$SCR/l.stdout" "$SCR/l.stderr" "$mf" "$MODE_DIR/$csid.json" "$MODE_DIR/$U2.json" "$SCR/l-prompt.txt"
  if [ -z "$mf" ] || [ -z "$csid" ]; then rec l not_run "hetero cc-shim produced no manifest / child session id (rc=$rc; see raw/l)" "$SCR/l.detail.json"
  elif [ -z "$reasons" ]; then rec l pass "hetero cc-shim child's hook env had AUTOPILOT_CHILD_SESSION_ID == manifest child_session_id == --session-id; child marker parent == P; the claude started in a real tmux (private socket) wrote a marker with no parent_session_id" "$SCR/l.detail.json"
  else rec l bad "$(echo "$reasons" | tr '\n' ';')" "$SCR/l.detail.json"; fi
}

# ====================================================================================== drive
want_row() { [[ ",$ROWS," == *,"$1",* ]]; }
want_any() { local r; for r in "$@"; do want_row "$r" && return 0; done; return 1; }
want_row a && row_a
want_row b && row_b
want_any c f && row_cf
want_row d1 && row_d1
want_row d2 && row_d2
want_any e k && row_ek
want_any g h i && row_ghi "$ROWS"
want_row j && row_j
want_row l && row_l

# a requested row that left no verdict is a probe malfunction
RC=0
for r in ${ROWS//,/ }; do [ -f "$ROWD/$r.json" ] || { log "row $r left no verdict"; RC=1; }; done
[ "$RC" -eq 0 ] || true

# --------------------------------------------------------------------------------------- assemble
mkdir -p "$(dirname "$OUT")"
ORDER='["a","b","c","d1","d2","e","f","g","h","i","j","k","l"]'
jq -s --argjson order "$ORDER" --arg ver "$CLAUDE_VERSION" --arg omit "$OMIT" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{schema:"autopilot.d0-result/1",plan:"docs/plans/2026-10-13-dispatch-tree.md",generated_at:$ts,claude_version:$ver,omit_sentinel_negative_control:($omit=="1"),
    rows:([.[]]|sort_by(.row as $r|$order|index($r))),
    blocking:{"3a":["a","b","c"],"3b":["a","f"],"3c":[],"5":["g","h","i"],"R":["c","d1","d2","e","f","k"],"3d":["l"]}}' "$ROWD"/*.json > "$SCR/result.json" || { log "assemble failed"; exit 1; }

# redact + scan the raw dumps, then publish them next to the result
SECRETS="$SCR/secrets.json"
node -e '
const fs=require("fs");const out=[];
for (const [k,v] of Object.entries(process.env)) if (/TOKEN|API_KEY|SECRET/.test(k) && v && v.length>=8) out.push(v);
const add=(f)=>{try{const t=fs.readFileSync(f,"utf8");for(const m of t.matchAll(/^(?:export\s+)?[A-Za-z0-9_]*(?:TOKEN|API_KEY)[A-Za-z0-9_]*=(.+)$/gm)) out.push(m[1].replace(/^["\x27]|["\x27]$/g,""));}catch(e){}};
add(process.env.REAL_HOME+"/.autopilot/endpoints.env");
try{const c=JSON.parse(fs.readFileSync(process.env.REAL_HOME+"/.claude/.credentials.json","utf8"));const walk=(o)=>{for(const v of Object.values(o||{})){if(typeof v==="string"&&v.length>=16)out.push(v);else if(v&&typeof v==="object")walk(v);}};walk(c);}catch(e){}
fs.writeFileSync(process.argv[1],JSON.stringify([...new Set(out)]));' "$SECRETS" 2>/dev/null
export REAL_HOME
node -e '
const fs=require("fs");const out=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const add=(f)=>{try{const t=fs.readFileSync(f,"utf8");for(const m of t.matchAll(/^(?:export\s+)?[A-Za-z0-9_]*(?:TOKEN|API_KEY)[A-Za-z0-9_]*=(.+)$/gm)) out.push(m[1].replace(/^["\x27]|["\x27]$/g,""));}catch(e){}};
add(process.env.REAL_HOME+"/.autopilot/endpoints.env");
try{const c=JSON.parse(fs.readFileSync(process.env.REAL_HOME+"/.claude/.credentials.json","utf8"));const walk=(o)=>{for(const v of Object.values(o||{})){if(typeof v==="string"&&v.length>=16)out.push(v);else if(v&&typeof v==="object")walk(v);}};walk(c);}catch(e){}
fs.writeFileSync(process.argv[1],JSON.stringify([...new Set(out)]));' "$SECRETS"
cp "$SCR/result.json" "$RAW/result.json"
node "$SCR/js/redact.js" "$RAW" "$SECRETS" || { log "SECRET SCAN FAILED: nothing published"; exit 1; }
node "$SCR/js/redact.js" "$RAW" "$SECRETS" >/dev/null || { log "SECRET SCAN FAILED after redaction: nothing published"; exit 1; }
rm -f "$RAW/result.json"
if [ "$OMIT" -eq 0 ]; then rm -rf "$RAW_OUT"; mkdir -p "$RAW_OUT"; cp -r "$RAW"/. "$RAW_OUT"/; fi
# the result file itself holds evidence strings built from dumps: scan it too
cp "$SCR/result.json" "$SCR/result.scan.d.json"; mkdir -p "$SCR/scan-result"; cp "$SCR/result.json" "$SCR/scan-result/result.json"
node "$SCR/js/redact.js" "$SCR/scan-result" "$SECRETS" >/dev/null || { log "SECRET SCAN FAILED on result: nothing published"; exit 1; }
cp "$SCR/scan-result/result.json" "$OUT"
log "wrote $OUT"; jq -r '.rows[]|"  \(.row)\t\(.status)"' "$OUT" >&2

if [ "$OMIT" -eq 1 ]; then
  st="$(jq -r '.rows[]|select(.row=="a")|.status' "$OUT")"
  [ "$st" = bad ] && { log "negative control: row a is bad, as required"; exit 0; }
  log "NEGATIVE CONTROL FAILED: row a reported '$st' with no sentinel and autostart off"; exit 1
fi
exit "$RC"
