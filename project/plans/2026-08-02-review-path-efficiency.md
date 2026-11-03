---
status: frozen-for-execution
date: 2026-08-02
size: L
entry_level: l5
project: backlog-actionable-successor
---

# Review-path efficiency and polarity discipline

## Background and admission

The user has Board-scheduled the B1/B2 review-efficiency entry. Because this deliverable must modify
`dispatch-review.sh`, the existing review-response leakage and polarity tripwire is also triggered.
These two entries share one outcome—bounded review context without weakening evidence—and are admitted
as one deliverable.

The generic time/token complaint in this session does not prove raw shell-output bloat and is not an
explicit request to wire compaction. The leaf-output-compaction entry therefore remains in the trigger
bank. This plan also does not reopen the shipped reviewer `--max-tokens` contract.

## Deliverable contract

### Blind discovery and remediation-delta contract

- Every discovery reviewer receives the complete frozen spec and full line-level current diff with no
  prior findings or round metadata, preserving the canonical blind-dispatch contract.
- After depth 0 verifies and freezes named findings, a distinct remediation checker may receive only
  those finding IDs/contracts plus a reviewer-safe delta bound to the exact previous/current commits.
  This checker can mark a named finding `resolved|unresolved|needs_full_review`; it has no authority to
  discover the whole candidate, return `SHIP-AS-IS`, or clear the review gate.
- Every new discovery generation and the final convergence gate re-read the full current diff blind.
  Contract changes, ambiguous ancestry, missing/misbinding findings, or invalid delta route to full
  blind review rather than a smaller prompt.
- Repository crawling is not silently accepted as review work. Unsupported no-tools enforcement or a
  reviewer that escapes the admitted artifact surface fails closed and retains a durable raw log.

### Leakage and polarity contract

- A syntactically valid wrapped verdict/finding block is not rejected merely because its natural-language
  content mentions prompt, diff, marker, or other leakage-detector vocabulary.
- Verification-author workflows that start with a deliberately buggy-behavior assertion must carry a
  machine-checkable red-before/green-after polarity receipt bound to base SHA, candidate SHA, test
  command digest, assertion artifact path+digest, expected red exit class, and green result before
  shipping. Stale, cross-candidate, cross-command, and cross-assertion receipts are rejected.
- Missing, malformed, truncated, or genuinely echoed framing remains `no_verdict`; favourable partial
  bytes never become a pass.

## Acceptance criteria

- Blind discovery, named-remediation, ancestry mismatch, missing/misbinding finding, no-remediation-pass,
  and mandatory final-full-read fixtures prove exact authority and fail-safe fallback.
- Reviewer-safe remediation delta retains every changed code line relevant to each frozen finding while
  excluding prior prose, dispatcher cycle metadata, and any whole-candidate pass authority.
- Valid verdict vocabulary does not false-reject; true prompt echo, truncation, and malformed framing do.
- Planted negative-polarity, stale, cross-candidate, cross-command, and cross-assertion artifacts are
  rejected until an exact bound red/green receipt proves the assertion flipped.
- Existing omitted-option/default behavior and shipped `--max-tokens` mappings remain unchanged.
- Focused tests, the complete suite, sync/mirror gates, and a whole-diff independent panel pass with no
  unresolved Critical or Major finding.

## Execution binding and verification commands

Mission node: `review-path-efficiency`. Dependencies: `foreman-coordination-r6` and
`skill-metadata-portability-hygiene`. Gate-attempt budget: 4; campaign repair generations: 3.
Reservation: 1 campaign, 10,800 wall seconds, 450 tool calls, 2 engine attempts, 1,800 external-wait
seconds, 40 canonical changed files, and 8,000,000 output bytes.

Exact acceptance commands:

```bash
bash -n scripts/dispatch-review.sh scripts/dispatch-author.sh scripts/diff-since-last-round.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/dispatch-review-prompt-skeleton.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash scripts/sync-all.sh --check
bash scripts/validate.sh
AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
```

Repairs and re-reviews reuse the same campaign, branch, foreman, and node gate budget. This terminal
node owns the one shared backlog/project/index/changelog closeout after all nodes are complete.

### Portfolio terminal lifecycle gate

After node verification, depth 0 binds `root_run_id` exactly to the admitted sealed `campaign_id` and
persists each attempt in a unique caller-owned mode-0700 artifact directory outside every leaf worktree.
This is the portfolio finish gate inside the existing Mission closeout, not a fourth deliverable:

1. Before merge, run `node bin/autopilot.js status task --root-run-id <campaign-root> --json`, persist
   the receipt, validate its digest/freshness, and mechanically require `can_merge === true`.
2. Merge the accepted candidate once. Run the same status surface again after merge.
3. Run `reap-dispatch-worktrees.sh reap` for that exact root, pass its unchanged inventory to
   `reap-dispatch-branches.sh reap`, then issue and freshness-check one
   `LifecycleResidueReceipt`. Require `zero_residue === true`; a fresh `false` remains a blocker.
4. Run the task status surface immediately before marker clear and require a fresh digest-valid
   `can_close === true`. Lifecycle absence alone never proves task completion.
5. Record the three task-status receipts, worktree/branch inventories, lifecycle receipt paths and
   digests in project `dev-info.md`. Failures are repaired/reconciled in this Mission lineage; they do
   not open a replacement graph, ticket, branch, foreman, or implementer.
6. After local integration and the terminal receipts, move the complete project directory—including
   all three node evidence files—to `docs/projects/_archive/2026-08-02-backlog-actionable-successor/`
   and update the index. The frozen graph authorizes both active source and archive destination paths.

## Scope boundary

In scope: blind discovery input construction, a non-authoritative named-finding remediation checker,
existing review-loop caller seams, polarity receipts, exact regression tests/docs/mirrors, and one
portfolio backlog/project closeout with canonical task/lifecycle receipts and archive move.

Out of scope: implementer delta prompts, leaf shell-output compaction, lossy reviewer-diff compression,
generic rtk adoption, echo-protocol redesign, transport-exit recovery, domain-aware routing,
`verify_strength`, new runner token semantics, version bump, release, push, or external publication.

## Dependencies and compatibility impact

The node runs after the control-plane and metadata/hygiene nodes. Discovery and final reviews preserve
the existing blind full-diff authority. The new remediation checker is additive and cannot return a
whole-candidate pass; absent use leaves existing review behavior unchanged. No new runtime dependency is
introduced.

## Risks and rollback

- A remediation checker could become an anchored replacement for blind review. Mitigation: a distinct
  result schema without `SHIP-AS-IS`, full blind discovery/final gates, and negative authority tests.
- Delta ancestry or finding identity can be stale. Mitigation: exact commit/finding binding and full
  blind fallback.
- Leakage hardening can admit true prompt echo. Mitigation: framing/echo/truncation controls remain
  fail-closed.
- Rollback disables remediation-delta use and returns every generation to the existing blind full-diff
  path; polarity receipts remain a safe fail-closed gate.

## Open questions

None. The remediation checker is deliberately not an independent reviewer and has no acceptance vote.

## Review synthesis

| Lens | Finding incorporated |
|---|---|
| Architect | Preserve blind full discovery/final authority; make remediation delta a separate non-passing role. |
| QA/Skeptic | Bank untriggered leaf compaction; bind polarity receipts against replay/misbinding. |
| Ops/SRE | Reuse one lineage and retain fail-closed raw transport evidence; do not reopen token budgets. |
