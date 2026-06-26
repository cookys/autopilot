---
name: l5
description: >
  Terse CEO front-door — Level 5: like /l4 (background worktree-isolated foreman, depth-0 control
  loop + authoritative qc) but the IMPLEMENTER is leaf-dispatched to a heterogeneous engine
  (agy/Gemini) via dispatch-hetero.sh. Use when: "/l5 <goal>", "L5 <goal>", you want cost-arbitrage
  or a decorrelated second engine doing the mechanical impl. Presets involvement=just-results,
  scope=Hold, no-go=none (override -x / --expand / --solo). Not for: all-Claude run (→ /l4), inline
  (→ /l3).
---

# /l5 — CEO autonomy, foreman + hetero implementer

Terse front-door into `autopilot:ceo-agent` at **Level 5**: identical to `/l4`
except the foreman **leaf-dispatches the implementer to a heterogeneous engine**
via [`../../scripts/dispatch-hetero.sh`](../../scripts/dispatch-hetero.sh), and the
adversarial review can run on a **decorrelated reviewer engine** instead of
homogeneous Claude. The engine roster + loop policy are **data, not a hand-typed
prompt** — resolved from [`../../scripts/resolve-review-loop.sh`](../../scripts/resolve-review-loop.sh)
(per-project `.claude/review-loop-config.md`; template in
[`../../project-config-template/review-loop-config.md`](../../project-config-template/review-loop-config.md)).
Everything else — depth-0 control loop, qc@depth-0, merge-back, worktree GC — is
unchanged from `/l4`.

After a one-time `cp project-config-template/review-loop-config.md .claude/`, the
whole "subagent plan → reviewer xhigh loop → hetero impl → reviewer xhigh loop →
qc-gate" pipeline is just `/l5 <goal>` — you don't re-type the roster.

## On invocation

1. Invoke `autopilot:ceo-agent` with the four startup questions **pre-filled**
   (same presets as `/l3`/`/l4`).
2. **Resolve the roster** (don't hardcode): `scripts/resolve-review-loop.sh` →
   `{reviewer_engine, reviewer_effort, reviewer_runner, implementer_engine,
   implementer_effort, implementer_runner, loop_max_rounds,
   loop_convergence_verdict, spec_review, independent_harness,
   review_diff_scope}`. These drive every dispatch below — never type
   model/effort/runner inline (CLAUDE.md rule).
3. Execution posture: **offload with hetero impl + decorrelated review**. Run the
   foreman + depth-0 control loop per
   [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md);
   the deltas vs `/l4`:
   - **Impl** dispatched with `dispatch-hetero.sh --runner <implementer_runner>
     --model <implementer_engine> --effort <implementer_effort>` (worktree-isolated,
     artifact-verified, **cgroup-contained**). Map its outcome via the
     **outcome→action table**; reap the worktree from the outcome JSON's `worktree`
     field on any non-success. The run-summary impl row records
     `runner`/`model`/`containment` straight from the outcome JSON.
   - **Review** (spec — if `spec_review:on` — and impl) runs the **decorrelated
     reviewer**, not homogeneous Claude: `codex exec -m <reviewer_engine> -c
     model_reasoning_effort=<reviewer_effort>` reading the spec/diff, looping until
     its verdict reaches `loop_convergence_verdict` or `loop_max_rounds` (each round
     re-checks the prior round's fixes — [[feedback_dialectic-review]]).
   - **`review_diff_scope`** controls what the impl-review reads each round:
     - `full` (default) ⇒ the reviewer reads the whole `<base>..HEAD` diff every
       round. Safe; cost grows O(n) as the diff accumulates.
     - `incremental-mitigated` ⇒ the reviewer reads `<prev-round>..HEAD` PLUS the
       full content of every file touched this round PLUS a standing
       invariants/prior-findings checklist; do a full `<base>..HEAD` re-read every
       3–5 rounds or whenever a round touches shared/critical logic (classifiers,
       schemas, fixtures, harness control flow); and ALWAYS a final full
       `<base>..HEAD` review before merge. Use only on long loops — naive
       incremental-only misses cross-file regressions in untouched files. When this
       mode is on, `independent_harness` MUST run the FULL test suite, not just
       touched-file tests (real lesson 2026-06-26: a stale-fixture regression in an
       untouched test file slipped a too-narrow per-round scope to the final sweep).
       Reference driver: `resolve-review-loop.sh --field review_diff_scope`.
   - **`independent_harness:on`** ⇒ depth-0 ALSO builds its own adversarial harness
     and never trusts the implementer's own green ([[feedback_delegate-selftest-false-green]]).
   - **Block-mode test-integrity override stays DEFERRED**: a block-mode
     `executed_set_shrink` hard-fails with no honored override (no local-only
     containment is malicious-proof against a same-user worker — sibling-scope
     escape; gpt-5.5 review 2026-06-26). Resolve a legit shrink by fixing the test
     or running that project in `warn`. Re-enable is BACKLOG'd behind real isolation.
4. **`--solo`** → fall back to the `/l3` inline engine (also the automatic
   degradation when the foreman or hetero dispatch returns `precondition_failed`).

Still deferred (NOT in v1): the full `role × task-type` routing table and engines
beyond the configured roster (grok/others — each behind a per-engine smoke test).
codex (`gpt-*`/`*codex*`) and agy/Gemini are wired. See
[`../../references/hetero-dispatch.md`](../../references/hetero-dispatch.md) and
[`../ceo-agent/SKILL.md`](../ceo-agent/SKILL.md).
