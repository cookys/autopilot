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
   When Mission is active, apply the resume-projection rule below.

5. Skill routing check for the target code area.
```

Context continuation never re-evaluates size. It uses the size established in the original session.

## Resume projection (Mission)

On resume, Mission graph nodes represent **only remaining deliverables**:

- An already integrated deliverable is **omitted** from the executable graph, or marked satisfied by
  an authoritative receipt/commit evidence — never redispatched to re-mutate files already in HEAD.
- Node `output_paths` describe **required mutations for the new candidate**, not the full historical
  file set produced since an old portfolio base.
- A campaign that fails because historical outputs are already present is a **correct rejection**, not
  a cue to rewrite those paths for boundary cosmetics.
- Do not claim this judgment is mechanized until a deterministic resume-projection gate exists
  (see `docs/BACKLOG.md`). Until then, depth-0 authors the successor graph and source coverage
  explicitly.
