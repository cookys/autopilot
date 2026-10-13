# Rubric — dispatch tree plan

- R1: [diagnosis-grounded] Every gap in the Diagnosis is a real property of the current code (the cited files and lines say what the plan claims), and every later step traces back to at least one diagnosed gap.
- R2: [no-guessed-edges] The no-guessing rule is total: every edge kind the renderer can draw has an exact condition that both ends confirm, and every record that fails it lands in a visibly separate untracked group, never under the nearest plausible node.
- R3: [premises-true] The premises the plan calls shipped are actually on develop and behave as stated (manifest session_id, child_session_id, --session-id, AUTOPILOT_PARENT_SESSION_ID, marker parent_session_id), including the detached dispatch-hetero path.
- R4: [write-target-safe] The marker write-target design closes the case where a child that inherited the parent's session id writes into the parent's marker, for claude and non-claude children, and its negative control would actually turn red if the guard were removed.
- R5: [steps-verifiable] Each remaining hand-off has its own compatibility rule, rollback rule and an acceptance command that exercises that hand-off (red before, green after); no producer step is accepted by the renderer suite alone.
- R6: [order-and-unknowns] The step order lands no writer before the probe that decides where and under which identity it writes, and every unknown (including a non-Claude harness between two Claude sessions, and children started outside a git repo) names the step that measures it and what the design does if the answer is bad.
- R7: [scope-and-adr] The plan adds no trust machinery (ADR-0001), changes no version, and touches the live-pane plan only through the one bounded tree component it names.
