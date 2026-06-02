# Session Handoff — 2026-06-02

> Next session: **read this file, then run the Verification Checklist below and report pass/fail.**
> Invoke: `讀 docs/HANDOFF.md 然後跑驗證`.

## TL;DR of what shipped this session

Three ships, all merged to `develop` and pushed (origin/develop @ `7a528ff`):

| Version | Project | Merge | What |
|---------|---------|-------|------|
| v2.7.7 | skill-leverage-extraction | `a4c5db6` | dev-flow 645→618, retro 225→130 (passive leaf → references/) |
| v2.7.7 | level-3 doc-rot batch | `2b5f6ed` | authored 2 missing canonical refs + hardened `validate.sh` link-check |
| **v2.8.0** | **hook-transcript-pivot** | `e6c7f25` | **the main one — see verification below** |

Plus: orphaned-plans triaged into INDEX; memories written (`project_skill-refactor-rules`, `project_hook-transcript-pivot`).

## Repo state (expected)
- Branch `develop`, clean, synced with origin (`7a528ff` or later).
- Canonical version `2.8.0` (`.claude-plugin/plugin.json`); `node scripts/sync-version.js --check` → green.
- Plugin is **dev-linked**: `~/.claude/plugins/cache/autopilot/autopilot/dev → /home/cookys/projects/autopilot`.
- No in-progress projects in `docs/projects/INDEX.md`.

## ⭐ PRIMARY verification — did the v2.8.0 hook pivot actually activate?

**Context**: Claude Code doesn't pipe stdin to PostToolUse hooks (ENXIO, #6305). v2.8.0 makes those hooks recover tool data from the session transcript JSONL instead. This **requires a full Claude Code restart** to take effect (PostToolUse dispatch inits at process boot; `/reload-plugins` does NOT re-init it — known finding in BACKLOG). The user was asked to restart between sessions — so if you're reading this in a fresh session, the pivot should be live.

Run these and report:

```bash
# 1. intent-capture last_tool should be a REAL tool name, not <unknown>
cat ~/.autopilot/intent/*.json 2>/dev/null | grep -E '"last_tool"|"last_tool_source"'
#    PASS: "last_tool": "Bash"/"Read"/... and "last_tool_source": "transcript"
#    FAIL: "last_tool": "<unknown>"  (pivot not active → see Diagnosis)

# 2. audit-log should now exist and contain recent commands (it NEVER existed pre-v2.8.0)
tail -3 ~/.claude/bash-commands.log 2>/dev/null || echo "MISSING — audit-log not firing"

# 3. confirm the live plugin is v2.8.0 with the new lib
grep -m1 '"version"' ~/.claude/plugins/cache/autopilot/autopilot/dev/.claude-plugin/plugin.json
test -f ~/.claude/plugins/cache/autopilot/autopilot/dev/hooks/transcript-reader-lib.js && echo "lib present"
```

**If FAIL (still `<unknown>` / no bash-commands.log):** diagnose, don't assume.
- Confirm a TRUE restart happened (not just `/reload-plugins`). Check the current session transcript is being written: `ls -t ~/.claude/projects/-home-cookys-projects-autopilot/*.jsonl | head -1`.
- Manually exercise the path: with the latest transcript present, run
  `node ~/projects/autopilot/hooks/intent-capture.js </dev/null` in a sandbox HOME (see `project_hook-transcript-pivot` memory for the isolated-HOME recipe) and inspect the written intent file.
- If transcript HAS the tool but the hook returns `<unknown>`, the bug is in path discovery / parsing → check `CLAUDE_CODE_SESSION_ID` is set in the hook env and `transcript-reader-lib.js resolveTranscriptPath`.
- If the live PostToolUse hook simply isn't firing at all → the dispatch-boot issue; confirm full restart.

**Optional definitive timing proof** (only if you want the intra-cycle race nailed): wire `hooks/_transcript-timing-probe.js` into a PostToolUse hook (its header has the recipe), fresh session, run `echo PROBE_MARKER_ONE`, check `~/.autopilot/timing-probe.log` tracks it.

## SECONDARY checks (fast sanity)
```bash
cd ~/projects/autopilot
bash scripts/validate.sh | tail -1                 # All skills valid
bash hooks/tests/run.sh 2>&1 | tail -2             # 29 test files pass
node --test hooks/transcript-reader.test.js 2>&1 | grep -E 'pass|fail' | tail -2   # 9 pass
git status -sb | head -1                            # clean, synced
```

## Open follow-ups (in BACKLOG, none urgent)
- **suggest-compact** — PostToolUse Write|Edit, recoverable via the same transcript pivot; deferred (not done). Easy next win if wanted.
- **cost-tracker / session-summary** — Stop events, env-driven; NOT the tool-event-stdin problem → separate verification before re-enabling.
- **PreToolUse hooks** (large-file-warner, branch-protection, commit-secret-scan) — **permanently unrecoverable** by the transcript approach (tool hasn't run). Leave disabled unless upstream #6305 is fixed.
- **`_bodies/*.body.md` relative-link depth bug** — generated artifact, low severity, BACKLOG entry with trigger.
- **stdin pipe upstream #6305** — still broken at 2.1.159; re-probe on any Claude Code update.

## Environment caveat (important)
This session ran in a calibration sandbox. Before `dev-setup.sh` was re-run, the plugin symlink pointed at `/tmp/swe-calibrate-…`, NOT this repo. It was re-pointed to `/home/cookys/projects/autopilot` at session end. If hooks behave oddly, re-verify the symlink target (PRIMARY check #3).
