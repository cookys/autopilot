# Implementation brief — red-verification-repair-2026-09-16

You are the implementer of ONE managed deliverable. The harness commits your work; you never push,
never `git stash`, never touch files outside `output_paths`, never read or write the host ledger
(`.git/autopilot/implementation-campaign.jsonl` of this repo) — tests use the suite sandbox only.
Grant base: `1d822ee3`. The rubric pins RED evidence and byte-identity against `d14bfb68`; every
product file is byte-identical between the two (docs-only commits in between) — cite `d14bfb68`.

## Read first (in this order)
1. `docs/plans/_archive/2026/09/2026-09-16-red-verification-repair-path.md` — §0 mechanism, §1 ruling (two changes),
   §2.1 code sites, §2.3 tests T1–T7, §2.5 exact output_paths, §4 acceptance incl. `scope-integrity`.
2. `docs/plans/_archive/2026/09/2026-09-16-red-verification-repair-path.rubric.md` — R1–R10 are the acceptance.
3. `src/engine/autopilot-engine.js`: `performReview` ~4728-4980 (the `REVIEW_COMPLETED` append at
   ~4946 and the `campaign_resume_review` replay branch just above it); the mutate adapter
   ~6695-6730 (`findingBoundRepairPaths` call, `createRepairScopeSeal`); `findingBoundRepairPaths`
   :1514; the verify adapter ~7231-7420 (how RED/GREEN are journaled); the convergence adapter
   ~7600-7660 (`REPAIR_AUTHORIZED` journaling).
4. `src/engine/campaign-composition.js` ~2158-2200 (red path: barrier → scope → convergence →
   `mutate('vertical_repair', [{ id: 'vertical-acceptance', … }])`) — READ ONLY, do not edit.
5. `src/engine/implementation-campaign.js` ~966-1035 (reducer edges) — READ ONLY.
6. `hooks/tests/implementation-campaign-routing.test.sh` ~1100-1330 (an engine block with the real
   `campaignEventAppender`, sandbox ledger, `verifyCommandRunner`, dispatcher stubs — copy its
   wiring) and `hooks/tests/implementation-campaign-state.test.sh` ~4146-4210 (the R3 composition
   case you extend) and ~2621 (existing no-path refusal).

## The two product changes (both in `src/engine/autopilot-engine.js`; plan §1 is normative)
1. In `performReview`, gate the campaign-event journaling with a PREDICATE:
   `if (scope !== 'final' && verticalFailed !== true) { …existing resume-digest replay check and
   REVIEW_COMPLETED append… }`. No try/catch that swallows the reducer error. Comment: under
   `vertical_failed` the campaign is in VERTICAL_VERIFICATION and advances on the existing
   `REPAIR_AUTHORIZED`-from-VERTICAL_VERIFICATION reducer edge; the review stays durable in the
   controller full-diff gate journal and the repair ticket.
2. In the mutate adapter, when `kind === 'vertical_repair'` AND `repairFindings` is exactly one
   finding with `id === 'vertical-acceptance'` (the composition's synthetic finding), set
   `findingPaths = [...repairLineage.repair_scope_paths].sort()` instead of calling
   `findingBoundRepairPaths`; every other case is unchanged (reviewer findings keep the explicit-path
   rule). The seal (`createRepairScopeSeal`) and `repairLineage.repair_scope_paths` assignment stay.
Then mirror: `bash scripts/sync-codex-plugin-skills.sh` and `--check`.

## Tests (plan §2.3 is normative — T1–T7)
Engine block in `implementation-campaign-routing.test.sh`: real sandbox ledger + real
`campaignEventAppender` wrapped by a SPY that pushes `{eventType, generation}` to an array BEFORE
delegating (T1 asserts zero `review_completed` attempts at generation 0 on that array — not on ledger
rows); `verifyCommandRunner` RED for the initial candidate's tree and GREEN for the repaired one;
implementation dispatcher commits a real candidate (touching e.g. `src/value.txt` under an allowed
prefix) and, on the repair round, a real repaired commit touching only those paths, and records the
`repairScopeSeal` it received; review dispatcher returns a verdict with one finding on the red
candidate and SHIP-AS-IS on the repaired one, counting calls per tree_sha; adjudication/final-panel
stubs as the neighbouring block. Assert T1–T4 as written; T5 with a second engine whose appender
throws a UNIQUE message on the generation-1 `review_completed` (spy shows `repair_authorized(1)` and
one `review_completed(1)` attempt before the throw; result `phase === 'campaign_event_journal'`,
`reason` === that message); T6 = the existing no-path refusal stays (reference it); T7 = the
engine-returned controller's gate journal holds the generation-0 `full_diff_review` entry
(`success:true`, the review digest, `input.vertical_failed === true`).
Composition case (`implementation-campaign-state.test.sh` R3 ~4146): add the ordered-trace
subsequence, one generation-0 full-diff call with `vertical_failed: true`, generation-1 with
`false`, mutation kinds `initial` then `vertical_repair`, and T7 on `vertical.controller.gate_journal`
(look at what the composition returns; if the controller is not returned, capture the gate journal
via the adapters' input) — preservation guards, green at base.
Header comments: run the routing block at base BEFORE touching product code; paste the observed
failing message for T1–T5 (`# RED at base d14bfb68: <message>`); for T7 in the engine block pin the
observed base state unconditionally (absent / success:false → RED with the value; present →
preservation). Do not weaken or delete any existing assertion.

## Docs
- `docs/BACKLOG.md`: the row "Managed rail: a failed campaign_verification still dispatches review,
  then review_completed hits VERTICAL_VERIFICATION" → `- **Status**: shipped v2.36.56 2026-09-16`;
  rewrite Context to the real mechanism (performReview journaled `review_completed` under
  `vertical_failed`; vertical repair had no path binding — now predicate-gated + path-bound to the
  initial changed paths). Leave every other row untouched (esp. the openclaw verify-worktree row).
  `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` must exit 0.
- `skills/l5/references/hetero-impl-loop.md` step 11 fixed list: append "red verification takes the
  repair path v2.36.56"; regenerate the mirror with `bash scripts/sync-codex-plugin-skills.sh`.
  Do NOT touch CHANGELOG.md.

## Verify (all, one at a time, foreground; all green)
```
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign.test.sh
bash hooks/tests/controller-execution-independent.test.sh
bash hooks/tests/p6d-gates-repair-ladder.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat d14bfb68 -- src/engine/implementation-campaign.js src/engine/campaign-composition.js src/engine/campaign-intake.js src/campaign/cli.js src/engine/controller-execution.js   # must print nothing
git diff --name-only d14bfb68 HEAD   # every path must be in the list below (plus the plan/mission docs already committed)
```

## Sealed output_paths (the ONLY files you may change)
```
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-state.test.sh
docs/BACKLOG.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
```
Finish with a clean tree, changes committed as the harness instructs; report the RED-at-base
messages for T1–T5 (and T7's pinned base state) and every suite's pass/fail count.
