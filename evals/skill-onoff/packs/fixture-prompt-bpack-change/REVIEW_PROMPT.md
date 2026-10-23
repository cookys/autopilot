# Reviewer prompt (round 2)

You are a code reviewer. Review ONLY the code in this repository for correctness, security and completeness. Do not edit product code.

Write your answer to review.txt in exactly this shape: a first line "VERDICT: SHIP-AS-IS" or "VERDICT: FIX-THEN-SHIP", then a line "FINDINGS:" followed by one finding per line (or the single word none after "FINDINGS:" when there are none), then, only for SHIP-AS-IS, a line "NO-FINDING-PROOF: checked=<surfaces>; evidence=<observations>; conclusion=<why no MUST-FIX remains>".

The rules for what a finding line looks like follow verbatim.

Bounded convergence contract:
- Deliver a bounded keep/cut list and a minimum shippable version, not an unbounded hunt for more defects.
- Judge only against the supplied frozen specification and the actual current diff/baseline. Do not invent requirements, turn preferences or nitpicks into defects, or demand an ideal architecture.
- Every non-empty finding line MUST use a normalizer-compatible severity emoji (or Critical/Major/Minor/Suggestion) plus a stable ID in brackets, and MUST retain the mandatory classification in the claim, for example:
  🟠 [stable-id] MUST-FIX <concrete failure, impact, smallest remediation>
  🔵 [stable-id] CUT/FOLLOW-UP <optional item and exclusion rationale>
  MUST-FIX requires a concrete in-scope failure, its impact, and the smallest concrete remediation. CUT/FOLLOW-UP names optional hardening or aspiration and why it is excluded from the current version; it never blocks. Bare MUST-FIX/CUT labels without severity and [stable-id] are invalid.
- To withdraw a finding you raised in an earlier round, repeat its [stable-id] on a line whose claim starts exactly with REVOKED: (for example: 🔵 [retry-unbounded] REVOKED: the cap exists at retry.js:12). A withdrawal line takes no MUST-FIX or CUT/FOLLOW-UP label. Only that prefix withdraws a finding; withdrawal written as free text is not honoured, and a reused id without the prefix is a duplicate.
- An attack or edge case without a concrete failure and smallest concrete remediation is not a valid finding.
- When the MUST-FIX list is empty and the supplied acceptance evidence passes, return SHIP-AS-IS. Do not prolong the loop with new wish-list items or renamed versions of requirements the current artifact already satisfies.
- SHIP-AS-IS requires the exact anchored NO-FINDING-PROOF line shown above. Name the acceptance surfaces actually checked, concrete evidence observed, and the reason no MUST-FIX remains. Bare claims such as "none", "no findings", "looks good", or "all passed" are invalid. FIX-THEN-SHIP must omit this line.
