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
| **Phase 3** | S | Port `doc-drift-gate.py` to JS | Completed |
| **Phase 4** | L | Port `check-node-report.sh` to JS | Completed |
| **Phase 5** | H | Port `tree.sh` to JS with atomic self-healing flock | Completed |
| **Phase 6** | H | Port `qc-panel.sh` to JS with robust last-json parsing | Completed |
| **Phase 7** | S | E2E validation & clean up old scripts | Completed |

## Cleanup Details
- **Deleted Legacy Scripts** (no wrapper shims — the shell/python originals were removed outright and all wiring re-pointed at the `.js` entrypoints; `hooks.json` + `settings.example.json` updated):
  - `scripts/doc-drift-gate.py` → `scripts/doc-drift-gate.js` (Phase 3)
  - `scripts/risk-counter.sh` → `scripts/risk-counter.js` (Phase 1)
  - `scripts/toggle-payload-capture.sh` → `scripts/toggle-payload-capture.js` (Phase 1)
  - `hooks/session-start.sh` → `hooks/session-start.js` (Phase 2)
  - `scripts/check-node-report.sh` → `scripts/check-node-report.js` (Phase 4)
  - `scripts/tree.sh` → `scripts/tree.js` (Phase 5)
  - `scripts/qc-panel.sh` → `scripts/qc-panel.js` (Phase 6)

> Note: an earlier draft of this README described these as "wrapped legacy entrypoints retaining backward compatibility." That was superseded by the final cleanup commit, which **removed** the shell wrappers entirely — there is no `.sh`/`.py` fallback. Callers must use the `.js` paths.

