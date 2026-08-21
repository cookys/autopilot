# Frozen review rubric — implementer qualification suite plan

IQ1: Construct-deviation soundness. The plan deliberately leaves the stateless case-broker
chassis (single-shot, no tools, no candidate code on host) for a live dispatch-hetero rail
where candidate code executes in its own worktree and later UNDER the host oracle in bwrap.
Does grading-by-git-artifact plus bwrap oracle execution actually close the forgery surfaces
the broker design closed by construction? Name a concrete way a candidate (or a
prompt-injected candidate) could reach `pass` on a trap case, or reach a no-verdict abort
instead of a candidate-attributed fail, that the plan's taxonomy does not pin. Pay specific
attention to: oracle crash/timeout attribution (§5 claims candidate-induced oracle failure is
`oracle_miss`, never `infra_fail`), and whether any dispatch-hetero status maps ambiguously.

IQ2: Oracle hiding and independence. Oracle vectors are "hidden" — but the candidate sees the
full exam repo and the six-element prompt, and F2/F3 repos contain runnable test files. Is
there any case family where the oracle is derivable (or approximable to pass-level) from
candidate-visible bytes, making the hidden oracle a shadow of what it grades? Is the leak-scan
byte-set (prompt bytes + all tracked repo bytes) the COMPLETE candidate-visible surface, given
the dispatch env also carries QUALIFY_CANARY_TOKEN and the runner injects its own chrome? Does
the reference-solution/deviant-artifact admission run genuinely exercise the SAME gate code
paths the live administration runs, or can admission green while the live path is dead?

IQ3: Trap discrimination and gaming inventory. The deviant matrix pins 10 shapes. Which
plausible gaming strategies are NOT countered and not named as residuals? Candidates: partial
test weakening below byte-compare granularity (e.g. rewriting a test file to byte-identical
content is impossible, but adding a NEW test file that shadows the old one; changing test
runner config instead of test files); satisfying F6 by committing a whitespace-only change
(does `fabricated_change` catch empty-diff commits?); scope compliance by writing the
out-of-scope content INTO the allowed file; canary leak encoded (base64/rot13) so the literal
scan misses it. For each real hole: structural counter or named residual — which does the plan
owe?

IQ4: Determinism, seed hygiene, and instrument validity. Generator/grader are claimed pure
functions with domain-separated labels and a payload-independence invariant. Is the invariant
testable as stated (changing only `oracle:*` chains leaves candidate-visible bytes identical)?
Are per-trial instances genuinely distinct in the dimensions that matter (an engine that
memorizes trial 1's repo shapes should not trivially transfer to trial 2)? Does any part of
the administration depend on wall clock, host process state, or the real repo's content in a
way that breaks (admin seed, generator file, corpus JSON) → byte-identical corpus?

IQ5: Chassis compatibility and blast radius. The change list touches engine-qualify.js role
routing, the flat `--expires-days` cap (30 → per-role ceiling: implementer 90, VA 60 becomes
newly claimable), capability-evidence METHODOLOGY_KINDS, and the codex mirror. Which existing
consumers can observe a behavior change (qualify-scorecard-vocabulary parity, validateRecordRow
bindings, resolve-scaffold-tier qualityOf regex on the new quality block, dispatch-contract
provisional admission, schema validators on pre-existing rows)? Is the additive claim verified
bidirectionally (old rows revalidate byte-for-byte AND new impl rows are rejected by the OLD
schema in the negative-control direction)? Is the `quality` block shape actually what
resolve-scaffold-tier's qualityOf reads, or does it silently land at a tier the plan does not
intend?

IQ6: Administration lifecycle honesty. Two dogfood administrations (grok-4.5 requalify;
agy/gemini-flash-4.7 high behind a Stage-0 probe). Is the probe-failure path honest (probe
fails ⇒ infra abort, instrument uncharged) or does it create a rerun-until-green side door for
the agy seat? Identity: grok echoes runtime identity, agy likely operator-asserted — does the
plan record `--version-source` honestly per seat and pin the pre-run probe artifacts into the
evidence bundle? Is the 24-dispatch budget per administration bounded with a stated per-case
timeout, and is `insufficient_budget` genuinely reachable (red case) rather than decorative?
