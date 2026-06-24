# Project — port-autopilot-to-node
> Port Autopilot core runtime and validation scripts to pure Node.js (removing jq and python3 dependencies).

## OKR / success criteria
- **Objective**: 100% independence from jq and python3 in runtime and preflight paths, enabling flawless execution in Antigravity sandboxes.
- **KR1**: Port 5 core shell scripts (`qc-panel.sh`, `session-start.sh`, `check-node-report.sh`, `risk-counter.sh`, `tree.sh`) and 2 utility scripts (`toggle-payload-capture.sh`, `doc-drift-gate.py`) to pure Node.js.
- **KR2**: Pass all integration tests in `hooks/tests/run.sh` under a sandbox environment devoid of `jq` and `python3`.
- **KR3**: Validation with `agy plugin validate` exits successfully.

## Phases
| Phase | Size | Deliverable / Goal | Status |
|---|---|---|---|
| **Phase 1** | S | Port `risk-counter.sh` & `toggle-payload-capture.sh` to JS | Completed |
| **Phase 2** | S | Port `session-start.sh` to JS | Completed |
| **Phase 3** | S | Port `doc-drift-gate.py` to JS | Pending |
| **Phase 4** | L | Port `check-node-report.sh` to JS | Pending |
| **Phase 5** | H | Port `tree.sh` to JS with atomic self-healing flock | Pending |
| **Phase 6** | H | Port `qc-panel.sh` to JS with robust last-json parsing | Pending |
| **Phase 7** | S | E2E validation & clean up old scripts | Pending |
