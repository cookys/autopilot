Engine: sonnet

# Repair round r3 — authored by depth-0 (operator-approved spec change)

The landing combined review returned 🔴: the r2 guard `(st.mode & 0o007) === 0` rejects the REAL production case —
codeforge creates `/run/user/<uid>/autopilot` as **0775** under a **0700** parent. Depth-0's original spec ("no other bits")
was wrong, not the hand. Your round-2 real-host proof ran after round 1 had already chmod'd the real dir to 0700, so it
never exercised the 0775 case.

## New rule (operator decision 2026-09-28, replaces point 2 of implement-brief.md)
For a pre-existing candidate that is a real directory (lstat, not a symlink) owned by the current uid, with ANY group/other
bits set: chmod it to 0o700 and accept it **iff its parent directory is owned by the current uid, is a real directory (not a
symlink), and has `(parentMode & 0o077) === 0`**. The candidate's own group/other bits do not matter — with a private parent
no other user can traverse to it, so nothing can have been planted. Every other case (parent not private, foreign uid,
symlink, not a directory) keeps reject-and-fall-through. Update the code comment and the header contract accordingly
(drop the "0705/0755 rejected" wording).

## Do
1. Write `RUN/hand-1-r3.md` (Product / Tests RED-first / Verify / Allowed files sections, same hygiene rules as before — no fenced
   code, no "around line N"). Tests in `hooks/tests/live-dir-xdg-inference.test.sh` and `scripts/lib/live-state-dir.test.js`:
   replace the 0705-rejected case with `0775 under 0700 parent ⇒ accepted, ends 0700` (THE production case — name it so) and
   `0777 under 0700 parent ⇒ accepted, ends 0700`; keep `0775 under 0755 parent ⇒ rejected, mode unchanged`, symlink and
   foreign-parent rejects. Record `# RED at 8edb870e:` for the 0775 case before fixing. Verify list = the same list as row 1.
   Allowed files = same as row 1 plus the codex mirrors. Include the verbatim line:
   "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
2. Dispatch on `hands/livedir/1-r3`, `--base 8edb870e`, run-id `livedir-1r3`, same runner/model/flags as before, background +
   `sleep 2700; echo WAKE-livedir-r3` in the same turn, then end your turn.
3. Review `8de1afa6..hands/livedir/1-r3` (full range) with the same dispatch-review command; spec file = this file plus
   `RUN/implement-brief.md`. You may not dismiss a 🔴/🟠.
4. Real-host proof, from a throwaway worktree at the r3 head, in THIS order (depth-0 authorizes both chmods):
   `chmod 0775 /run/user/1000/autopilot` then `stat -c %a` it (must print 775), then `env -u XDG_RUNTIME_DIR node -e` printing
   `resolveLiveDir()` (expect `xdg-inferred`, `/run/user/1000/autopilot`), then `stat -c %a` again (must print 700). Then run
   `hooks/context-budget.js` end-to-end with XDG unset: stdin `{"session_id":"d9a21e11-1567-4886-9a15-da347b58e585","transcript_path":"<that sid's jsonl under ~/.claude/projects/-home-cookys-projects-autopilot/>"}`
   and `AUTOPILOT_CONTEXT_BUDGET_DIR=RUN/cbstate-r3`; print the state file — expect `lastLive.present:true` and `knownWindow:1000000`.
   **Do NOT write any file into `/run/user/1000/autopilot/context/`** (round 1 left `livedir-proof-497208.json` there; depth-0 removed it).
5. Append an r3 section to `RUN/REPORT.md`: `LAND 1 <r3 head>` or FAIL/RAIL-FAIL, diff stat, verdict + findings, RED line, verify table, proof output.
   Final message: that line. No version bump, CHANGELOG, BACKLOG, merge, or push.
