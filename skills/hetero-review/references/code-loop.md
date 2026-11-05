# Code Review Loop — Adjudication and Freeze Discipline

This document specifies the judgment rules and freeze discipline for heterogeneous code reviews.

## Core Principle: Claims vs Gates (ADR-0001)

A hetero implementer's green or reviewer green verdict is a claim that depth-0 must independently re-derive, never a gate that stands on its own. Depth-0 re-derives the verdict from the reviewer's structured JSON artifact and the exact `base..head` commit range it reviewed.

No trust machinery (no hash chains, event ledgers, witness receipts, attestation, or trust roots) is used. The integrity is established by snapshot shas, reviewer artifacts, and verifiable execution receipts.

## Quality of Disposition Rationales

Depth-0 evaluates all candidate findings emitted by the heterogeneous review panel. Each finding receives a disposition:
- `verified`: finding is confirmed and valid.
- `refuted`: finding is rejected with a concrete rationale.
- `deferred`: non-blocker deferred with explicit justification.

A good disposition rationale for code-review findings:
- Ties the refutation to concrete code evidence, tests, runtime semantics, or existing invariants rather than bare assertion.
- Demonstrates why the reported issue cannot occur, is already mitigated by an invariant upstream, or is an intentional design trade-off documented in ADRs.

Closing an earlier finding is explicit. A verified finding from an earlier generation stays open until a later generation's dispositions file lists it under `"resolutions": [{"id": "<finding id>", "rationale": "<what you re-read or re-ran to confirm the fix>"}]`; a later generation that simply stops reporting it closes nothing, and re-raising the same problem under a new id leaves the old id open until it is explicitly resolved. `finalize` and `check-phase-review-receipt.js` refuse a resolution that names no open verified finding. A chain whose `closed_findings` stamps are stale is repaired with `node scripts/hetero-review-loop.js refinalize --ledger <dir> --phase <id> --generation <last>` (re-derives from the on-disk evidence; refuses if any findings/dispositions sha256 changed).

Two integrity items (BL-0384 and BL-0389; the BL-0389 warning adds no receipt, chain or range field, while the BL-0384 refusal adds `unresolved_allowed` only when `--allow-unresolved` is used, and the opt-in items below add `resolutions_addendum` / `range_mode` only when their flags are used; each of these three fields needs a checker from this version):
- `finalize` refuses by default when the verdict is `SHIP-AS-IS` but verified findings of earlier generations remain open with no resolution: exit 1 and nothing written (no snapshot, chain or receipt change). The message lists their ids (first 8 characters) and says to add a `resolutions` entry to this generation's dispositions file (still editable at that point) or to opt out. Leaving a known Minor open on purpose stays legal through `finalize --allow-unresolved --reason "<text>"`; the reason must be non-empty (without it, or with `--reason` alone, finalize refuses before any write). The receipt then carries `unresolved_allowed: { reason, ids: [full finding ids] }`, and `check-phase-review-receipt.js` re-derives the id set (earlier-generation open findings, in order) and the non-empty reason; a mismatch is red. Without the opt-out no field is written. `refinalize` keeps the field in step with a resolutions addendum and drops it when nothing is left open. Rollout: a receipt carrying `unresolved_allowed` is only re-derived by this checker version (an older checker accepts it silently), so upgrade consumer repos before relying on it.
- `collect` can compare the range it is about to review with the range the caller declared. Declare it in the first paragraph of the `--spec-file` as `Range: full` (base is the phase's generation 1 base), `Range: delta` (base is the previous generation's head) or `Range: <base>..<head>` (compared after both sides are resolved to full shas), or pass `--expect-range <same syntax>`, which wins over the header and says so. A mismatch prints a `WARNING:` line; `--strict-range` makes it an error raised before `g<N>/` exists, so the generation number is not consumed. Nothing declared means nothing is checked.
- `refinalize --add-resolutions <file> --repo-root <path>` closes an open verified finding of an already finalized chain without editing any dispositions file (their sha256 pins stay valid). The file is `[{"id", "rationale", "fix_sha", "reviewed_head"}]`; it is written to `review-<phase>/resolutions-addendum.json` and the receipt gains a top-level `resolutions_addendum: {path, sha256}`. Before writing, refinalize re-derives each claim from the chain and git and refuses (exit 1, nothing written) unless the id is an open verified finding, `reviewed_head` is the head of a finalized generation, and `fix_sha` is an ancestor of `reviewed_head` and a strict descendant of the head of the generation that raised the finding (the code the reviewers flagged, so a commit inside that generation's own range is no fix). `check-phase-review-receipt.js` repeats all three checks and the sha pin itself. The fields exist only on receipts that used the flag; a checker from before this change reports an `open_findings` length mismatch on them, so upgrade the checker before gating such a receipt.
- `collect --generation <n> --full-range` (n > 1) reviews `<generation 1 base>..<head>` instead of the delta from the previous head, so files unchanged since generation 1 are in the diff again (the case a `--exclude` or a late fix otherwise hides). The chain entry and `range.json` gain `range_mode: "full"`; the checker accepts such an entry only when its base is the phase base, and still requires every other generation to chain from the previous head. Older checkers report `Chain broken` on it. `--phase-base` is read at generation 1 only: given a different value at generation > 1, `collect` prints `WARNING: --phase-base ignored at generation > 1; use --full-range`.

## Freeze Predicate

The code review loop freezes when either:
1. A `SHIP-AS-IS` verdict is finalized with a contiguous, head-matching generation chain verified by `node scripts/check-phase-review-receipt.js` in receipt mode; OR
2. A valid opt-out receipt is written via `node scripts/hetero-review-loop.js opt-out --knob hetero_review` when the `hetero_review` knob resolves to `off`.

Receipt verdict tokens are strictly `SHIP-AS-IS` and `FIX-THEN-SHIP`. Severities use only existing vocabulary (`Critical`, `Major`, `Minor`, `Suggestion`).

A range too large for one packet is split by path with `--packets <packets.json> --packet <id>` (every changed file in exactly one packet) and gated by `check-phase-review-receipt.js --packets`; `--exclude` is never the way to shrink a review.

Packet set rule on heads: every packet pins the same range h1 (the earliest first reviewed head), and the exact cover is checked at h1. One exception: a packet may be first reviewed at a later head h2 when none of that packet's own paths changed between h1 and h2. A packet whose own paths changed in h1..h2 is refused ("first reviewed at a different head"); a change to another packet's file does not matter to it, but that other packet must be re-reviewed at the new tip (generation 2).

## The Growth Rail

Code reviews enforce incremental delta verification to prevent unbounded loops and scope creep:
- Each new generation reviews only the delta since the previous generation's head.
- A new generation never re-reviews the entire phase range from scratch.
- Verified findings from prior generations are tracked until closed by subsequent reviewer artifacts over the delta.
- A reviewer withdraws its own earlier finding only by repeating the id on a line whose claim starts exactly `REVOKED:` (the `scripts/dispatch-review.sh` prompt teaches this); free-text "withdrawn" is not a withdrawal.
- The generation chain must remain strictly contiguous from phase base to head.
