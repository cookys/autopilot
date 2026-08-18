# Session End — L-Full checklist and Context Health Check

Reference material for the finish-flow L-5.6 Session End sub-task (the card's
"L-Full Reference" section points here). Moved from the SKILL.md body by the contract-card
rewrite; content preserved verbatim.

## L-Full checklist (invoked by finish-flow L-5.6)

Create a checklist and complete each item before concluding.

```
1. Verify completion:
   - User's last request is completed (or user explicitly said pause/stop).
   - No background work pending.
   - If on a feature branch: check if branch is merged to main.
     If not merged, flag to user before proceeding.

2. Update project docs:
   - Update project progress table and last-updated date.
   - Sync project index.
   - If 100% complete + merged: invoke project archival.

3. Knowledge extraction -- ask yourself:
   - Stepped on a non-obvious landmine?       -> record in .claude/knowledge/
   - Made an architecture decision?            -> record in project docs
   - Discovered a process gap?                 -> update relevant skill
   - Learned something cross-session useful?   -> record in persistent memory
   - None of the above?                        -> skip, do not force it

4. Deferred items:
   Anything postponed goes to BACKLOG with:
   - Context: what it is and why it was deferred
   - Trigger condition: when it should be picked up
   Backlog safety: if the item affects the final goal, do NOT defer.

5. Triggered BACKLOG pickup:
   Check if any BACKLOG items have their trigger condition met by this session's work.
   Scope "this session" using session-start-sha:
     git log --oneline $(cat .claude/session-start-sha 2>/dev/null || echo "HEAD~10")..HEAD
   Surface matches to decision-maker:
   - Normal mode: present to user for action.
   - CEO mode: CEO decides autonomously (tactical). Record in CEO Report.

6. Invoke learn skill:
   Produce a session learning summary covering:
   - Errors encountered and resolved (root cause + fix)
   - Key decisions made (rationale)
   - Surprises or counter-intuitive discoveries

7. Staging verify (if applicable):
   Confirm staging reflects latest code.
   Skip if: mid-implementation, only doc changes, or no staging environment.

8. Checklist summary:
   Output pass/fail for each gate. Include in PR description for L-size tasks.
```

## Context Health Check (conditional)

If the session was long or context feels degraded, measure token budget:

```
Budget baseline: 200K tokens = 100%.
Approximate conversion: 1 token ~ 3.5 bytes (blended estimate for mixed-language codebases).

Report three layers:
- Fixed (loaded every session): CLAUDE.md, MEMORY.md, auto-injected context
- Loaded this session: skills invoked in current conversation
- On-demand (not yet loaded): remaining skills, knowledge files

If usage > 70%: flag for attention.
If specific files are bloated: recommend compress or split strategies.
```
