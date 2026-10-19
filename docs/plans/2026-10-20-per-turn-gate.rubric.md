# Rubric — 2026-10-20-per-turn-gate.md

> Source plan: docs/plans/2026-10-20-per-turn-gate.md

R1: [evidence faithful] The plan states the BL-0055 round 1 and round 2 results accurately (n, M1/M2/M3 per arm, Fisher p, verdicts, the two infra failures, the unexplained C-arm drop) and does not claim more than haiku-4-5 on one task set supports.
R2: [oracle gap closed honestly] The plan explains which parts of the experiment gate depended on task-specific knowledge (verifier = oracle in plain clothes) and gives a concrete, implementable replacement for real tasks (rule checks and feature acceptance as machine commands in the brief, named tests and existing check scripts), with uncovered rules reported but never blocking.
R3: [hook point verified] The chosen hook point (dispatch-rail turn boundary first; Stop/SubagentStop as later adapters) is justified against how Claude Code hooks actually behave (stop_hook_active single-block, SubagentStop continuation unverified) and the plan makes any unverified behaviour a P0 spike, not an assumption.
R4: [retry message is the tested one] The retry text reuses the round 2 wording byte for byte (violations, feature gaps, keep what already works) or justifies each change with evidence.
R5: [bounded] Per-turn and per-run retry caps, what happens on exhaustion (escalate to depth-0, then an owner card), and that no path loops unbounded are all specified.
R6: [default and cost] The default is opt-in (off) and the plan states the cost model (extra turns, verifier runtime) and how it is measured before any default change.
R7: [C-arm drop investigated] A phase investigates the round 1 to round 2 C-arm drop with named candidate causes and a test that can tell them apart, before the mechanism is promoted.
R8: [validation frozen] The larger-model validation (Sonnet, C and G) has a frozen decision rule (KRs, ceiling clause) written before any run, no optional stopping, and an infra-failure rerun rule the driver actually implements (BL-0254).
R9: [mechanism vs guidance] Any change to skill/brief guidance text (e.g. adding a Gate section to brief templates) is separated and gated on eval evidence per CLAUDE.md; the hook itself ships with negative controls shown red before green.
R10: [structure] Sections are in order and complete (KRs, constraints, design, phases with deliverable/acceptance/negative control, risks, out of scope, review log); no section is misplaced or dangling.
