# Parallel-session coexistence protocol (Fable 5 ↔ Codex)

> Untracked by design (2026-07-03, per cookys). Visible to any agent working in this checkout;
> intentionally NOT committed while Codex has in-flight branches. Formalize into AGENTS.md /
> HANDOFF later if cookys decides to.

Two agent lines work this repo in parallel. This file is the contract that keeps them from
colliding.

## Division of labor (decorrelation by design)

| | Codex | Claude / Fable 5 |
|---|---|---|
| Owns | Engine code surfaces: `src/`, `scripts/`, `skills/`, `hooks/`, release trains | Depth-0 review, research/decision docs, side repos: `~/projects/ai-coding-course` (training material, moved out 2026-07-04), `~/projects/skills` (skill pack), `cookys/ai-coding-slides` (Pages) |
| Toward the other | Implements findings from Fable 5 review reports | Reviews Codex's changes; re-runs claims before believing them |

The doer and the verifier are different families — the repo's own review-loop philosophy, applied
to the sessions themselves. Precedent: `docs/projects/_archive/2026-07-02-l5-l6-engine-integration/review-findings-2026-07-02.md`
(Fable 5 report) → Codex's engine-hardening ship. Zero conflicts.

## File-space rules

1. **Found a code defect? Don't edit — report.** Write a findings file with file:line + fix +
   acceptance; let the code owner apply it.
2. **New deliverables = new files with a `-fable5` suffix** (or a separate repo). New files never
   merge-conflict.
3. **Shared files** (CLAUDE.md, BACKLOG.md, INDEX.md): don't touch while the other line is
   in-flight; when necessary, append a line — never rewrite sections.

## Git discipline

- `git pull` + `git status` before touching anything.
- Fable 5 deliverables stay **untracked** until cookys says commit; no pushes to `develop`
  from the Fable 5 line.
- If both lines must touch code simultaneously: worktree isolation (the repo's own `/l4`
  machinery exists for exactly this).

## Coordination bus

Asynchronous only — repo files are the mailbox: `docs/projects/` trackers, `docs/BACKLOG.md`
entries, review-findings docs. No assumption of live communication between sessions.
