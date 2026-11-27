---
status: review_pending
date: 2026-08-05
size: L
entry_level: l5
logical_plan_id: codex-native-lifecycle-enforcement-2026-08-05-amendment-1
amends: codex-native-lifecycle-enforcement-2026-08-05
---

# User-directed requirements amendment — Codex-native lifecycle enforcement

## 0. Provenance and immutable source boundary

This is a separate user-directed requirements amendment and QC erratum. It does not rewrite or
retroactively reclassify the reviewed plan/rubric:

- original plan: `plans/2026-08-05-codex-native-lifecycle-enforcement.md`, SHA-256
  `ad07704815222d6f887e64b92f80f59b3598ca0cde54e132f5852e67baf71fa7`;
- original rubric: `plans/2026-08-05-codex-native-lifecycle-enforcement.rubric.md`, SHA-256
  `6646017a022999ab7babff7d2c16341c9c7d70893f6cb34bfab93ce04ab2a236`.

The earlier heterogeneous review binds only those original bytes. After D1 produced real Codex
0.146.0 evidence and a later change-only review returned NO-SHIP, the user directed this correction
inside the existing D4 deliverable and Mission lineage. This amendment is independently
`review_pending`; no prior review is represented as reviewing it.

There is no new execution phase, graph node, branch, session, campaign, work order, or authority.
The existing single execution-graph node cites both the immutable original and this amendment.

## 1. Corrected runtime contract

The original R5/R7 phrase "denial contract" is resolved as the structured stdout decision
`{"decision":"block",...}`. The installed Codex 0.146.0 controls proved that structured denial blocks
the tool call. A command adapter that exits 17 before emitting that structure fails open on this host;
that is a preserved, explicit host limitation, not a claim of adapter-crash fail-closed behavior and
not by itself a D1/D4 blocker.

Production remains conditional on exact installed-package evidence. Probe-only hashes or a receipt
from an adapter that was subsequently changed cannot qualify D4.

## 2. Required repairs inside D4

1. Restore the original plan and rubric byte-for-byte and bind this amendment separately in the
   source manifest and existing graph node.
2. Bind each lifecycle marker to the Codex `PreToolUse.session_id`. The canonical Codex lifecycle
   shell command uses the host-provided `CODEX_THREAD_ID`; the marker filename and marker
   `session_id` must match the hook payload so another Codex thread cannot reuse it.
3. Preserve `/l3` inline allow and `/l4`–`/l6` controller direct-effect denial. The sole managed
   exemption remains the exact `engine implement-review` entry under the already validated
   marker/campaign authority.
4. A managed Codex implementer must run with a credentials-only isolated child `CODEX_HOME`, with
   the controller plugin/config and inherited `CODEX_THREAD_ID` absent. This is containment of the
   existing dispatch route, not a broad allow or a parallel child credential.
5. Distinguish a true Git `not a repository` result from missing Git, timeout, signal, or unexpected
   probe failure. True non-repository and read-only activity remains a no-op; an effect-capable call
   whose repository identity cannot be established receives structured denial.
6. Documentation must state the actual two production Codex registrations (`PreToolUse` and
   `PostCompact`) and disclose the exit-17 fail-open limitation.

## 3. Final installed-Codex evidence

After the final canonical adapter is generated into the package and all deterministic gates pass,
run one final installed Codex driver and seal one sanitized receipt. The receipt must bind SHA-256 of
the exact installed production adapter and manifest and must record:

- no-admission depth-0 structured denial: sentinel 0 and Git refs/worktrees unchanged;
- canonical `/l3` entry in the same Codex session followed by exactly one allowed sentinel mutation;
- canonical `/l5` entry in the same Codex session, direct depth-0 mutation denied, and the exact
  managed Engine/dispatcher boundary admitted exactly once with the child-isolation assertion and
  expected zero/effect counters;
- a deliberately broken adapter exiting 17: Codex continues, sentinel 1, CLI exit 0, classified
  `FAIL_OPEN` without weakening the structured-denial verdict; and
- session identities observed by the lifecycle and effect calls, without retaining prompts,
  credentials, or raw tool inputs.

The managed control must consume the already-authorized campaign/lineage and its remaining D4 gate
attempt. It must not mint replacement Mission or campaign authority. If the exact sealed managed
control cannot be exercised within that authority and reservation, D4 remains `NOT_READY`; no weaker
receipt may claim READY.

## 4. Acceptance and review gate

Deterministic acceptance remains inside the existing node: session-mode, CLI, dispatcher,
orchestrator gate, package generation, sync/validation, hook inventory, version sync, Mission graph,
and diff checks. New regression assertions cover session mismatch, Git spawn/timeout classification,
and the actual managed Codex child isolation path.

The final change-only review must review this amendment and its rubric as new source material together
with the candidate diff. D4 may be marked READY only when that review is non-blocking and the final
receipt hash equals the shipped generated adapter hash.

## 5. Scope boundary

No version bump, publish, push, merge, new dependency, non-Codex lifecycle change, new hook type,
general shell parser, replacement tracker, or public breaking change is authorized.
