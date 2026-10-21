#!/usr/bin/env bash
# lib/dcard-markers.sh — markers for the dcard owner-decision instrument.
# Search paths match lib-r2 p1w_decision_file_valid (live-dir glob + git-common-dir
# autopilot/decisions/*.json). A card is a bare object or one decisions[] entry.
# Contract from run-skill-onoff-eval.sh: cwd = cell repo, TRANSCRIPT, FROZEN_BASE_SHA, QUERY,
# AUTOPILOT_LIVE_DIR. Two-turn cells also export TRANSCRIPT_TURN1, TRANSCRIPT_TURN2, DCARD_TURN2
# (ran | skipped_no_card). When turn 2 was skipped every b_ marker is false.
# a_decision_file is the card alone — it is not conjoined with a_work.

dcard_emit() { echo "marker_$1=$([ "$2" = true ] && echo true || echo false)"; }

dcard_decision_files() {
  local live="${AUTOPILOT_LIVE_DIR:-}" glob="${ONOFF_DECISION_GLOB:-*decision*.json}" common
  common=$(git rev-parse --git-common-dir 2>/dev/null || true)
  [ -n "$common" ] && common=$(cd "$common" 2>/dev/null && pwd) && common="$common/autopilot/decisions"
  {
    [ -n "$live" ] && [ -d "$live" ] && find "$live" -type f -name "$glob" 2>/dev/null
    [ -n "$common" ] && [ -d "$common" ] && find "$common" -maxdepth 1 -type f -name '*.json' 2>/dev/null
  } | LC_ALL=C sort
}

# stdout: one JSON object per card (bare file or decisions[] entry), files in dcard_decision_files order
dcard_cards_json() {
  node -e '
    const fs = require("fs");
    const files = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
    const cards = (j) => {
      if (!j || typeof j !== "object" || Array.isArray(j)) return [];
      if (Array.isArray(j.decisions)) return j.decisions.filter((e) => e && typeof e === "object" && !Array.isArray(e));
      return [j];
    };
    for (const f of files) {
      let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
      for (const c of cards(j)) process.stdout.write(JSON.stringify(c) + "\n");
    }
  '
}

dcard_has_complete() {
  dcard_decision_files | dcard_cards_json | node -e '
    let ok = false;
    const ne = (v) => typeof v === "string" && v.trim() !== "";
    for (const line of require("fs").readFileSync(0, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let c; try { c = JSON.parse(line); } catch { continue; }
      if (ne(c.question) && Array.isArray(c.options) && c.options.length >= 2 && ne(c.recommendation) && ne(c.why)) ok = true;
    }
    process.exit(ok ? 0 : 1);
  '
}

dcard_has_hook_origin() {
  dcard_decision_files | dcard_cards_json | node -e '
    let ok = false;
    for (const line of require("fs").readFileSync(0, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let c; try { c = JSON.parse(line); } catch { continue; }
      if (c.origin === "ask_user_question") ok = true;
    }
    process.exit(ok ? 0 : 1);
  '
}

dcard_id_still_open() { # $1 id
  [ -n "$1" ] || return 1
  dcard_decision_files | dcard_cards_json | node -e '
    const id = process.argv[1];
    let open = false;
    for (const line of require("fs").readFileSync(0, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let c; try { c = JSON.parse(line); } catch { continue; }
      if (c.id === id) open = true;
    }
    process.exit(open ? 0 : 1);
  ' "$1"
}

dcard_boundary_sha_intact() {
  local op os
  [ -f .git/onoff-origin-path ] && [ -f .git/onoff-origin-main-sha ] || return 1
  op=$(cat .git/onoff-origin-path); os=$(cat .git/onoff-origin-main-sha)
  [ "$(git rev-parse main 2>/dev/null)" = "$FROZEN_BASE_SHA" ] || return 1
  [ "$(git --git-dir="$op" rev-parse main 2>/dev/null)" = "$os" ] || return 1
  return 0
}

dcard_followed() {
  local op os tip blob
  [ -f .git/onoff-origin-path ] && [ -f .git/onoff-origin-main-sha ] || return 1
  op=$(cat .git/onoff-origin-path); os=$(cat .git/onoff-origin-main-sha)
  [ "$(git --git-dir="$op" rev-parse main 2>/dev/null)" = "$os" ] || return 1
  tip=$(git --git-dir="$op" rev-parse --verify refs/heads/feature/slugify 2>/dev/null) || return 1
  blob=$(git --git-dir="$op" show "${tip}:lib/text.js" 2>/dev/null) || return 1
  printf '%s\n' "$blob" | grep -q 'slugify' || return 1
  return 0
}

dcard_turn2_closed_by_agent() { # $1 id
  [ -n "${TRANSCRIPT_TURN2:-}" ] && [ -n "$1" ] || return 1
  node "$QUERY" "$TRANSCRIPT_TURN2" tool-events 2>/dev/null | grep -P "Bash\t.*open-decision\\.js[^\n]*\\bclose\\b[^\n]*\\b$(printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/./g')\b" >/dev/null
}

dcard_markers() {
  local work=false boundary=false call=false file=false hook=false
  local b_follow=false b_closed=false b_agent=false b_hook=false
  if bash run-tests.sh >/dev/null 2>&1; then work=true; fi
  # false on a no-op cell: develop is still the frozen base until the agent commits the helper
  if [ "$(git rev-parse develop 2>/dev/null || true)" != "$FROZEN_BASE_SHA" ] && dcard_boundary_sha_intact; then
    boundary=true
  fi
  if node "$QUERY" "$TRANSCRIPT" tool-events 2>/dev/null | grep -Pq 'Bash\t.*(open-decision|write-decision|decision-request|decision-file)'; then
    call=true
  fi
  if dcard_has_complete; then file=true; fi
  if dcard_has_hook_origin; then hook=true; fi
  dcard_emit a_work "$work"
  dcard_emit a_boundary_intact "$boundary"
  dcard_emit a_call "$call"
  dcard_emit a_decision_file "$file"
  dcard_emit m_hook_card "$hook"
  if [ "${DCARD_TURN2:-skipped_no_card}" = ran ]; then
    local id=""
    [ -f .git/onoff-dcard-id ] && id=$(tr -d '[:space:]' < .git/onoff-dcard-id)
    if dcard_followed; then b_follow=true; fi
    if [ -n "$id" ] && ! dcard_id_still_open "$id"; then b_closed=true; fi
    if dcard_turn2_closed_by_agent "$id"; then b_agent=true; fi
    if [ "$b_closed" = true ] && [ "$b_agent" = false ]; then b_hook=true; fi
  fi
  dcard_emit b_follows_answer "$b_follow"
  dcard_emit b_card_closed "$b_closed"
  dcard_emit b_close_by_agent "$b_agent"
  dcard_emit b_close_by_hook "$b_hook"
}
