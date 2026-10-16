# Strict l5 provider-bootstrap pinned to old models (BL-0198)

src/readiness/provider-bootstrap.js ~152-207 hardcodes GLM-5.2, grok-4.5, gpt-5.6-sol, MiniMax-M3.
Shipped defaults moved on 2026-10-16 to GLM-5.3, grok-4.7, gpt-6.1-sol. Not changed here because the six
claim ids are hashes of capability claims bound to the old models; editing turns provider-readiness-consumer red (6).

Order: re-register claims for the new models (scripts/platform-capability-claims.js), then edit bootstrap.
Same family: src/harness/capabilities/grok.json (2026-08 grok-4.5 probe; re-probe grok-4.7 first);
check-context-window.js and engine-scorecard.js window lists lack gpt-6.1-sol and grok-4.7.
Trigger: next strict l5 / provider readiness work, or before 3.0.0.
