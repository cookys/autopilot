# Context Continuation (Resuming Prior Work)

> On-demand reference for dev-flow. Loaded only when resuming work on an existing
> feature branch with an active project. Origin: `dev-flow/SKILL.md` Phase 1.

When resuming work on an existing feature branch with an active project:

```
1. Check for uncommitted changes: `git status -s`
   If dirty, ask user: commit, stash, or discard.
   Default if no response: `git stash push -m "auto-stash"`

2. Refresh session start SHA:
   git rev-parse HEAD > .claude/session-start-sha

3. Branch check + freshness (same as L-size gates 2-3).

4. Identify resume point from project docs or prior task state.

5. Skill routing check for the target code area.
```

Context continuation never re-evaluates size. It uses the size established in the original session.
