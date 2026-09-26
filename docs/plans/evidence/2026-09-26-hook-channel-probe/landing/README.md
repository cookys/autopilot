# v2.36.98 landing evidence — hook advisories reach the model

Shape: `brief.md`/`brief-land.md`/`brief-close.md` are the build/land/closeout depth-0 briefs;
`REPORT-foreman.md` is the build-phase report (p1a/p1b/p2/p3 hands + per-round reviews); `REPORT-land.md`
is the land-phase report (repair, full-suite rerun, release mechanics, push); `review-1.json`/
`review-2.json` are the two combined-diff fable reviews (round 1 `origin/develop..HEAD`, round 2 after
the repair commit).

**Probes** (`../RULING.md`): four pairs — PreToolUse, PostToolUseFailure, Stop, UserPromptSubmit — each
fired twice. Result: `additionalContext` is model-visible on PreToolUse/PostToolUse/PostToolUseFailure;
Stop's `additionalContext` re-fires in a loop (unusable); Stop's `systemMessage` is human-UI-only, never
model-visible; UserPromptSubmit output reaches the model on the next prompt.

**Combined-review catches the per-row reviews missed** (round 1): the multiplexer dropping a
`deny`/`ask` when merging advisories; two `exit 2` paths a per-hand diff never lined up against merge
order; an `exit 1` path the multiplexer silently dropped; a queue-file race between concurrent Stop-time
writers; `tsc` output never queued for relay. Round 2 then caught a stale doc claim only a fresh
full-diff pass could see. **Lesson: per-row review cannot replace the combined review.**

**Real-store pollution**: the land-phase suite rerun appended one row to the operator's real
`~/.autopilot/engine-capability/capability.jsonl` (removed by hand). BACKLOG row: "A hook suite writes
into the operator's real ~/.autopilot/engine-capability/capability.jsonl during run.sh"
(`docs/backlog/suite-pollutes-real-capability-store.md`).
