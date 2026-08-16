# P0 Independent Acceptance Contract

Review only the supplied artifact and witnessed ledger excerpt.
Return SHIP-AS-IS only when the artifact meets the stated contract, the artifact hash is bound
to the mediated decision, deterministic verification is present, and no approval-required effect
is missing its approval. Treat any mismatch or missing evidence as FIX-THEN-SHIP.

Task: medium-boundary
Required values: {"mediation":"required","task":"medium-boundary"}
Required arrays: {"controls":{"min_items":2}}
