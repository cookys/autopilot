# consult_dispatch has no seat left once the qc panel excludes everything

Section copied from the shared sidecar `docs/backlog/live-state-dir-context-budget-test-strength-two-surviving-mutants-one-vacuous-of.md` (other sections omitted). Original size label: S.

- **Context**: On `cookys-openclaw`, `resolve-review-loop.sh` emits `consult_dispatch: auto` with `consult_resolved_from: native-fallback` and the warning that no qualified consult seat remains after qc-panel exclusion, falling back to `sonnet/high@claude-native`. `scripts/dispatch-consult.sh` then refuses outright because consult dispatch is off and no transport was dispatched. Measured 2026-09-11 in the fleet-comms tree.
- **Why it matters**: the consult seat exists so depth-0 can ask a different family a design question. Falling back to claude-native resolves it to the same model that is asking — the one configuration that cannot answer the question the seat was created for — and the script is right to refuse rather than pretend. The caller is then left with no supported route, and the natural workaround is to invoke a runner by hand. On that host the qc panel excluded every hetero engine that had a working structured path; the engine left over was grok, whose review parser is incompatible but whose prose answers are fine, and prose is all a consult needs.
- **Trigger**: next time a consult is dispatched on a host whose qc panel covers its whole roster, or the next edit to the consult resolution in `resolve-review-loop.sh`.
- **Guardrails**: do not solve it by letting a qc-panel seat double as the consult. The shape that fits is a consult-only fallback list of engines that are decorrelated but not panel members, with parse requirements relaxed to "returns text" rather than "returns a verdict". The warning should name which engines were excluded and why.

Restored 2026-10-19 from 41f1bff64^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
