# Administration proposal — consult / discuss role qualification

> **This is a document only. No paid administration is executed as part of producing it or the
> D10 deliverable that authored it.** `docs/plans/2026-08-28-consult-discuss-qualification.md` §2.5
> forbids real-money exam administration in this project; §8 ruling 4 defers seat selection to this
> proposal rather than deciding it in the plan. The Board authorizes any actual spend separately.

## What this is

D1-D9 of the plan shipped two frozen, sealed qualification-seat exams (`consult`, `discuss`) and
their gate (D7) and executable consumers (D8/D9), all default-off. Nobody has been administered
either exam — the scorecard (`~/.autopilot/engine-scorecard/scorecard.jsonl`) has zero `consult`
or `discuss` rows. This proposal recommends which `{engine, runner}` pairs are worth spending on
first, estimates the cost, and demonstrates (with real command output, not a description) that the
qualifier rail runs end-to-end without spending anything.

## Candidate seats

Selection heuristic: prefer engines that already hold a `reviewer` (structured-protocol,
artifact-grounded judgment — closest analog to `consult`'s C1-C5 families) or general dispatch
qualification, so the runner transport (credentials, endpoint, harness version) is already proven
working and the marginal risk of the administration run is the exam content, not the plumbing. Read
from this repo's live scorecard (`~/.autopilot/engine-scorecard/scorecard.jsonl`, `qualified` rows
only, 2026-08-28):

| Priority | Engine | Runner | Existing evidence | Recommended for |
|---|---|---|---|---|
| 1 | `gpt-5.6-sol` | `codex-cli` | `reviewer` qualified | consult + discuss |
| 2 | `claude-opus-5` (or `claude-sonnet-5`) | `claude-native` / `cc-shim` | `reviewer` / `implementer` qualified | consult + discuss |
| 3 | `MiniMax-M3` | `cc-shim` | `reviewer` qualified | consult only (first pass) |
| 4 | `Gemini 3.5 Flash (High)` | `agy` | `verification_author` qualified | discuss only (already proven artifact-grounded second-opinion role) |

`cursor` (the sole `UNQUALIFIED_RUNNERS` entry) is deliberately **excluded** from this first batch.
Administering it would surface the R9 tension recorded in `docs/BACKLOG.md`
("`UNQUALIFIED_RUNNERS` reconciliation tension...") immediately, before that backlog item has a
trigger-condition owner; it is a reasonable second-batch candidate once R9 is scoped, not a reason
to block this batch.

This is a **recommendation**, not a decision — per plan §8 ruling 4, seat selection is the Board's
call, made from this table.

## Cost estimate

Per-role case budget, read directly from the `--plan` output below (not estimated):

- **consult**: 2 trials × 10 cases/trial = **20 cases** per administered `{engine, runner}` pair.
- **discuss**: 2 trials × 8 cases/trial = **16 cases** per administered `{engine, runner}` pair.

Administering all four priority-1/2 rows for **both** roles (rows 1-2 get both; row 3 consult-only;
row 4 discuss-only) is 3 consult administrations + 3 discuss administrations:

- Consult: 3 × 20 = 60 cases
- Discuss: 3 × 16 = 48 cases
- **Total: 108 graded exchanges** across the candidate batch.

Each case is one raw-prompt round-trip through `dispatch-author.sh` (no multi-turn conversation,
no tool use inside the exam — the exams are closed-schema single-shot responses per case per
D1/D2's frozen construct). Cost is therefore roughly `108 × (per-call token cost for the engine at
its configured effort)`. This repo does not track live per-engine $/call pricing centrally (that
lives in each engine's own billing console), so the dollar figure is intentionally left for the
Board to fill in from current rates at authorization time — the case count above is the accurate,
resolver-derived scaling factor to apply against whatever those rates are when administration is
authorized.

## No-spend proof: real `--plan` output

Both commands below were executed for real against the plugin's mirrored codex payload
(`platforms/codex/plugin/scripts/engine-qualify.js`) as the D10 "Codex mirror completeness"
acceptance test requires — a missing generator/grader/corpus/rubric/seal would fail here, not at a
consumer's first real administration. Invocation (placeholder identity fields — `--plan` never
reads engine/model identity into the case plan, it only needs the flags to pass argv validation;
`--panel-cmd true` is never invoked because `--plan` exits before any transport call):

```bash
node platforms/codex/plugin/scripts/engine-qualify.js consult --plan \
  --engine "proposal-dry-run" --model "proposal-dry-run" --model-version "0" \
  --runner "codex" --runner-version "0" --family "proposal" \
  --harness-version "0" --effort "medium" \
  --prompt-config-hash <sha256> --semantic-fingerprint <sha256> --containment-fingerprint <sha256> \
  --panel-cmd "true" \
  --task-class "review" --domain "general" --language "any" --tool "none"
```

(same argv with `discuss` in place of `consult` for the second run.) Exit code was `0` for both.

### `consult --plan` — actual stdout

```json
{
 "schema_version": 1,
 "role": "consult",
 "mode": "plan",
 "identities": {
  "generator": "fddf7f4f579f3dfbcafc00b623931b46d270739ddf1df12842ad44c07b82a411",
  "grader": "aa5e80426b1ffa92abb0d5b90b86e3f2ec12746f3841873b1fd333e0cdc81cd0",
  "corpus": "d34452f3cd29c3218b22e1fe667feae6107d0ff2cc2ab8358e42c1835fdb0730",
  "rubric": "8c303e33074d97065bf011c33f89a6dddd642837184834ea578ad31c2c0402cc",
  "seal": "1643508f2a53f3383094ebfea04fd49d702605576d6764c88ca4c29f5da3d436"
 },
 "case_plan": {
  "budget": {
   "trials_per_administration": 2,
   "families": 5,
   "cases_per_family_per_trial": 2,
   "cases_per_trial": 10,
   "cases_per_administration": 20
  },
  "trials": [
   {
    "trial": 0,
    "cases": [
     { "case_id": "C1_grounded_answer-t0-c0", "family": "C1_grounded_answer" },
     { "case_id": "C1_grounded_answer-t0-c1", "family": "C1_grounded_answer" },
     { "case_id": "C2_insufficient_evidence-t0-c0", "family": "C2_insufficient_evidence" },
     { "case_id": "C2_insufficient_evidence-t0-c1", "family": "C2_insufficient_evidence" },
     { "case_id": "C3_contradictory_primary_artifacts-t0-c0", "family": "C3_contradictory_primary_artifacts" },
     { "case_id": "C3_contradictory_primary_artifacts-t0-c1", "family": "C3_contradictory_primary_artifacts" },
     { "case_id": "C4_scope_discipline-t0-c0", "family": "C4_scope_discipline" },
     { "case_id": "C4_scope_discipline-t0-c1", "family": "C4_scope_discipline" },
     { "case_id": "C5_authority_trap-t0-c0", "family": "C5_authority_trap" },
     { "case_id": "C5_authority_trap-t0-c1", "family": "C5_authority_trap" }
    ]
   },
   {
    "trial": 1,
    "cases": [
     { "case_id": "C1_grounded_answer-t1-c0", "family": "C1_grounded_answer" },
     { "case_id": "C1_grounded_answer-t1-c1", "family": "C1_grounded_answer" },
     { "case_id": "C2_insufficient_evidence-t1-c0", "family": "C2_insufficient_evidence" },
     { "case_id": "C2_insufficient_evidence-t1-c1", "family": "C2_insufficient_evidence" },
     { "case_id": "C3_contradictory_primary_artifacts-t1-c0", "family": "C3_contradictory_primary_artifacts" },
     { "case_id": "C3_contradictory_primary_artifacts-t1-c1", "family": "C3_contradictory_primary_artifacts" },
     { "case_id": "C4_scope_discipline-t1-c0", "family": "C4_scope_discipline" },
     { "case_id": "C4_scope_discipline-t1-c1", "family": "C4_scope_discipline" },
     { "case_id": "C5_authority_trap-t1-c0", "family": "C5_authority_trap" },
     { "case_id": "C5_authority_trap-t1-c1", "family": "C5_authority_trap" }
    ]
   }
  ],
  "admission": {
   "pass": true,
   "checked_cases": 20,
   "overfitter_checked": true,
   "negative_control_admission_failed": true
  }
 }
}
```

### `discuss --plan` — actual stdout

```json
{
 "schema_version": 1,
 "role": "discuss",
 "mode": "plan",
 "identities": {
  "generator": "7c90708c7110c270b48fd1d3c0c563d61504ad4d9f7d8ea93d96fc1713342bbd",
  "grader": "60864b9302a3a514ac06be2ac56cff7694674933358da19debb2c8305d806bbe",
  "corpus": "f2dbb2a7c259503e1a086e38e5cf44775bfc110ac13e7bdd737bac3dc3da6889",
  "rubric": "6a60a549626eeeab1f49974f020a059db6e24ac9e1834f44b5a442c4b9b86104",
  "seal": "7dc0eeb6967ff1beeb5d3be03110d9d89a81dd735e17d7740d1118136b8c7523"
 },
 "case_plan": {
  "budget": {
   "trials_per_administration": 2,
   "families": 4,
   "cases_per_family_per_trial": 2,
   "cases_per_trial": 8,
   "cases_per_administration": 16
  },
  "trials": [
   {
    "trial": 1,
    "cases": [
     { "case_id": "D-a-t1-c1", "family": "D-a" },
     { "case_id": "D-b-t1-c1", "family": "D-b" },
     { "case_id": "D-c-t1-c1", "family": "D-c" },
     { "case_id": "D-d-t1-c1", "family": "D-d" },
     { "case_id": "D-a-t1-c2", "family": "D-a" },
     { "case_id": "D-b-t1-c2", "family": "D-b" },
     { "case_id": "D-c-t1-c2", "family": "D-c" },
     { "case_id": "D-d-t1-c2", "family": "D-d" }
    ]
   },
   {
    "trial": 2,
    "cases": [
     { "case_id": "D-a-t2-c1", "family": "D-a" },
     { "case_id": "D-b-t2-c1", "family": "D-b" },
     { "case_id": "D-c-t2-c1", "family": "D-c" },
     { "case_id": "D-d-t2-c1", "family": "D-d" },
     { "case_id": "D-a-t2-c2", "family": "D-a" },
     { "case_id": "D-b-t2-c2", "family": "D-b" },
     { "case_id": "D-c-t2-c2", "family": "D-c" },
     { "case_id": "D-d-t2-c2", "family": "D-d" }
    ]
   }
  ],
  "admission": {
   "pass": true,
   "solvability": true,
   "trap_discrimination": true,
   "overfitter_discrimination": true,
   "negative_control": true
  }
 }
}
```

Both runs: exit `0`, five frozen identities printed (generator/grader/corpus/rubric/seal — the
KR7 requirement D4 corrected generation-1 on), all corpus admission gates `pass: true`, and **no
provider or broker call was made** — `runPlanDryRun` (`scripts/engine-qualify.js`) returns before
`executePanelCase` is ever referenced. Re-running the same command against the same pinned assets
reproduces byte-identical `identities` and `case_plan` output (`planSeed` is a pure function of the
generator hash and a fixed label — no wall clock, no `run_nonce`), confirming the assets are what
they claim to be without spending anything.

**Codex mirror completeness (D10 gap found and fixed).** These two commands were run against
`platforms/codex/plugin/scripts/engine-qualify.js` specifically, as the plan's D10 acceptance test
requires. On first attempt this failed the way finding [8] predicted: the twelve pinned
consult/discuss assets under `evals/` were not yet in `scripts/sync-codex-plugin-skills.sh`'s
`SUPPORT_FILES` allowlist (D4 sealed and pinned them but never added them to the mirror list), so
the codex-mirrored qualifier could not `require()` its own generators. Fixed as part of this D10
deliverable — see the commit that edits `scripts/sync-codex-plugin-skills.sh`; the output above was
captured **after** that fix, from the resynced package, and `sync-codex-plugin-skills.sh --check`
is green.

## Explicit stop

No paid administration is executed as part of this task. This proposal is a document for the Board
to act on when it chooses to authorize spend; producing it involved only the two `--plan` dry-runs
above (which do not call any provider or engine) and reading the local scorecard file for candidate
selection.
