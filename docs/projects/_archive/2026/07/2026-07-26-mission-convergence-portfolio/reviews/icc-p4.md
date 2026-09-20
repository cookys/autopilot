# Seq 21 review — ICC P4 057 dogfood + ship integration

## Result

`READY`

Implementation commit: `cc8c227`

## Frozen acceptance and dogfood evidence

The hermetic `057` campaign oracle covers six bounded cases:

1. A vertical POC asset is repaired once, an unrelated authenticated publication item is admitted
   only through explicit depth-0 follow-up authority, and the campaign reaches one bounded terminal.
2. Generation 3 is rejected before adapter or model spend.
3. Resume under another ticket or campaign contract is rejected.
4. When authenticated device publication is an exact frozen acceptance item, the same finding is
   deterministic `must-fix-now`, not follow-up.
5. A real engine process is killed with `SIGKILL` after durable implementation completion; a second
   process resumes the journal without repeating implementation.
6. Real Mission, ICC, worktree-lifecycle, and task-status receipts preserve the honest
   `zero_residue=false` / `can_close=false` boundary.

The shipped policy changes the reviewer objective from unbounded defect discovery to a bounded
keep/cut and minimum-shippable-version decision. Non-exact actionable findings require explicit
depth-0 disposition; exact normalized frozen-acceptance matches are deterministic must-fix.
Follow-ups retain evidence, score, source, trigger, fingerprint, and current-ticket-closed
requirements before backlog admission.

Terminal ICC receipts require a lifecycle receipt reference. Invalid or stale lifecycle evidence
releases campaign admission with a no-effect rejection before composer, implementer, or reviewer
spend. The compatibility value `unknown` remains explicit and validated rather than being inferred
from an omitted field.

The temporary `--legacy-unmanaged` rail remains disclosed with removal release `v2.35.0` and
deadline `2026-08-31`; L5/L6 reject it before ledger spend. The actual version bump, changelog,
release preflight, and publication remain deferred to seq 33.

## Deterministic evidence

- Dogfood: 16 assertions.
- Campaign state: 185 assertions.
- Campaign composition: 73 assertions.
- Routing/authority: 29 shell assertions plus adversarial normalization cases.
- Campaign receipt: 11 assertions.
- CLI: 62 assertions.
- Engine: 439 assertions.
- Status task and finish-follow-up: all named predicates plus 5 and 33 shell assertions.
- Mission/ICC runtime: 81 assertions.
- Codex generated package: 90 assertions; contract parity: 36 assertions.
- `scripts/sync-all.sh --check`, 28-skill validation, canonical invariants, pre-commit, staged
  completeness, error-path, secret, whitespace, and post-commit test-integrity gates: PASS.

The full umbrella run reported 227/239 L2 test files passing. Five generated/environment-order
failures were cleared by canonical package sync and isolated reruns. The seven remaining failing
suites reproduce at base commit `b82976c` with the same failure classes: resilience,
dispatch-author session mode, dispatch detach, execution profile, harness capabilities,
supervised authenticated intake, and supervised engine bridge. They are pre-existing and were not
used to waive any ICC-focused failure.

Four pre-existing runtime test files had non-executable modes and were therefore skipped by the L2
umbrella; this phase changes only their modes to `100755`, allowing the existing tests to run.

## Bounded review trajectory

The review rubric was frozen to acceptance convergence, no-spend safety, terminal provenance,
bounded resume, legacy disclosure, and Mission/LSM honesty:

1. Gemini 3.6 returned `SHIP-AS-IS` with a structured no-finding proof over all six dogfood cases.
2. Codex gpt-5.5 found that a non-exact acceptance-bound finding could be auto-deferred. The repair
   now fails closed for explicit depth-0 authority; substring, superstring, negation, empty, and
   whitespace attacks are covered.
3. Codex then found two terminal blockers: invalid lifecycle evidence did not release admission,
   and terminal reducer input could omit lifecycle provenance. Both received the smallest repair
   and focused tests.
4. A frozen repair-delta review returned `SHIP-AS-IS` with a canonical `NO-FINDING-PROOF`, citing
   the no-spend release path, required terminal fields, source/package parity, and negative tests.

One intermediate claim that the early return omitted `campaign_control` was refuted: the unchanged
outer `finish()` attaches the mutated campaign control to every managed result, and the dogfood
assertion observes `admission_release.status=released`. The same-hash adjudication accepted that
mechanical evidence; no compensating production change was made.

A separate proposed universal equality between Mission task `root_run_id` and historical ICC
`campaign_id` was also refuted against the frozen contracts: they are separate namespaces and no
aggregate mapping exists. LSM independently validates each receipt; the dogfood collapses the
identities only inside its deliberately single-campaign fixture.

The panel stopped after the terminal proof. No new topic generation was admitted.

## Cut / follow-up

No new backlog item is admitted by this phase. The only dated cut is the already recorded
`--legacy-unmanaged` removal. Broader versioning and publication work stays in seq 33 rather than
expanding ICC P4.

PRO P3 may begin.
