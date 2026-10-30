# SessionStart brief-header hint vs the two dispatch guards (BL-0338)

Reported 2026-10-31 via 4124gs (message 01M66Z68PA0PZDR96C0XRKECP1), owner asked; depth-0 verified.

1. The SessionStart text "Agent brief first three lines: Engine: <model> | Role: <role> | Lane: <slug>" is built by `hooks/lib/brief-header-template.js:76`, which joins the template lines with " | ". Written as one line, the brief is rejected by `hooks/subagent-budget.js:498` ("carries no valid "Lane:" line").
2. Written as three lines, an expensive engine (for example fable) is then rejected by dispatch-model-guard: line one must read `Engine: fable (intentional: <why>)`. Neither the hint nor the dispatch skills say so, so even an owner-named engine is blocked once.

Direction: a copyable three-line template including the expensive-engine intentional form; both guards report all gaps in one message; regression test that runs the SessionStart template through both guards and must pass.
