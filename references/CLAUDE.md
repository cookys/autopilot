# references/ - directory rules (Claude Code and any depth-0 controller)

Loaded when a session reads or edits a file under `references/`. Root `AGENTS.md` keeps one-line versions of every clause below; this file holds the full text and the evidence stories.

## Orchestration Discipline (learned, cross-controller)

Rules distilled from real long-run transcripts of this repo's 2026-07 Mission/L6 campaigns. They bind ANY depth-0 controller driving this repo (Claude Code, Codex, OpenCode, Antigravity, …) — the failures they encode were produced by more than one controller. Machine-enforced versions are landing via `project/backlog/BACKLOG.md` § "P0 — Controller execution discipline"; until every gate ships, treat these as binding methodology, not suggestions.

### Orchestration granularity (phase-explosion prevention)

- Source-plan phase headings (`P0..PN`) are the author's *document* structure, NOT execution phases. Multi-plan intake first normalizes into a bounded deliverable DAG — default max 8 deliverables. Tests, review seats, repair generations, and doc sync are gates INSIDE a deliverable, never new deliverables or phases.
- Every deliverable binds its source plan/rubric, dependencies, acceptance command, resource reservation, and gate-attempt budget; the totals stay under the Mission ceiling.
- A review or test failure is repaired inside its original deliverable. Adding a phase to hide a retry is forbidden. A new branch/session/ticket/model must NOT reopen an unresolved Mission's lineage, graph, or budget without a reconciled terminal receipt.
- Self-check: if the tracker row count equals the sum of all source-plan phase counts, stop — document segmentation has been mistaken for execution segmentation. (Origin: a 2026-07-28 portfolio run expanded 7 plans into 34 rows ≈ 238 workflow nodes; compaction amplified the damage, but granularity without a ceiling was the root cause.)

### Dispatch / foreman clauses (each missing clause has burned a full round)

- Hand-authoring substance at the orchestrator level = protocol violation, even when the output is good. "The engine isn't up to this" is an ESCALATION, never a license to implement at depth-0 — decorrelation-by-generation is the point, quality does not exempt it.
- Read the raw child log BEFORE classifying a failure. A quota death ("You've hit your usage limit") has been misclassified as a model question, wasting two dispatch rounds before a human read the log.
- Env vars and the command consuming them must be in the SAME shell invocation — exports do not survive across separate tool calls.
- Prefer one blocking wait (long-timeout foreground command, or the harness's background-task notification) over polling loops when babysitting a child process. Polling burns context, which forces compaction, which loses controller state — the compounding is worse than the wait.
- A background agent that yields its own turn to wait on ITS OWN background child should NOT be assumed to be auto-woken when that child completes — on at least one controller this requires an explicit wake from the dispatcher, and a brief's "never yield" clause did not reliably prevent the parking (re-observed twice in the same run after the clause was already present). Different controllers may have different nested-completion notification semantics; do not assume any particular one propagates. Treat parking as the conservative default and budget a wake at every phase boundary rather than trusting the clause: on the child's completion event, cross-check that the child is actually done via the dispatcher's own status query (never the parked agent's self-report), then wake it with an explicit instruction to harvest the result, advance to the next phase, and not park again.
- Never dispatch background work you cannot be woken for. Use the harness's native background-completion notification, or an explicit self-polling wake armed before dispatch — never a bare detached process with no return path back to the controller; that shifts the wait onto a human.
- Shell working directory may persist across tool calls. Before any git state operation (merge, `worktree remove`), pin an absolute path or start with an explicit `cd <repo-root> &&`. Before resuming an agent into a worktree, verify the tree still exists (`git worktree list`) — auto-cleaned worktrees make a resumed agent silently operate on the main checkout.

### CI / test-log reading

- The only authority for which test files failed is the runner's Summary section (the `❌ N / M test files FAILED:` list) or a file's own `PASS [name] N assertions` line. `grep FAIL` over a CI log also matches fixtures' intentional negative-path output — identical lines exist in green runs — and has doubled a repair scope before. Cross-check the same log section in a known-green run to unmask fixture output.
- GitHub Actions `run:` steps without an explicit `shell:` default to `bash -e {0}` — NO pipefail. Any `cmd | tee` pipeline silently swallows the command's failure → false-green CI. Steps that pipe a test command must set explicit `shell: bash` (or lead with `set -o pipefail`). Verify by intentionally breaking one test and confirming CI goes red.

## Review practice (moved from AGENTS.md)

- **Reviews are dialectic**. For non-trivial changes, prefer 3-perspective review (Architect / Ops / Skeptic) — each spawned in parallel with disjoint focus. Findings get tagged with the unified severity vocabulary and consolidated in a review summary table within the plan.
