# Split the autopilot entry docs (BL-0383)

Source: the operator's fleet-wide entry-doc health check, relayed by the PM (2026-11-04); method in `pm:knowledge/harness-entry-docs.md` (the pm repo has no remote, so no URL).

## Problem
- Root `CLAUDE.md` plus `AGENTS.md` total 41.1 KB. This holds across 10 checkouts; 5 par worktrees carry 32.6 KB. All exceed 20 KB.
- Every session pays that cost at start, and the rules that matter are buried in detail.

## Target shape (per the pm knowledge note)
1. Root `CLAUDE.md` at most 10 KB, holding only identity, safety and navigation.
2. Domain detail moves to subdirectory `CLAUDE.md` files.
3. Damage-class rules stay at the root, one line each.
4. `AGENTS.md` becomes a stub for Codex and agy.

## Acceptance
- Every line is carried over; nothing is lost (a line-by-line carry-over table).
- A live injection test: start a session and confirm what is actually injected.
- A hetero review aimed at one question: was any damage-class rule moved out of the root?
- Gates that read these files keep working. Content that `check-claude-md-inventory.js` or `check-claude-spawn-sites.js` needs either stays at the root, or the gate moves with it (with a negative control).

## Notes
- Trigger: the PM dispatches this after d5fu. Effort L.
- The scripts inventory list in the root file is read by `check-claude-md-inventory.js`; decide first where that list lives, since it is most of the file's weight.
