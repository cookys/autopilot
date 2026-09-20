# Plan — Eliminate Shell Wrappers in favor of Direct JS Execution

> Status: Proposal (R0)  
> Owner: Tech Lead  
> Branch: `feat/eliminate-shell-wrappers`  
> Frame: Phase 2 (Write the Plan) of `research-to-ship`

---

## 0. Context / thesis

Autopilot recently completed its core pure Node.js migration (`port-autopilot-to-node`), refactoring all Python/Bash scripts to Node.js siblings. To maintain backward compatibility, thin `.sh` wrappers (such as `scripts/tree.sh` delegating to `scripts/tree.js`) were kept at the original paths.

However, this design introduces several engineering issues:
1. **Windows Dependency Inflation**: Executing `.sh` files on Windows requires a shell interpreter (like Git Bash), adding an extra dependency. If run without Git Bash, execution fails.
2. **Signal Truncation**: Windows `.cmd` or `.sh` wrapper execution intercepts terminal signals (e.g., Ctrl+C prompts "Terminate batch job (Y/N)?"), which bypasses clean Node process cleanup.
3. **Redundant Process Layers**: Spawning a shell to immediately spawn Node.js adds unnecessary process overhead.

Since modern agent platforms support direct execution of JS files via shebangs (`#!/usr/bin/env node`) on Unix-like OSes and explicit `node script.js` command configurations in JSON manifests, we can completely eliminate the `.sh` wrapper layer.

---

## 1. Problem

The codebase still carries `.sh` wrapper files for:
- `hooks/session-start.sh` (SessionStart hook)
- `scripts/qc-panel.sh` (QC Panel Interrogation)
- `scripts/check-node-report.sh` (Report validation)
- `scripts/risk-counter.sh` (WTF-likelihood counter)
- `scripts/tree.sh` (Task tree CLI)
- `scripts/toggle-payload-capture.sh` (Capture toggle utility)

We must remove these wrappers, rename references, and configure direct `.js` execution while preserving 100% test compatibility across all operating systems.

---

## 2. OKR / KRs

* **OKR**: Achieve a 100% shell-free execution path on Windows and Unix-like environments, removing all `.sh` wrappers and maintaining 100% integration test suite pass rates.
  * **KR1**: Remove all 6 legacy shell wrappers (`session-start.sh`, `qc-panel.sh`, `check-node-report.sh`, `risk-counter.sh`, `tree.sh`, `toggle-payload-capture.sh`).
  * **KR2**: Re-wire `hooks.json` to run `node session-start.js` directly.
  * **KR3**: Update Git hooks, CI workflows, and test files to run `.js` versions directly (exiting 100% green on `hooks/tests/run.sh`).

---

## 2.5 Global Constraints (copied verbatim into every dispatch)
- Node ≥ 20.10 (do not use APIs added after 20.10).
- No external NPM dependencies (use only native Node.js built-ins).
- Executable permissions: All JS scripts meant for direct execution must start with `#!/usr/bin/env node` and have execution permissions (`chmod +x`).
- Canonical LF Output: Ensure all generated output text is LF-only; do not use `os.EOL` to prevent CRLF injection.

---

## 3. File-structure map

| File Path | Original Responsibility | Refactored Responsibility |
| :--- | :--- | :--- |
| **`hooks/hooks.json`** | Registers hook commands | Re-wire SessionStart command to run `node` on JS directly |
| **`hooks/session-start.sh`** | SessionStart shell wrapper | Deleted |
| **`scripts/qc-panel.sh`** | QC Panel shell wrapper | Deleted |
| **`scripts/check-node-report.sh`** | Report validator shell wrapper | Deleted |
| **`scripts/risk-counter.sh`** | Risk counter shell wrapper | Deleted |
| **`scripts/tree.sh`** | Tree CLI shell wrapper | Deleted |
| **`scripts/toggle-payload-capture.sh`**| Capture utility shell wrapper | Deleted |
| **`scripts/check-hook-inventory.js`** | Hook inventory tally oracle | Update script to omit `.sh` extension fallback verification |
| **`.githooks/` (pre-push/pre-commit)** | Git lifecycle hooks | Update references to point to Node or JS scripts directly |
| **`hooks/tests/*.test.sh`** | Integration tests | Update `SCRIPT=` variables to target `.js` executables |
| **`hooks/tests/run.sh`** | Test runner execution script | Ensure JS direct tests execute without shell wrappers |
| **`CLAUDE.md` / `README.md`** | Public manuals | Update CLI commands to reference `.js` versions |

---

## 4. Phases

### Phase 1: Hooks Manifest & Git Hooks Re-Wiring · Effort S
* **Manifest Re-wiring**:
  - Delete `hooks/session-start.sh`.
  - In `hooks/hooks.json`, update the `SessionStart` command to: `"command": "node \${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js"`.
* **Git Hooks Update**:
  - In `.githooks/pre-commit`, update `/scripts/sync-agent-bodies.sh --check` to `node ./scripts/sync-agent-bodies.sh --check` (or ensure target is JS if it was ported).
  - Check all `.githooks/*` references and update from `.sh` to `.js` or `node`.
* **Tally Update**:
  - In `scripts/check-hook-inventory.js`, modify any pattern matches searching for `.sh` hooks to assert `.js` files exclusively.
* **Acceptance Criteria**: `check-hook-inventory.js --check` runs successfully and reports no drift in manifests.

### Phase 2: CLI Wrapper Deletion & Executable Permissions · Effort S
* **Delete Wrappers**:
  - Delete: `scripts/qc-panel.sh`, `scripts/check-node-report.sh`, `scripts/risk-counter.sh`, `scripts/tree.sh`, `scripts/toggle-payload-capture.sh`.
* **Set Permissions**:
  - Verify that `scripts/qc-panel.js`, `scripts/check-node-report.js`, `scripts/risk-counter.js`, `scripts/tree.js`, and `scripts/toggle-payload-capture.js` all start with `#!/usr/bin/env node`.
  - Mark them executable: `chmod +x scripts/*.js`.
* **Acceptance Criteria**: Wrappers are removed, and JS siblings are directly executable via `./scripts/*.js` on Unix systems.

### Phase 3: Test Suite & CI/CD Realignment · Effort S
* **Test Configurations**:
  - In `hooks/tests/*.test.sh` files, update all `SCRIPT=` paths to point directly to their `.js` siblings (e.g. `SCRIPT="$REPO_ROOT/scripts/qc-panel.js"`).
* **CI Workflows**:
  - Update `.github/workflows/test.yml` runner commands from `.sh` to `.js` (or `node`).
* **Acceptance Criteria**: `./hooks/tests/run.sh` passes 100% (all 57 test files are green).

### Phase 4: Docs & Prose Sync · Effort S
* **Prose Updates**:
  - In `README.md`, `README.zh-TW.md`, `CLAUDE.md`, and `skills/` Markdown files, replace references to the deleted `.sh` wrapper paths with their corresponding `.js` paths or explicit `node` invocations.
* **Validation**:
  - Run `scripts/preflight-portability.sh` and `node scripts/check-readme-parity.js` to ensure zero broken links or fence mismatches remain.
* **Acceptance Criteria**: Preflight checks pass successfully and doc-drift validation is clean.

---

## 5. Test / validation

- **L1 Unit tests**: `node --test` unit tests execute successfully.
- **L2 Integration tests**: `hooks/tests/run.sh` runs all 57 integration test files and verifies 100% assertions are green.
- **Portability preflight**: `scripts/preflight-portability.sh` runs green with no errors.

---

## 6. Risks + inversion

* **Risk 1: Missing execution bits on Unix filesystems**
  - *What guarantees failure*: If a `.js` script is committed without Git executable permissions (`+x`), cloning on Linux/macOS will fail to run them as executables.
  - *Mitigation*: Run `git update-index --chmod=+x scripts/*.js` before committing, ensuring git records the permissions correctly.
* **Risk 2: Space-in-path interpolation errors**
  - *What guarantees failure*: If paths with spaces (e.g. `C:\Program Files\Autopilot`) are evaluated by `node ${CLAUDE_PLUGIN_ROOT}/...` without wrapping in quotes.
  - *Mitigation*: Ensure `hooks.json` and configs handle interpolation correctly, and test paths containing spaces in a sandbox environment.

---

## 7. Out of scope

- Refactoring non-Node shell scripts (like `scripts/calibration.sh` or `scripts/install-antigravity.sh` which are purely local build/test orchestration shell scripts, not core runtime helpers).
- Changing execution logic or logic structure inside the ported Node files.

---

## 8. Open questions

1. **Do we need to retain any shell aliases or scripts for local developer convenience?**
   - *TL Recommendation*: No. Developers are fully comfortable running `node scripts/tree.js` or setting up their own local aliases. Keeping the wrappers just adds maintenance debt.

---

## Review log

* **R0 (2026-06-25)**: Author (Tech Lead) proposal. Ready for dialectic review.
