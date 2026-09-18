Bounded question (cut 2-B of the blind review redesign, autopilot engine):

Today a final review panel is "reviewed" only when EVERY dispatched seat returns a verdict; min_panel_size is a floor on the count. Proposed: treat min_panel_size as a quorum — a panel with ≥ min reviewed seats (families re-checked over the survivors, findings consistent, one packet hash) is reviewed even if extra seats failed; failed seats keep receipt rows marked load_bearing:false; the terminal receipt states final_panel_quorum_met. An operator adds a standby by listing one more seat than the minimum — no new knob.

1. Pitfalls of quorum semantics for an adversarial-review panel (e.g. can a systematic fault hide behind the quorum; should a failed seat's absence weaken union-on-verified-critical)? Minimal mitigations.
2. For the intake snapshot (seat tuples + minimum + families recorded at intake, final panel resolves from it, live drift logged and ignored): what must the drift record contain so an operator can audit a pin change, and is there a case where the live roster SHOULD win?
Answer with concrete pitfalls and minimal mitigations; no verdicts.
