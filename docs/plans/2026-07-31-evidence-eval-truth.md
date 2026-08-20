---
status: approved
date: 2026-07-31
size: L
entry_level: l6
project: evidence-eval-truth
---

# Evidence and Eval Truth

## Background

Three triggered backlog items share one trust boundary:

1. orchestration-eval currently permits an unexplained failed run to enter capability statistics;
2. local engine transcripts contain useful operational evidence but are not imported into the
   scorecard layer;
3. MiniMax-M3 remains a default review seat without mechanically surfacing the recorded
   5/6 false-central-claim caveat.

The common objective is to make evidence honest before it influences a roster. This project does
not promote disk telemetry into authority and does not transmit transcript content to an engine.

## Project Goal

> **Final goal**: make orchestration evaluation, transcript aggregation, and reviewer calibration
> fail closed against unexplained or overclaimed evidence.
>
> **Success criteria**:
> - every `oracle_pass:false` eval row is classified as `capability_fail` or `infra_fail`; scoring
>   rejects missing/unknown classifications and loudly reports excluded infrastructure failures;
> - transcript import is deterministic, aggregate-only, idempotent, and never writes transcript
>   text or converts telemetry into a qualified routing row;
> - missing agy usage and biased OpenCode cohorts remain explicitly incomparable rather than
>   receiving invented token/cost conclusions;
> - the current MiniMax diff-only reviewer limitation is mechanically visible to roster consumers,
>   or the seat is safely demoted to a role supported by existing qualification evidence;
> - `bash hooks/tests/orchestration-eval.test.sh`,
>   `bash hooks/tests/engine-scorecard.test.sh`, and
>   `bash hooks/tests/resolve-review-loop.test.sh` all exit 0.
>
> **Scope boundary**: only orchestration-eval result truth, aggregate transcript telemetry,
> scorecard/report projection, and the MiniMax reviewer caveat. No role-authority promotion,
> raw-transcript storage, provider-readiness redesign, pricing inference, or general roster rewrite.

## User requirements ledger

| Requirement | Mapping |
|---|---|
| “挑幾條線出來跑” and approved B line | This project is the B workstream. |
| “backlog 撿一撿變完整 project phase” | P1–P3 below plus the project tracker. |
| “讓 ceo 用 /l6 分別派出 sub orchestor 後照 dev-flow 推進” | One admitted Mission node, one isolated L6 foreman, dev-flow L gates, finish-flow before integration. |

## Scope completeness audit

| Dimension | Decision |
|---|---|
| Source + tests | In scope: eval runner/scorer, scorecard/resolver, existing hermetic tests. |
| User-facing docs | Project/plan ledger only; general README changes are out of scope. |
| Public interface | Additive result/telemetry fields only; existing scorecard authority semantics remain. |
| Config/examples | `.claude/review-loop-config.md` may change only for an evidence-backed MiniMax caveat/seat decision. |
| CHANGELOG/version | Integration-owner closeout only; the foreman must not edit either. |
| Migration | Existing scorecard rows remain readable; new fields/defaults must be backward compatible. |
| External consumers | No external repository mutation. |
| Credit | No new third-party design is being absorbed. |
| Dogfood | Depth 0 runs the importer against synthetic fixtures and, if locally safe, aggregate-only real roots. |
| Privacy/data egress | Local-only. Prompts, logs, commits, and artifacts must contain no transcript text or credentials. |

## Deliverable B contract

The executable Mission node is `evidence-eval-truth`. P1–P3 are source-coverage phases and gates
inside that single node; they are not separate campaigns.

- **Immutable base**: the project bootstrap commit.
- **Owned files**: `.claude/review-loop-config.md`, `evals/orchestration/`,
  `scripts/engine-scorecard.js`, `scripts/resolve-review-loop.sh`, and their named tests.
- **Forbidden files**: `docs/BACKLOG.md`, `docs/projects/INDEX.md`, `CHANGELOG.md`, `CLAUDE.md`,
  version manifests, `src/engine/*`, and all C-line files.
- **Objective verification**:
  `bash hooks/tests/orchestration-eval.test.sh &&
   bash hooks/tests/engine-scorecard.test.sh &&
   bash hooks/tests/resolve-review-loop.test.sh`.
- **Acceptance patterns**: A5 for fail-closed classification, A4 for idempotent import,
  A1 for aggregate-schema consumer parity, and A2 for the MiniMax caveat/demotion gate.
- **Negative controls**:
  an unclassified failure must be rejected; a planted transcript string must never appear in
  output; a second import must be byte-stable; removing the MiniMax warning/demotion must fail
  the roster test.
- **Resource ceiling**: at most 9 changed files, 2 repair generations, 3 gate attempts,
  60 minutes, and no more than 2,250 lines of total churn.

## P1 — Fail-closed orchestration-eval classification

1. Derive `failure_class` from process outcome, run-log evidence, timeout/auth/empty-output
   signatures, and oracle outcome.
2. Emit only the closed vocabulary `capability_fail|infra_fail` for failed rows.
3. Refuse to score `oracle_pass:false` rows without a valid class.
4. Exclude `infra_fail` from capability rates while reporting its count and causes.
5. Preserve successful-row and old valid-row behavior.

Verification uses A5: happy path, capability failure, infrastructure failure, and an intentionally
unclassified failure that must be rejected.

## P2 — Aggregate-only transcript importer

1. Extend the existing `engine-scorecard.js` surface rather than adding a new top-level script.
2. Accept explicit caller-provided roots; never crawl arbitrary home content by default.
3. Parse supported Codex, Grok, OpenCode, and agy schemas into de-identified per-engine aggregates.
4. Record sample size, schema coverage, completion/zero-output/tool-failure rates, and only metrics
   actually present in the source.
5. Mark agy token/cost unavailable and preserve its truncation rate.
6. Keep OpenCode `swe-calibrate` separate from general-use cohorts.
7. Never emit `status:qualified`, routing ladder candidates, raw messages, prompts, file contents,
   user paths, session IDs, or credentials.

Verification uses A4 + A1 with synthetic transcript roots and a planted secret/raw-content sentinel.

## P3 — MiniMax reviewer calibration guard

1. Represent the 5/6 false-central-claim observation as telemetry/limitation, not authority.
2. Ensure the current diff-only MiniMax seat cannot be selected silently without that limitation
   being surfaced, or demote it only when an already-qualified replacement is available.
3. Preserve the rule that disk scorecard rows are `untrusted_telemetry` and cannot grant review,
   verifier, owner, acceptance, or merge authority.
4. Add a perturbation test that removes the caveat/demotion and proves the guard fails.

## Dependencies and execution order

```text
P1 failure truth → P2 aggregate import → P3 reviewer calibration
```

The sequence is internal to one foreman because P2/P3 both touch scorecard semantics. The whole
node is file-disjoint from the C workstream and from the running Controller/Fable P0 worktree.

## Risks

| Risk | Control |
|---|---|
| Transcript content leaks into commits or model prompts | Synthetic fixtures for workers; aggregate-only local depth-0 dogfood; sentinel scan. |
| Telemetry accidentally becomes authority | Existing provisional/empty-ladder invariants remain blocking tests. |
| Infrastructure failures are mislabeled capability failures | Closed vocabulary plus explicit evidence priority and unclassified refusal. |
| MiniMax is demoted without a ready replacement | Warning-first path; replacement requires existing exact-tuple qualification. |
| Scope expands into readiness P0 | Explicitly out of scope and forbidden `src/engine/*`. |

## Out of scope

- session-local qualification provider;
- provider readiness or Owner Kernel P4;
- raw transcript archival or cross-user analytics;
- agy token estimation from content bytes;
- general cost/quality optimization or dynamic roster scheduling;
- version bump, CHANGELOG, BACKLOG, INDEX, release, push, or production publication.

## CEO decisions

| Decision | Rationale | Reversibility | Scope effect | Acting owner |
|---|---|---|---|---|
| One node with three internal phases | Scorecard files overlap; splitting would create merge and semantic races. | High | No expansion | depth-0 CEO |
| Extend `engine-scorecard.js` instead of adding a script | Avoids CLAUDE.md inventory pressure and keeps one telemetry authority surface. | High | Smaller | depth-0 CEO |
| Local aggregate-only dogfood | Governance requires local-only data egress and transcripts are sensitive. | High | No expansion | depth-0 CEO |
