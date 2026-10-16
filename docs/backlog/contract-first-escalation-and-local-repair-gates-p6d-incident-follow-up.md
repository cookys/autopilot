# Dispatch justification check for acceptance-oracle tasks — P6D incident follow-up

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: An owner-approved project opens the dispatch-justification check; it must ship a planted negative case showing unjustified heavy dispatch for an acceptance-oracle task is blocked.
- **Context**: A bounded six-file/three-command consumer task was routed through strict L5 Mission governance. Its first candidate passed every functional verification but included two dependency symlinks; Codex then replaced a minute-scale amend with terminalization, successor adoption, governance churn, and full rerun. Fable 5 ruled this was two decision failures rather than a Git-only mistake. The corrective project should implement the smallest enforceable protocol from the incident: dispatch justification when a complete acceptance oracle already exists; pre-commit staged-manifest comparison against a machine-readable task allowlist; and a failure-response state machine that requires one local artifact repair before workflow-level expansion. Status-report budgeting is a controller interaction rule and must not be inflated into unrelated product machinery without separate evidence. Do not encode P6D's six paths or a blanket symlink ban as global policy.
- **Effort**: L (dispatch admission + commit manifest gate + failure-response transition contract + negative controls)
- **Source**: [`2026-08-21-p6d-orchestration-incident`](../projects/_archive/2026/08/2026-08-21-p6d-orchestration-incident/README.md), including the quoted Fable 5 independent judgment.


- **Owner 2026-10-17**: narrowed to the unshipped dispatch-justification control (the staged-manifest check and stateless rejection already shipped); keep waiting.
