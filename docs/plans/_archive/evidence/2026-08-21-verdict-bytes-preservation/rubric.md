# Frozen review rubric — verdict-bytes preservation plan

VB1: Salvage soundness under adversarial content. The salvage battery drops exactly two
requirements relative to the authoritative parser (block-at-start positional anchor; runner
exit 0) and replaces the first with a uniqueness rule (exactly one BEGIN marker occurrence in
the capture). Does the retained battery (nonce-derived markers, 16 KB cap, prompt-framing leak
scan, single anchored VERDICT, FINDINGS line, SHIP⇒exactly one NO-FINDING-PROOF) still make a
planted `unratified_verdict` infeasible from static diff content or prompt injection? Name a
concrete byte sequence an attacker could place in a diff or an injected instruction that yields
a non-null unratified_verdict the main rail would have rejected FOR A CONTENT reason (not a
positional/exit reason). If one exists, the design is unsound.

VB2: Authority isolation and drift resistance. "No consumer may derive authority from
unratified fields" — is that enforceable beyond good intentions? Are the proposed pinning
assertions (resolve-review-loop cascade, qc-panel skip, plan-review exit-4) the RIGHT set, and
are they bidirectional (green when salvage present, red when a consumer starts reading it)?
What mechanically catches a FUTURE consumer added next month that reads `unratified_verdict`
as a verdict — is a grep-shaped guard needed, or is that over-engineering? Is the field name
itself sufficiently self-describing to survive a session that never read this plan?

VB3: Salvage admission boundaries. No-salvage on `raw_binding_mismatch` and
`identity_mismatch`; salvage on `exit_failure|timeout|quota|unavailable|interrupted`. Is any
admitted classification one where the captured bytes are inherently untrustworthy (e.g. an
interrupted write mid-flush producing a VALID-but-wrong-generation payload)? Conversely does
excluding raw_binding_mismatch discard a legitimately recoverable class? Edge cases: empty
capture, capture file unreadable, markers undefined at emit time, multi-attempt seats where an
EARLIER attempt salvages but a later one doesn't — is "latest attempt with a unique valid
payload" the right carry rule, or should it be "any"?

VB4: Fixture exactness vs phantom shapes. Do fixtures A-F reproduce the INCIDENT byte-shapes
(chrome line actually shaped like the 2026-08-08 context-window notice; a timeout envelope
whose raw matches what a killed seat actually leaves behind), or are they simplified
paraphrases that would pass even if the real shapes still fail (evidence-discipline §13
phantom-shape failure)? Is the dead-gate mutation (revert salvage call → A/C red) specified
concretely enough to be executed and recorded, and does the plan avoid deriving fixture
expectations from the implementation under test?

VB5: Rail completeness and compatibility. Are dispatch-review.sh and the plan-review rail the
ONLY two places a content-complete verdict can be destroyed by transport, or is there a third
(qc-panel judge seats, engine implement-review verify path, adjudicate-findings input,
qualification-review-provider) that this plan should name in scope or explicitly out of scope
with a reason? Is the additive-JSON compatibility claim verified against every consumer that
parses these artifacts strictly (schema validators, check-contract-schema.js, panel manifest
readers), not just the tolerant jq readers cited?
