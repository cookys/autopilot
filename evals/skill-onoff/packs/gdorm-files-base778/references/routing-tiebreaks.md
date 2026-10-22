# Routing Tiebreaks

This reference document defines canonical tiebreaks for resolving ambiguous user intents between overlapping skills.

## Overlap Resolution Table

| Ambiguous intent | Route A | Route B | Tiebreak |
|---|---|---|---|
| "get it done" / 全權處理 | skills/ceo-agent/SKILL.md | skills/l3/SKILL.md | Use skills/ceo-agent/SKILL.md when the user uses general conversational phrasing indicating full delegation and high-level autonomy. Direct the request to skills/l3/SKILL.md (or the matching l4/l5/l6 front-door) when the user typed an explicit front-door command form — a literal slash command such as /l3, or the documented bare shorthand such as "L3 goal-text". Conversational autonomy phrasing with no command form routes to skills/ceo-agent/SKILL.md. |
| "verify X matches Y" | skills/audit/SKILL.md | skills/doc-sync/SKILL.md | Route to skills/audit/SKILL.md if the intent is to verify consistency between two distinct implementations, systems, or code paths. Choose skills/doc-sync/SKILL.md when the verification is specifically comparing prose documentation against the actual codebase. This distinction keeps architectural audits separate from doc-syncing validation. |
| "critique this future plan" / "is this plan ready to implement?" | plan-readiness reviewer | skills/audit/SKILL.md | Route to plan readiness when the Target is future or unimplemented. Audit is legal only when both Source and Target implementations already exist. Current-repo absence of a future feature is not an audit mismatch. |
| tradeoff / 分析利弊 | skills/survey/SKILL.md | skills/think-tank/SKILL.md | Route to skills/survey/SKILL.md if the tradeoff analysis requires gathering external evidence, industry benchmarks, or existing literature. Prefer skills/think-tank/SKILL.md if the decision involves internal prioritization, team role debates, or strategic alignment. This splits external research from internal policy-making. |
| flaky test | skills/debug/SKILL.md | skills/test-strategy/SKILL.md / skills/quality-pipeline/SKILL.md | Redirect to skills/debug/SKILL.md if the focus is on diagnosing and fixing a single failing test instance. Use skills/test-strategy/SKILL.md if the intent involves test methodology or baseline design. Choose skills/quality-pipeline/SKILL.md when dealing with a pre-merge check or CI gate failure. |
| "investigate then do it" | skills/ceo-agent/SKILL.md | skills/research-to-ship/SKILL.md | Delegate to skills/ceo-agent/SKILL.md if the task grants full autonomy to execute from start to finish without checkpoints. Route to skills/research-to-ship/SKILL.md if the workflow requires a human-gated planning and review pipeline. This preserves safety boundaries for high-risk modifications. |
| "what's the priority" | skills/next/SKILL.md | skills/think-tank/SKILL.md | Route to skills/next/SKILL.md to scan the existing backlog, project roadmap, or active tracking documents. Choose skills/think-tank/SKILL.md to resolve priorities through a strategic debate or policy review. This separates routine execution planning from high-level strategic alignment. |

## Detailed Guidelines

1. **Conversational vs. Direct Commands**
   - High-level requests indicating absolute trust (e.g., "get it done") map to `skills/ceo-agent/SKILL.md`.
   - Direct invocation via specific slash commands (e.g., `/l3`, `/l6`) are handled by their respective front-doors directly.

2. **System Audits vs. Documentation Sync**
   - Verification across two different system implementations belongs in `skills/audit/SKILL.md`.
   - Alignment between prose documents and active code belongs in `skills/doc-sync/SKILL.md`.
   - Readiness/architecture critique of a future plan belongs in the bounded plan-review rail
     (`scripts/dispatch-plan-review.js`), even when repository code is inspected to verify premises.
   - If the proposed Target implementation does not exist, audit returns
     `routing_precondition_failed`; it never manufactures parity findings from absence.

3. **External Surveys vs. Internal Decision-making**
   - External evidence and industry research map to `skills/survey/SKILL.md`.
   - Internal prioritization, strategy, and roles map to `skills/think-tank/SKILL.md`.

4. **Debugging vs. Strategy & Pipeline**
   - Resolving individual test errors maps to `skills/debug/SKILL.md`.
   - General test infrastructure design maps to `skills/test-strategy/SKILL.md`.
   - Automated checks and pre-merge validation gates map to `skills/quality-pipeline/SKILL.md`.

5. **Autonomous Execution vs. Gated Ship**
   - Direct execution under full autonomy maps to `skills/ceo-agent/SKILL.md`.
   - Human-in-the-loop review and planning gates map to `skills/research-to-ship/SKILL.md`.

6. **Roadmap Tracking vs. Strategic Prioritization**
   - Scanning existing backlogs and issue lists maps to `skills/next/SKILL.md`.
   - Debating priorities or establishing policies maps to `skills/think-tank/SKILL.md`.
