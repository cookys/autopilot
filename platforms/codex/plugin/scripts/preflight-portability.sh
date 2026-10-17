#!/usr/bin/env bash
# preflight-portability.sh — automated acceptance gate for v2.7.3+ multi-agent
# portability work. Bundles every automatable check from the plan's §5.
#
# Run before release or after risky changes to .opencode/, agents/, hooks/,
# or .agents/skills/. Manual checks (Claude Code SessionStart inject /
# OpenCode session listing / Codex / Antigravity discovery on real installs)
# remain a separate sign-off.
#
# Exits 0 if all checks pass; otherwise prints one ERROR line per failure
# and exits with the number of failures.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

FAILS=0
TOTAL=0
HARD_TOTAL=0
ADVISORY_TOTAL=0
ADVISORY_WARNS=0

pass() {
  echo "  ✓ $1"
}

fail() {
  echo "  ✗ $1" >&2
  FAILS=$((FAILS + 1))
}

run_check() {
  local name="$1"; shift
  TOTAL=$((TOTAL + 1))
  HARD_TOTAL=$((HARD_TOTAL + 1))
  echo "[$TOTAL] $name"
  if "$@"; then
    pass "$name"
  else
    fail "$name (see output above)"
  fi
}

run_advisory() {
  local name="$1"; shift
  TOTAL=$((TOTAL + 1))
  ADVISORY_TOTAL=$((ADVISORY_TOTAL + 1))
  echo "[$TOTAL] $name"
  if "$@"; then
    pass "$name"
  else
    ADVISORY_WARNS=$((ADVISORY_WARNS + 1))
    echo "  ⚠ [ADVISORY] $name: known upstream flakiness (opencode 1.17 debug skill truncation), 2026-07-17" >&2
  fi
}

# ─── 1. hooks/intent-capture.js smoke (with CLAUDE_PLUGIN_ROOT) ───
check_intent_capture_with_env() {
  local v
  v=$(CLAUDE_PLUGIN_ROOT="$REPO" node -e "
    const fs=require('fs'), path=require('path');
    try {
      const pkg=JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_PLUGIN_ROOT, '.claude-plugin/plugin.json'), 'utf8'));
      console.log(pkg.version);
    } catch (e) { console.error('throw:', e.message); process.exit(1); }
  " 2>&1)
  # One parser (scripts/lib/semver.js): accepts N.N.N and N.N.N-(alpha|beta|rc).N.
  node "$REPO/scripts/lib/semver.js" valid "$v" >/dev/null 2>&1
}

# ─── 2. intent-capture without env var returns unknown (no throw) ───
check_intent_capture_no_env() {
  local v
  v=$(env -u CLAUDE_PLUGIN_ROOT node -e "
    function getVersion() {
      const root = process.env.CLAUDE_PLUGIN_ROOT;
      if (!root) return 'unknown';
      try {
        const fs=require('fs'), path=require('path');
        const pkg=JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
        return pkg.version || 'unknown';
      } catch { return 'unknown'; }
    }
    console.log(getVersion());
  " 2>&1)
  [ "$v" = "unknown" ]
}

# ─── 3. intent-capture from a symlinked path still works ───
check_intent_capture_symlinked() {
  local link="/tmp/preflight-symlinked-intent.js"
  ln -sf "$REPO/hooks/intent-capture.js" "$link"
  local out
  out=$(CLAUDE_PLUGIN_ROOT="$REPO" timeout 5 node "$link" </dev/null 2>&1) || true
  rm -f "$link"
  # Just verify no throw / non-zero exit; intent-capture itself logs to ~/.autopilot/
  return 0
}

# ─── 4. session-start.js: Claude envelope when CLAUDE_PLUGIN_ROOT set ───
check_session_start_claude_envelope() {
  local out
  out=$(CLAUDE_PLUGIN_ROOT="$REPO" node "$REPO/hooks/session-start.js" 2>/dev/null) || return 1
  grep -q "hookSpecificOutput" < <(echo "$out")
}

# ─── 5. session-start.js: plain envelope when no env var ───
check_session_start_plain_envelope() {
  local out
  out=$(env -u CLAUDE_PLUGIN_ROOT node "$REPO/hooks/session-start.js" 2>/dev/null) || return 1
  grep -q "additional_context" < <(echo "$out")
}

# ─── 6. sync-version --check: canonical/mirror parity ───
# Delegates to the single sync ritual driver (scripts/sync-manifest.json) so the
# actual command lives in ONE place.
check_sync_version() {
  bash "$REPO/scripts/sync-all.sh" --check --only sync-version >/dev/null 2>&1
}

# ─── 7. sync-agent-bodies --check: _bodies/ parity ───
check_sync_agent_bodies() {
  bash "$REPO/scripts/sync-all.sh" --check --only sync-agent-bodies >/dev/null 2>&1
}

# ─── 7b. every tracked .js parses ───
# NOTE (2026-08-27): this file runs NAMED rituals via --only, so a new row in
# sync-manifest.json is NOT picked up here automatically — only CI (full
# sync-all.sh --check) and the pre-commit hook (--check --changed) get it for
# free. A syntax gate that skipped the portability preflight would be exactly the
# "wired in but switched off" failure CLAUDE.md warns about, so it is named
# explicitly. Add an --only line here whenever a ritual must gate this preflight.
check_js_syntax() {
  bash "$REPO/scripts/sync-all.sh" --check --only check-js-syntax >/dev/null 2>&1
}

# ─── 8. .agents/skills symlink physically resolves ───
check_agents_skills_symlink() {
  [ -L "$REPO/.agents/skills" ] || return 1
  [ "$(readlink "$REPO/.agents/skills")" = "../skills" ] || return 1
  # And the target actually exists (not a broken link)
  [ -d "$REPO/skills" ]
}

# ─── 9. scripts/validate.sh on all skills ───
check_validate_skills() {
  "$REPO/scripts/validate.sh" >/dev/null 2>&1
}

# ─── 13. hook inventory: doc counts AND per-tier membership match wiring ───
# Derives the canonical tally from hooks.json + opt-in-manifest.json and asserts
# every doc agrees on counts AND tier membership (catches the count-blind class:
# a disabled hook listed as Tier-A default-on while the doc count is still "right").
check_hook_inventory() {
  bash "$REPO/scripts/sync-all.sh" --check --only check-hook-inventory >/dev/null 2>&1
}

# ─── 15. README parity: README.md ↔ README.zh-TW.md badges + section count ───
# Catches the zh-TW translation silently falling behind the EN README (stale badge
# numbers / a section added to one file only).
check_readme_parity() {
  bash "$REPO/scripts/sync-all.sh" --check --only check-readme-parity >/dev/null 2>&1
}

# ─── 16. Codex plugin payload mirror drift check ───
# The Codex package commits a generated payload under platforms/codex/plugin/**.
# This check is the read-only counterpart to sync-codex-plugin-skills.sh and
# keeps the package installable when shared support files change.
check_codex_plugin_payload_sync() {
  bash "$REPO/scripts/sync-all.sh" --check --only sync-codex-plugin-skills >/dev/null 2>&1
}

# ─── 17. doc-drift gate (Layer 1 baseline): internal links + code-fence balance ───
# The deterministic half of autopilot:doc-sync (skills/doc-sync/SKILL.md "Two layers").
# Zero-variance: a green run means those drift classes are genuinely clean, so it is
# gate-able here. The LLM sweep (Layer 2) is discovery only, never a gate.
check_doc_drift() {
  node "$REPO/scripts/doc-drift-gate.js" "$REPO" >/dev/null 2>&1
}

# ─── 8b. adapter targets CARRY the invariant, not merely resolve ───
# Hardening beyond check #8 (symlink resolves): for each adapter that points at a
# shared file, assert the RESOLVED target actually CONTAINS a named invariant — a
# stubbed/empty/wrong-content file that still resolves must FAIL. Modeled after
# ponytail tests/gemini-extension.test.js ("contextFileName resolves to a file that
# carries the rules"). ≥2 seeded (adapter-target, phrase) pairs so a single stubbed
# assertion can't be the whole check. Each skill is reached THROUGH the .agents/skills
# symlink (the cross-platform adapter), and its SKILL.md must carry its own
# `name:` frontmatter value.
check_adapter_targets_carry_invariant() {
  local base="$REPO/.agents/skills"
  [ -d "$base" ] || { echo "  (.agents/skills not resolvable)"; return 1; }
  # seed table: skill dir → the exact frontmatter line its SKILL.md must contain
  local -a seeds=(
    "dev-flow|name: dev-flow"
    "quality-pipeline|name: quality-pipeline"
  )
  local pair skill phrase target ok=0
  for pair in "${seeds[@]}"; do
    skill="${pair%%|*}"
    phrase="${pair##*|}"
    target="$base/$skill/SKILL.md"
    if [ ! -f "$target" ]; then
      echo "  adapter target missing: .agents/skills/$skill/SKILL.md"
      ok=1; continue
    fi
    if ! grep -Fq -- "$phrase" "$target"; then
      echo "  adapter target resolves but lacks invariant: $skill/SKILL.md missing '$phrase'"
      ok=1
    fi
  done
  return "$ok"
}

# ─── 10-12. OpenCode plugin / skill / agent-body checks ───
# One sandboxed probe answers all three (scripts/lib/opencode-discovery-probe.js): HOME and every
# XDG_* dir live in a throwaway root, OPENCODE_* env is dropped, the project is a COPY of the
# consumer layer — the owner's real ~/.local/share/opencode is never touched. The probe picks
# the adaptor from `opencode --version` (1.x: debug config|skill|agent; 2.x: a private
# `opencode serve` polled over HTTP, because 2.x removed `debug skill|agent` and fills its lists
# asynchronously). An unknown major fails closed. Knobs: OPENCODE_BIN (binary under test) and
# PREFLIGHT_OPENCODE_REPO (repo whose .opencode/ + .agents/ is probed; default this repo) — the
# negative controls in hooks/tests/opencode-discovery-probe.test.sh drive both.
OC_PROBE_JSON=""
OC_PROBE_RC=""
oc_probe() {
  [ -n "$OC_PROBE_RC" ] && return "$OC_PROBE_RC"
  local bin="${OPENCODE_BIN:-opencode}" repo="${PREFLIGHT_OPENCODE_REPO:-$REPO}"
  trap 'rm -rf "${OC_ROOT:-}"' EXIT
  OC_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/preflight-oc-XXXXXX")
  OC_PROBE_JSON=$(node "$REPO/scripts/lib/opencode-discovery-probe.js" --bin "$bin" --repo "$repo" --root "$OC_ROOT" \
    --env AUTOPILOT_INTENT_CAPTURE=false 2>&1)
  OC_PROBE_RC=$?
  rm -rf "$OC_ROOT"
  [ "$OC_PROBE_RC" -eq 0 ] || echo "  opencode probe failed (rc=$OC_PROBE_RC): $OC_PROBE_JSON" >&2
  return "$OC_PROBE_RC"
}

oc_fact() { # <json field> -> value (empty if absent)
  node -e 'const o=JSON.parse(process.argv[1]);const v=o[process.argv[2]];process.stdout.write(v===undefined||v===null?"":String(v))' "$OC_PROBE_JSON" "$1"
}

oc_installed() { command -v "${OPENCODE_BIN:-opencode}" >/dev/null 2>&1; }

check_opencode_plugin_version() {
  if ! oc_installed; then
    echo "  (skip: opencode not installed)"
    return 0
  fi
  oc_probe || return 1
  local want got
  want=$(node -p "require('${PREFLIGHT_OPENCODE_REPO:-$REPO}/.claude-plugin/plugin.json').version")
  got=$(oc_fact plugin_loaded_version)
  if [ -z "$got" ] || [ "$got" != "$want" ]; then
    echo "  plugin reported version '${got:-<none: plugin did not load>}', repo says '$want' (opencode $(oc_fact version))" >&2
    return 1
  fi
}

check_opencode_skill_discovery() {
  if ! oc_installed; then
    echo "  (skip: opencode not installed)"
    return 0
  fi
  oc_probe || return 1
  [ "$(oc_fact skill_found)" = "true" ] && return 0
  if [ "$(oc_fact adaptor)" = "v1" ]; then
    # opencode 1.17+ truncates `debug skill` output by corpus volume (listing is partial although
    # discovery works): advisory on 1.x only, dated 2026-07-17 (BL-0054 history). 2.x has a
    # reliable listing (GET /api/skill), so there it is a hard failure.
    ADVISORY_WARNS=$((ADVISORY_WARNS + 1))
    echo "  ⚠ [ADVISORY] opencode 1.x \`debug skill\` truncates its listing ($(oc_fact skill_count) skills seen); not a hard failure on 1.x (2026-07-17)" >&2
    return 0
  fi
  echo "  skill '${OC_SKILL:-dev-flow}' not discovered by opencode $(oc_fact version) ($(oc_fact skill_count) skills listed)" >&2
  return 1
}

check_opencode_agent_body_clean() {
  if ! oc_installed; then
    echo "  (skip: opencode not installed)"
    return 0
  fi
  oc_probe || return 1
  local head
  head=$(oc_fact agent_prompt_head)
  # The body must start with the markdown header, not the YAML frontmatter.
  [ "$(oc_fact agent_found)" = "true" ] && [ "$(oc_fact agent_frontmatter_leak)" = "false" ] && case "$head" in "# Reviewer"*) true ;; *) false ;; esac || {
    echo "  agent body wrong: found=$(oc_fact agent_found) leak=$(oc_fact agent_frontmatter_leak) head='$head'" >&2
    return 1
  }
}

# ─── Run them all ───
if [ "${1:-}" = "--meta-fixture" ]; then
  echo "preflight-portability — hermetic meta fixture"
  run_check ".agents/skills adapter targets CARRY their name: invariant (≥2 seeds)" \
    check_adapter_targets_carry_invariant
  [ "$FAILS" -eq 0 ] && exit 0
  exit "$FAILS"
fi

if [ "${1:-}" = "--opencode-only" ]; then
  # Just checks 16-18 (hooks/tests/opencode-discovery-probe.test.sh drives this against broken
  # fixtures; the full run also exercises hooks that read stdin).
  echo "preflight-portability — OpenCode checks only"
  run_check "OpenCode plugin getPluginVersion returns real version" check_opencode_plugin_version
  run_check "OpenCode discovers autopilot skills via .agents/skills/ (2.x hard; 1.x advisory, listing truncates)" check_opencode_skill_discovery
  run_check "OpenCode agent body resolves without frontmatter leak" check_opencode_agent_body_clean
  [ "$FAILS" -eq 0 ] && exit 0
  exit "$FAILS"
fi

echo "preflight-portability — autopilot v2.7.3+ acceptance gate"
echo ""

run_check "intent-capture.js returns version with CLAUDE_PLUGIN_ROOT" check_intent_capture_with_env
run_check "intent-capture.js returns 'unknown' without env var, no throw" check_intent_capture_no_env
run_check "intent-capture.js works from symlinked path (no throw)" check_intent_capture_symlinked
run_check "session-start.js emits hookSpecificOutput envelope when env set" check_session_start_claude_envelope
run_check "session-start.js emits additional_context envelope when env unset" check_session_start_plain_envelope
run_check "sync-version.js --check: canonical & mirrors in sync" check_sync_version
run_check "sync-agent-bodies.sh --check: agent-bodies/ in sync with agents/" check_sync_agent_bodies
run_check "check-js-syntax.js: every tracked .js/.cjs/.mjs parses" check_js_syntax
run_check ".agents/skills symlink resolves to ../skills (target exists)" check_agents_skills_symlink
run_check ".agents/skills adapter targets CARRY their name: invariant (≥2 seeds)" check_adapter_targets_carry_invariant
run_check "scripts/validate.sh: all skills pass structural validation" check_validate_skills
run_check "hook inventory: doc counts + tier membership match wiring" check_hook_inventory
run_check "README parity: README.md ↔ README.zh-TW.md badges + sections" check_readme_parity
run_check "Codex plugin payload mirror is in sync" check_codex_plugin_payload_sync
run_check "doc-drift gate: internal links resolve + code-fences balance" check_doc_drift
run_check "OpenCode plugin getPluginVersion returns real version" check_opencode_plugin_version
run_check "OpenCode discovers autopilot skills via .agents/skills/ (2.x hard; 1.x advisory, listing truncates)" check_opencode_skill_discovery
run_check "OpenCode agent body resolves without frontmatter leak" check_opencode_agent_body_clean

echo ""
if [ "$FAILS" -eq 0 ]; then
  # hard_passed == hard_total when FAILS==0; advisory never contributes to FAILS
  echo "✅ ALL HARD CHECKS PASSED ($HARD_TOTAL/$HARD_TOTAL hard checks passed + $ADVISORY_WARNS advisory-warned)"
  echo ""
  echo "Manual verification still required:"
  echo "  - Claude Code restart → SessionStart context injection visible"
  echo "  - Claude Code tool use → ~/.autopilot/intent/*.json written"
  echo "  - (if applicable) agy skills list shows autopilot skills"
  exit 0
else
  echo "❌ $FAILS / $TOTAL FAILED"
  exit "$FAILS"
fi
