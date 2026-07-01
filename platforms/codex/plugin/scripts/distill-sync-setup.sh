#!/usr/bin/env bash
# distill-sync-setup.sh — one-time onboarding plumbing for the distill pack sync.
#
# distill writes approved GLOBAL skills into the pack
#   ~/.claude/skills/autopilot-distill-skills/   (also a @skills-dir plugin)
# and PROJECT-scoped skills into <repo>/.claude/skills/. Both need a little
# git setup to propagate across machines / teammates. This script does that
# setup deterministically so nobody hand-copies it wrong — in particular the
# .gitignore negation, where the obvious `.claude/` + `!.claude/skills/` form
# is SILENTLY BROKEN (git can't re-include under a fully-excluded parent).
#
# It is the executable companion to skills/distill/references/sync-setup.md.
#
# Usage:
#   scripts/distill-sync-setup.sh status                 # report current state (JSON)
#   scripts/distill-sync-setup.sh init-remote <git-url>  # add origin + push -u (pack machine #1)
#   scripts/distill-sync-setup.sh enroll <git-url>       # clone the pack (a new machine)
#   scripts/distill-sync-setup.sh fix-gitignore [repo]   # make <repo|cwd> track .claude/skills/
#   scripts/distill-sync-setup.sh --help
#
# Every subcommand is idempotent: re-running a completed step reports "already
# done" and exits 0. Exit codes: 0 ok / 2 usage error / 1 action failed.

set -euo pipefail

PACK_DIR="${AUTOPILOT_DISTILL_PACK_DIR:-$HOME/.claude/skills/autopilot-distill-skills}"
PROBE=".claude/skills/__distill_probe__/SKILL.md"   # check-ignore works on non-existent paths
SIBLING_PROBE=".claude/__distill_nonskill_probe__"  # a non-skills path under .claude/

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

# Ensure a file ends in a newline before we `>>` onto it — otherwise the append
# concatenates onto the last line and silently mangles the user's existing rule
# (e.g. `.claude/*` + append → `.claude/*!.claude/skills/`, which un-ignores
# everything under .claude/). No-op on empty files and files already ending in \n.
ensure_trailing_nl() {
  local f="$1"
  [ -s "$f" ] || return 0
  [ -n "$(tail -c1 "$f")" ] && printf '\n' >> "$f"
  return 0
}

# ── status ───────────────────────────────────────────────────────────────────
cmd_status() {
  local exists=false has_git=false has_remote=false remote="" branch="" upstream=false
  if [ -d "$PACK_DIR" ]; then
    exists=true
    if git -C "$PACK_DIR" rev-parse --git-dir >/dev/null 2>&1; then
      has_git=true
      branch="$(git -C "$PACK_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
      remote="$(git -C "$PACK_DIR" remote get-url origin 2>/dev/null || echo '')"
      [ -n "$remote" ] && has_remote=true
      git -C "$PACK_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 && upstream=true
    fi
  fi
  printf '{"pack_dir":"%s","exists":%s,"is_git_repo":%s,"has_remote":%s,"remote":"%s","branch":"%s","has_upstream":%s}\n' \
    "$PACK_DIR" "$exists" "$has_git" "$has_remote" "$remote" "$branch" "$upstream"

  # Human-readable next-step hint on stderr (keeps stdout clean JSON).
  if ! $exists; then
    echo "→ no pack yet. New machine? 'enroll <git-url>'. Or run /autopilot:distill once to create it, then 'init-remote <git-url>'." >&2
  elif $has_git && ! $has_remote; then
    echo "→ pack exists but has NO remote = single on-disk copy (durability risk). Run: init-remote <git-url>" >&2
  elif $has_remote; then
    echo "→ pack remote OK ($remote). Routine: git -C \"$PACK_DIR\" pull --rebase / push." >&2
  fi
}

# ── init-remote <url> ────────────────────────────────────────────────────────
cmd_init_remote() {
  local url="${1:-}"
  [ -n "$url" ] || { echo "ERROR: init-remote needs a git URL" >&2; exit 2; }
  [ -d "$PACK_DIR" ] || { echo "ERROR: pack not found at $PACK_DIR — run /autopilot:distill once (creates+commits it) or 'enroll <url>' first." >&2; exit 1; }
  git -C "$PACK_DIR" rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: $PACK_DIR is not a git repo." >&2; exit 1; }

  local existing; existing="$(git -C "$PACK_DIR" remote get-url origin 2>/dev/null || echo '')"
  if [ -n "$existing" ]; then
    echo "already done ✓ — origin = $existing" >&2
    cmd_status; return 0
  fi
  local branch; branch="$(git -C "$PACK_DIR" rev-parse --abbrev-ref HEAD)"
  echo "adding origin=$url and pushing '$branch' with upstream…" >&2
  git -C "$PACK_DIR" remote add origin "$url"
  if git -C "$PACK_DIR" push -u origin "$branch"; then
    echo "remote set + pushed ✓ (durability now off-machine)" >&2
  else
    echo "ERROR: push failed (auth? empty repo on remote?). Remote was added; fix auth then: git -C \"$PACK_DIR\" push -u origin $branch" >&2
    exit 1
  fi
}

# ── enroll <url> ─────────────────────────────────────────────────────────────
cmd_enroll() {
  local url="${1:-}"
  [ -n "$url" ] || { echo "ERROR: enroll needs a git URL" >&2; exit 2; }
  if [ -d "$PACK_DIR" ] && [ -n "$(ls -A "$PACK_DIR" 2>/dev/null)" ]; then
    echo "already done ✓ — $PACK_DIR exists and is non-empty (not re-cloning)." >&2
    cmd_status; return 0
  fi
  local first_skills_dir=false
  [ -d "$HOME/.claude/skills" ] || first_skills_dir=true
  echo "cloning pack → $PACK_DIR…" >&2
  git clone "$url" "$PACK_DIR"
  echo "enrolled ✓" >&2
  $first_skills_dir && echo "NOTE: ~/.claude/skills was just created — restart Claude Code once so it watches the new skill dir." >&2
}

# ── fix-gitignore [repo] ─────────────────────────────────────────────────────
# Make <repo|cwd> track .claude/skills/ while keeping the rest of .claude/ ignored.
cmd_fix_gitignore() {
  local repo="${1:-$PWD}"
  local root; root="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null || echo '')"
  [ -n "$root" ] || { echo "ERROR: $repo is not inside a git repo" >&2; exit 1; }

  if ! git -C "$root" check-ignore -q "$PROBE"; then
    echo "already correct ✓ — $root already tracks .claude/skills/ (nothing to do)." >&2
    return 0
  fi

  # Record whether non-skills .claude/ state is ignored BEFORE we edit, so we can
  # prove the edit didn't accidentally un-ignore it (the trailing-newline failure
  # mode). If it was ignored, it MUST stay ignored.
  local pre_sibling_ignored=no
  git -C "$root" check-ignore -q "$SIBLING_PROBE" && pre_sibling_ignored=yes

  local gi="$root/.gitignore" marker="# Track distilled skills (autopilot:distill)"
  touch "$gi"
  if grep -qE '^\.claude/?$' "$gi"; then
    # Broken bare `.claude/` excludes the dir itself → git never descends, so
    # negations are useless. Replace with the contents form, which DOES descend.
    local tmp; tmp="$(mktemp)"
    awk 'BEGIN{done=0}
         /^\.claude\/?$/ && !done {print ".claude/*"; print "!.claude/skills/"; done=1; next}
         {print}' "$gi" > "$tmp"
    mv "$tmp" "$gi"
    echo "patched: replaced bare '.claude/' with '.claude/*' + '!.claude/skills/' in $gi" >&2
  elif grep -qE '^\.claude/\*\*$' "$gi" && ! grep -qE '^!\.claude/skills/\*\*$' "$gi"; then
    # Recursive glob: dir isn't excluded, but contents are at every depth — needs
    # BOTH the dir negation and a contents negation (empirically verified).
    ensure_trailing_nl "$gi"
    printf '!.claude/skills/\n!.claude/skills/**\n' >> "$gi"
    echo "patched: added '!.claude/skills/' + '!.claude/skills/**' for existing '.claude/**' in $gi" >&2
  elif grep -qE '^\.claude/\*$' "$gi" && ! grep -qE '^!\.claude/skills/?$' "$gi"; then
    ensure_trailing_nl "$gi"
    printf '!.claude/skills/\n' >> "$gi"
    echo "patched: added '!.claude/skills/' negation to existing '.claude/*' in $gi" >&2
  elif grep -qF "$marker" "$gi"; then
    # Our block is already present yet the probe is still ignored → some other
    # rule wins. Don't append again (idempotent); fall through to the WARN below.
    :
  else
    ensure_trailing_nl "$gi"
    {
      printf '%s while ignoring other .claude/ state.\n' "$marker"
      printf '.claude/*\n!.claude/skills/\n'
    } >> "$gi"
    echo "patched: appended '.claude/*' + '!.claude/skills/' block to $gi" >&2
  fi

  # Verify BOTH halves: skills now tracked, AND non-skills .claude/ state still
  # ignored if it was before (catches an edit that corrupted a parent rule).
  if git -C "$root" check-ignore -q "$PROBE"; then
    echo "WARN: .claude/skills/ is STILL ignored — another rule is involved:" >&2
    git -C "$root" check-ignore -v "$PROBE" >&2 || true
    exit 1
  fi
  if [ "$pre_sibling_ignored" = yes ] && ! git -C "$root" check-ignore -q "$SIBLING_PROBE"; then
    echo "ERROR: the edit un-ignored non-skills .claude/ state (e.g. settings.json) — your .gitignore" >&2
    echo "       may be corrupted. Inspect $gi and revert if needed (git checkout -- .gitignore)." >&2
    exit 1
  fi
  echo "fixed ✓ — verify: git -C \"$root\" check-ignore .claude/skills/<name>/SKILL.md  (should print nothing)" >&2
}

# ── dispatch ─────────────────────────────────────────────────────────────────
case "${1:---help}" in
  status)        cmd_status ;;
  init-remote)   shift; cmd_init_remote "$@" ;;
  enroll)        shift; cmd_enroll "$@" ;;
  fix-gitignore) shift; cmd_fix_gitignore "$@" ;;
  -h|--help|help) usage ;;
  *) echo "ERROR: unknown subcommand '$1'" >&2; echo >&2; usage >&2; exit 2 ;;
esac
