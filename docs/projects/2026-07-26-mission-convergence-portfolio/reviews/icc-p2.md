# ICC Phase 2 Gate

> Verdict: READY
>
> Baseline: `219aac2`
>
> Phase commits: `a83cae4..77213a8`
>
> Final aggregate diff SHA-256:
> `fd71375aa923d483188320830bf7e13713975ec584f1dfb4a4a20bea7363b744`

## Deterministic Evidence

The final focused suite passed 919 assertions:

- `implementation-campaign-receipt`: 11; `implementation-campaign-state`: 169.
- `implementation-campaign`: 73; `adjudicate-findings`: 130.
- `check-loop-convergence`: 18; `check-repair-scope`: 45.
- `autopilot-engine`: 439; `run-ledger`: 34.

The full `219aac2..77213a8` range passed test-integrity L0/L1, completeness with
no new finding, secret scan with zero findings, and error-path scan with zero
findings. Syntax, JSON Schema validation, `git diff --check`, 28/28 skill
validation, version mirrors, agent bodies, hook inventory, and canonical
invariants passed.

Codex packaged-payload synchronization remains intentionally deferred to the
portfolio's single final canonical-tree generation in phase 33. No generated
mirror churn is included in this phase.

## Review Trail

| Candidate | Seat | Result | Depth-0 disposition |
|---|---|---|---|
| Initial composition | Sol `review-1785095904-1414115-a637` | FIX | Six reproduced authority, verification, and retention defects were fixed through `e0d53ce`. |
| `e0d53ce` | Qwen `review-1785097194-1442134-bf7e` | FIX claim | Backlog-title registry claim rejected: the canonical registry accepts context/trigger; the bound terminal receipt retains the title. |
| `e0d53ce` | Sol `review-1785097194-1442125-04e2` | FIX | Shell argv, ledger reconciliation evidence, and cross-round finding identity were admitted and fixed. Three frozen-design mismatches were rejected. |
| `10c127d` | Qwen `review-1785097978-1462811-465b` | SHIP-AS-IS | Counted. |
| `10c127d` | Sol `review-1785097978-1462803-8f8c` | FIX | Seven terminal evidence gaps became the frozen closure checklist. |
| `4555a01` | Qwen `review-1785099471-1513756-854a` | SHIP-AS-IS | Counted. |
| `4555a01..f527fd5` | Sol `review-1785099272-1511325-356b`, `review-1785099957-1530385-ce19`, `review-1785100229-1540273-66e9`, `review-1785100611-1551205-20bc` | FIX | Three admitted closure defects and successive URL/DSN secret shapes were fixed; external-review/runtime-field and P3 CLI-routing findings were rejected from P2. |
| `edf9566..77213a8` | Sol `review-1785100888-1571767-d022` | SHIP-AS-IS | Final PATH type edge closed; the chained Sol checklist is 7/7 PASS. |
| `77213a8` full aggregate | Qwen `review-1785100905-1572750-eb8c` | SHIP-AS-IS | Terminal independent aggregate verdict; no findings. |

Grok and earlier Qwen transports that returned no strict verdict were excluded
fail-closed. They did not count as clean seats and did not open extra repair
generations.

## Frozen Review Rubric

## Review target

- Baseline: `219aac2`
- Candidate: `77213a8`
- Scope: Phase 2 only from
  `docs/plans/2026-07-26-implementation-campaign-convergence-control.md`.
- Review correctness, authorization boundaries, fail-closed behavior, and regressions.
  Do not request optional refactors or style changes.

## Required behavior

The managed implementation campaign must compose this bounded order:

1. preflight the sealed contract, immutable base, and budgets;
2. implement one vertical slice;
3. run bounded verification against the immutable candidate;
4. when vertical evidence is absent, repair only that acceptance failure before review;
5. run focused review against the frozen task;
6. ingest exact structured findings through the existing `adjudicate-findings.js`;
7. require one depth-0 disposition for every actionable Critical/Major;
8. run registry completeness before the existing repair-gate;
9. run the existing repair-scope gate before every repair, after every mutation, and
   before acceptance;
10. run the existing loop-convergence gate and campaign budget gate;
11. re-run focused verification and review after repair;
12. run exactly one final full panel, then terminate.

Green verification reuse must bind the exact
`{tree_sha, argv_hash, env_fingerprint}` tuple. Red, tampered, or drifted receipts are never
reusable. Secret values must not enter the environment fingerprint. Authoritative verification
must run in a detached immutable checkout after the mutation writer is closed.

The synthetic acceptance case contains one in-scope Major (`must-fix-now`), one optional
hardening Major (`follow-up` with context, trigger, and proposed backlog title), and one refuted
Major. It must authorize exactly one repair, retain the other two without mutating the ticket,
and fail closed for missing or conflicting dispositions.

## Prior Major Closure Checks

The terminal panel must independently verify that the final candidate closes these six
previously accepted Major findings without introducing an in-scope regression:

1. repair prompts contain only the depth-0-authorized finding set, never the full or stale
   review payload;
2. reviewer findings are claims only; a separately bound depth-0 or deterministic authority
   supplies evidence and dispositions;
3. the environment used for the verification fingerprint is the environment passed to the
   verification command;
4. writer closure and detached checkout are digest-bound receipts backed by implementation
   completion and observed Git checkout identity, not caller booleans;
5. `tree_sha` is the resolved Git tree object for the candidate commit;
6. terminal receipts retain refuted findings as well as follow-ups.

The final candidate must also prove that:

7. the recorded shell argv is the exact argv executed by the verification runner;
8. ledger-based writer closure requires a digest-bound reconciliation receipt tied to the
   campaign, stage, generation, nonce, candidate commit, and a closed holder state;
9. finding retention is keyed by finding ID across rounds, deduplicates review-digest-only
   repeats, and fails closed on classification or content conflicts.

## Terminal Fixed-Checklist Revalidation

This is a bounded closure pass, not a new review generation. The terminal seats must report
PASS or FAIL, with file/line evidence, for exactly these seven previously admitted findings:

1. a retained `follow_up[]` cannot produce a READY terminal;
2. ledger-based writer closure requires a terminal or Git-truth receipt whose holder is
   actually closed, and terminal rows retain the lease identity needed to test that fact;
3. `PATH` cannot be omitted from the verification environment fingerprint;
4. database/connection credentials and credential-bearing URLs or private-key material cannot
   enter the environment fingerprint;
5. the verification receipt attests the argv actually executed by the runner and fails closed
   on a missing or mismatched attestation;
6. every adjudicated finding, including a refuted finding, retains digest-bound evidence and
   separately bound depth-0 adjudication authority;
7. a managed campaign cannot omit the frozen review specification, and rejection occurs before
   any model spend.

A regression directly caused by these repairs counts as a failed checklist item. A newly
suggested refactor, hardening idea, or unrelated finding is outside this terminal pass and cannot
open another repair generation. The seat returns `SHIP-AS-IS` only when all seven items pass.
These PASS/FAIL rows are requirements for the external phase-review seats running this rubric;
they are not a new runtime field in `finalPanel` model output or the campaign receipt.

The terminal PATH-edge repair delta is `edf9566..77213a8`. Its Sol revalidation is intentionally
limited to item 3 because the preceding aggregate Sol pass recorded PASS for items 1, 2, 4, 5,
6, and 7, and this delta only rejects raw `null`/`undefined` PATH values before fingerprinting.
The terminal Qwen seat still reviews the full aggregate candidate.

## Frozen Design Semantics

- KR7 deliberately defines cache misses for tree, command, or **allowlisted** environment
  drift. Secret values are excluded; callers must include every execution-relevant non-secret
  variable in that allowlist.
- A full-scope final panel means a fresh isolated review dispatch over the complete immutable
  `base..candidate` diff with dynamic sampling disabled. It may use the qualified campaign
  reviewer roster; it must not ingest the focused review's prose.
- `follow_up` is the non-converged `TERMINAL_FOLLOW_UP` / conditional stop state. Optional
  deferrals live in `follow_up[]`; mandatory final defects live separately in
  `unresolved_final_findings[]`. Neither state is READY and neither schedules another repair.
- `proposed_backlog_title` is retained in the depth-0 disposition receipt. The existing
  `adjudicate-findings.js dispose` registry contract intentionally ingests only its canonical
  follow-up context and trigger; it does not accept title as an extra command field.

## Frozen boundary

The following are Phase 3 and must not expand this review:

- kill-and-resume durability across a new process or shell;
- campaign status joins and user-facing status JSON;
- canonical `/l5` and `/l6` documentation routing;
- shared runner transport envelopes;
- natural-language product-review semantic normalization;
- canonical CLI/transport exposure of depth-0 disposition input; Phase 2 provides the
  fail-closed `campaignDispositionProvider` embedding seam, while Phase 3 wires that authority
  through the mutating entry point.

A Phase 2 implementation may expose an exact structured review input and fail closed on
unstructured output; Phase 3 owns the purpose-bound normalizer. A concrete Phase 2 defect is
still in scope even if Phase 3 later persists or exposes its receipt.
