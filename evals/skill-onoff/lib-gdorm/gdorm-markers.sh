#!/usr/bin/env bash
# lib-gdorm/gdorm-markers.sh — gdorm markers. ONOFF_LIB_OVERRIDE points here.
# A marker is true only from a Bash tool_use in the transcript, or from a real
# file in the cell. The agent's own prose never counts.
# Requires: TRANSCRIPT, QUERY. Optional: ONOFF_OUT, ONOFF_CELL_HOME.
# run-skill-onoff-eval-gdorm.sh exports both before this file runs. The shared
# runner does not, so gdorm cells must use the gdorm runner.
set -u

gdorm_emit() { echo "marker_$1=$([ "$2" = true ] && echo true || echo false)"; }

# $1 script basename. $2 optional subcommand that must follow the path (import).
# A hit is an execution, not a read. The command is split on newlines, ';',
# '&&', '||', and '|'. In that simple command the script path is the first
# word, or it is preceded by node/npx/bash/sh (env may wrap that token).
# cat head tail grep less sed awk ls wc stat file diff cmp never count.
gdorm_bash_hit() {
  local base="$1" sub="${2:-}"
  [ -n "${TRANSCRIPT:-}" ] && [ -n "${QUERY:-}" ] && [ -f "$TRANSCRIPT" ] || return 1
  node - "$TRANSCRIPT" "$base" "$sub" << 'JS'
const fs = require('fs');
const file = process.argv[2];
const base = process.argv[3];
const sub = process.argv[4] || '';
const READERS = new Set(['cat','head','tail','grep','less','sed','awk','ls','wc','stat','file','diff','cmp']);
const EXECS = new Set(['node','npx','bash','sh']);
let text;
try { text = fs.readFileSync(file, 'utf8'); } catch { process.exit(1); }
const commands = [];
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  let j;
  try { j = JSON.parse(line); } catch { continue; }
  const content = j && j.message && j.message.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (!b || b.type !== 'tool_use' || b.name !== 'Bash') continue;
    const cmd = b.input && typeof b.input.command === 'string' ? b.input.command : '';
    if (cmd) commands.push(cmd);
  }
}
function leaf(w) {
  const s = w.replace(/^['"]|['"]$/g, '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}
function heredocOpener(segment) {
  // <<[-]['"]?WORD['"]? at the end of a segment. Quotes around the word must match.
  const m = segment.match(/<<(-?)\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z0-9_]+))\s*$/);
  if (!m) return null;
  return { strip: m[1] === '-', delim: m[2] ?? m[3] ?? m[4] };
}
function simples(cmd) {
  const parts = [];
  let cur = '';
  let quote = null;
  // A heredoc opener ends a segment. The body starts at the next unquoted
  // newline and is not a command. The closer is a line that is exactly the
  // delimiter (leading tabs stripped only for <<-).
  let pending = null;
  let skipping = null;
  const pushSeg = () => {
    const spec = heredocOpener(cur);
    parts.push(cur);
    cur = '';
    if (spec) pending = spec;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (skipping) {
      if (c === '\n') {
        let line = skipping.line;
        if (skipping.strip) line = line.replace(/^\t+/, '');
        skipping.line = '';
        if (line === skipping.delim) skipping = null;
      } else {
        skipping.line += c;
      }
      continue;
    }
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '\n' || c === ';') {
      pushSeg();
      if (c === '\n' && pending) {
        skipping = { strip: pending.strip, delim: pending.delim, line: '' };
        pending = null;
      }
      continue;
    }
    if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) {
      pushSeg(); i++; continue;
    }
    if (c === '|') { pushSeg(); continue; }
    cur += c;
  }
  if (!skipping) pushSeg();
  return parts;
}
function words(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s/.test(c)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
function isScript(w) {
  return w === base || w.endsWith('/' + base);
}
function executed(ws) {
  const idx = ws.findIndex(isScript);
  if (idx < 0) return false;
  if (READERS.has(leaf(ws[0]))) return false;
  let ok = false;
  if (idx === 0) ok = true;
  else {
    let j = 0;
    if (leaf(ws[j]) === 'env') {
      j++;
      while (j < idx && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[j]) || ws[j].startsWith('-'))) j++;
    }
    if (j < idx && EXECS.has(leaf(ws[j])) && ws.slice(j + 1, idx).every((t) => t.startsWith('-'))) ok = true;
  }
  if (!ok) return false;
  if (sub && !ws.slice(idx + 1).includes(sub)) return false;
  return true;
}
for (const cmd of commands) {
  for (const simple of simples(cmd)) {
    if (executed(words(simple))) process.exit(0);
  }
}
process.exit(1);
JS
}

# tree.js init writes <projects>/tree/events.jsonl. The cell repo is cwd.
# ONOFF_OUT is the kept cell directory, searched the same way.
gdorm_tree_event() {
  local root
  for root in . ${ONOFF_OUT:-}; do
    [ -n "$root" ] && [ -d "$root" ] || continue
    if find "$root" -type f -name events.jsonl -path '*/tree/*' -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  done
  return 1
}

gdorm_tree_markers() {
  local hit=false
  if gdorm_bash_hit 'tree.js'; then hit=true; fi
  if [ "$hit" != true ] && gdorm_tree_event; then hit=true; fi
  gdorm_emit t_tree_run "$hit"
}

gdorm_qc_markers() {
  local hit=false
  if gdorm_bash_hit 'qc-panel.js'; then hit=true; fi
  gdorm_emit q_qcpanel_run "$hit"
}

# Archive dir is review_ledger_archive.dir in the scratch HOME config.
gdorm_archive_dir() {
  [ -n "${ONOFF_CELL_HOME:-}" ] || return 1
  node -e '
    const fs = require("fs");
    const path = require("path");
    const home = process.argv[1];
    const cfgPath = path.join(home, ".autopilot", "config.json");
    let dir = "";
    try {
      const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      dir = j && j.review_ledger_archive && typeof j.review_ledger_archive.dir === "string"
        ? j.review_ledger_archive.dir : "";
    } catch { dir = ""; }
    if (!dir) process.exit(1);
    process.stdout.write(dir);
  ' "$ONOFF_CELL_HOME"
}

gdorm_archive_file() {
  local dir
  dir="$(gdorm_archive_dir)" || return 1
  [ -d "$dir" ] || return 1
  # A real ledger copy is a regular file under the archive root.
  find "$dir" -type f -print -quit 2>/dev/null | grep -q .
}

gdorm_archive_markers() {
  local imp=false file=false
  # Same Bash command must name the script and the import subcommand.
  if gdorm_bash_hit 'review-ledger-archive.js' import; then
    imp=true
  fi
  if gdorm_archive_file; then file=true; fi
  gdorm_emit r_archive_import "$imp"
  gdorm_emit r_archive_file "$file"
}
