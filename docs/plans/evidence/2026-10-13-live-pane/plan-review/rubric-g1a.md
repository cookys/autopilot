# Rubric — live pane design system plan

- R1: [diagnosis-grounded] Every problem in the Diagnosis is a real property of the current live pane code, and every later section traces back to at least one diagnosed problem; nothing is designed for a problem the plan never shows exists.
- R2: [ia-coherent] Each tab answers exactly one question, no fact has two owning tabs, and the global header, collapse and freshness rules hold identically on every tab.
- R3: [vocabulary-closed] The status vocabulary and the domain-token mapping are total and unambiguous: every domain token the panes render maps to exactly one state, and no tab can draw a state outside the vocabulary.
- R4: [enforced-not-advised] Each rule the plan states is enforced by a mechanism that fails when the rule is broken (static check or render invariant), and the plan names a negative control showing that mechanism can fail.
- R5: [mockups-consistent] The mockups obey the plan's own tokens, components and formats; any mockup line that no component can produce is a defect.
- R6: [phases-shippable] Each migration phase leaves the pane working and shippable on its own, with an order whose dependencies are explicit, and no phase silently depends on an unverified assumption without naming where it is checked.
- R7: [identity-sound] The dispatch-tree identity hand-offs attribute each record to the correct session without guessing; ambiguous or missing links are shown as untracked rather than dropped or misattributed, and nothing writes into another session's state.
- R8: [scope-bounded] The plan does not add trust machinery (ADR-0001), does not require a version bump beyond the owner's hold, and keeps terminal constraints real (ssh plus tmux, colour by theme keys, no in-terminal images).
