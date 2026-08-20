# Evidence contract — what "done" must prove

The policy content quarried from the retired owner-kernel acceptance machinery
(retired 2026-08-16; plan, review chain, and quarry anchor:
[`docs/plans/2026-08-16-owner-kernel-retirement.md`](../docs/plans/2026-08-16-owner-kernel-retirement.md)).
The ~27k-line trust chain around these rules produced no signal and was removed;
the rules themselves are the part worth keeping. They are stated here as a
**contract** — what a closure claim must prove — deliberately free of any
enforcement mechanism, so any future verifier (a script, a hetero engine, a
graph node) can implement them without inheriting machinery.

## The contract, per unit of work

A claim of completion is accepted only when ALL of the following hold:

1. **Green verification evidence per contract leg.** Every executable
   obligation (test command, scan, check) named at intake has a recorded green
   outcome bound to the exact command and candidate set it ran against. A
   verdict without its command binding is not evidence.
2. **A clear challenge from a decorrelated challenger.** At least one reviewer
   that is (a) roster-listed, (b) **not the author**, and (c) **not the
   author's model family** has examined the work and returned `clear`.
   Same-family review is not independence — a family shares failure modes.
3. **Zero unresolved blocking findings.** Any challenger's `blocking` finding
   must be dispositioned at depth 0 (fixed, or rejected with recorded
   rationale) before closure. Silence is not consent.
4. **The contract was frozen at intake.** What "done" means — the obligations,
   their commands, the artifact list — is content-addressed before work
   starts. Post-hoc edits to the definition of done are a new intake, not a
   repair. (This kills acceptance-test laundering.)
5. **Evidence is bound to the artifact it claims to prove.** A receipt cites
   the commit/diff/file it verified, by content hash or immutable ref — not by
   branch name or "latest". Evidence that outlives its artifact is noise.

## Terminal-issuer invariants

For whatever component ultimately declares COMPLETE/BLOCKED:

- **Freeze-before-execute**: the checklist is frozen before any check runs;
  checks cannot be added or dropped mid-flight.
- **Empty-set refusal**: an empty checklist is an error, never an
  automatic COMPLETE.
- **Silence-is-not-consent**: an unevaluated check is a failure, not a pass.
- **No third outcome**: COMPLETE or BLOCKED; there is no "mostly done".

## Single-round verification (four-layer P3)

One verdict per seat per generation; depth-0 adjudicates. A seat's verdict is never fed to
another seat for a rebuttal round — multi-round debate AMPLIFIES wrong consensus (+30% in the
survey's adversarial-debate result) rather than converging it. Escalation adds a FRESH
disjoint-family seat with an independent single-round verdict (enforced on the review rail by
`resolve-review-loop.sh --prior-status`), never a discussion.

## The holdout leg (four-layer K3)

For high-risk work, at least one obligation must be a check the implementer COULD NOT SEE at
authoring time: verifier-authored tests frozen after the implementation diff, mutation probes,
or strength scoring. Visible-gate gaming grows with task size (SpecBench: ~27pp per 10x LOC),
so the visible obligations alone are insufficient exactly where the work is largest. Enforced
by `scripts/check-holdout-coverage.sh` (receipts SHA-bound to the diff head; absent, malformed,
stale, or failed receipts fail closed).

## What this contract deliberately does NOT include

- Hash-chained event ledgers, witness receipts, attestation issuers, trust
  roots — record *integrity* machinery. The threat here is a **false claim at
  entry**, and no amount of tamper-evidence on the record helps: category-(d)
  verification (independent re-derivation — re-run the test, re-scan the
  diff, let a decorrelated engine attack the claim) is the only thing that
  does. That is the retirement's central lesson
  (see [`evidence-discipline.md`](evidence-discipline.md) §8).
- Any claim about WHO enforces this. The contract is the spec; enforcement
  lives with whatever pipeline consumes it.

## Consumers

- The four-layer redesign (BACKLOG: contract-only policy + harness graph) is
  chartered to implement verifier nodes against this contract.
- Until then, the contract is the reference rubric for manual and
  quality-pipeline closure judgment.
