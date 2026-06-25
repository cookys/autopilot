# Plan — Port Autopilot Core Scripts to Node.js (Pure JS Refactor)

> Status: Proposal (R0)  
> Owner: Tech Lead  
> Branch: `feat/port-autopilot-to-node`  
> Frame: Phase 2 (Write the Plan) of `research-to-ship`

---

## 0. Context / thesis

Autopilot is currently powered by a mix of Bash scripts, JS scripts, and Python helpers. However, when running inside strict sandboxed environments like Google Antigravity (`agy`), external dependencies like `jq` and `python3` are not guaranteed to be present or accessible. 

Node.js is a first-class citizen across all four target agent platforms (Claude Code, OpenCode, Codex, and Antigravity). By refactoring core runtime and validation scripts into pure JavaScript (using only Node.js built-in modules), we:
1. **Eliminate host environment assumptions**: Ensure 100% execution safety in highly restricted sandbox environments.
2. **Remove external CLI dependencies**: Completely eliminate dependencies on `jq` and `python3`.
3. **Consolidate tooling**: Simplify codebase maintenance, testing, and debugging.

To preserve exact contract compatibility for existing workflows, subagents, and test suites, **we will replace the core `.sh` script entrypoints with thin bash wrappers that delegate directly to their new JS counterparts.**

---

## 1. Problem

The current execution path relies on Bash (`set -euo pipefail`), `jq` (for JSON structure parsing/mutation), and `python3` (for complex calculations, minifying, and regex JSON parsing). In restricted sandboxes:
- Running `jq` raises command-not-found or execution permission errors.
- Running `python3` introduces startup overhead and potential version mismatches.
- Differences in macOS vs. Linux implementations of basic commands (e.g., `stat`, `date`, `sed`, `flock`) lead to brittle code.

The target is to move all JSON validation, file-locking, panel synthesis, and state mutation out of Bash/jq/Python and into standard Node.js.

---

## 2. OKR / KRs

* **OKR**: Achieve complete independence from `jq` and `python3` in the Autopilot runtime path, maintaining 100% test suite parity under restricted environments.
  * **KR1**: Rewrite 5 core scripts (`qc-panel.sh`, `session-start.sh`, `check-node-report.sh`, `risk-counter.sh`, `tree.sh`) and 2 utility scripts (`toggle-payload-capture.sh`, `doc-drift-gate.py`) to pure Node.js.
  * **KR2**: Pass all 50+ existing integration and unit tests (`hooks/tests/run.sh` and `node --test`) without modifications to test assertions.
  * **KR3**: Ensure successful plugin installation and verification (`agy plugin validate`) under a mock sandbox environment lacking `jq` and `python3`.

---

## 2.5 Global Constraints (copied verbatim into every dispatch)

- **Node ≥ 20.10** (use only APIs available in Node 20.10; do not use newer APIs).
- **No external NPM dependencies**. Use only native Node.js built-in modules (e.g., `fs`, `path`, `child_process`, `crypto`, `os`, `readline`).
- **No `jq` or `python3` executions** in the production runtime path.
- **Maintain backward-compatible CLI contracts**. CLI arguments (options, flags, stdout/stderr formatting) and exit codes must remain identical.
- **Fail-Closed vs. Fail-Open Boundaries**: 
  - **Critical path scripts** (e.g., `check-node-report.js`, `tree.js`) MUST Fail Closed: any error/malformation/pointer resolution failure aborts with a non-zero exit code.
  - **Non-critical/telemetry scripts** (e.g., `risk-counter.js`, `toggle-payload-capture.js`, `session-start.js`) MUST Fail Open: exceptions are caught, warning messages are printed to stderr, and they exit with code 0 to prevent blockages of the core agent loops in restricted environments.
- **Windows CRLF Safe-Harbor**: Checksum calculations and text processors must normalize line endings (`replace(/\r\n/g, '\n')`) for text/markdown files only (using extension/UTF-8 guards to prevent corruption of binary assets) before computing hashes.
- **Canonical LF Output**: Keep all generated repo text output canonical LF. Do NOT use `os.EOL` as it expands to CRLF on Windows.
- **Safe Process Existence Check**: In `isProcessAlive()`, treat `EPERM` (permission denied) as "alive/unknown" instead of dead/stale.

---

## 3. File-structure map

| File Path | Original Responsibility | Refactored Responsibility / Seams |
| :--- | :--- | :--- |
| **`hooks/session-start.sh`** | Startup lifecycle hook | Shell wrapper delegating to `hooks/session-start.js` |
| **`hooks/session-start.js`** | (New) | Pure JS logic for context assembly, compaction state recovery, age checking, hostname matching, and JSON-escaped output. |
| **`scripts/qc-panel.sh`** | 6-judge interrogation panel | Shell wrapper delegating to `scripts/qc-panel.js` |
| **`scripts/qc-panel.js`** | (New) | Parallel child-process dispatches (Claude & Gemini), JSON extraction (replacing python parser), Synthesizer logic, and Refute Shadow logging. |
| **`scripts/check-node-report.sh`** | Node report contract validator | Shell wrapper delegating to `scripts/check-node-report.js` |
| **`scripts/check-node-report.js`** | (New) | Detailed JSON schema validation, evidence pointer resolution (Mode A commit-anchored / Mode B basename-match), sha256 artifact verification, error/warning accumulation. |
| **`scripts/risk-counter.sh`** | Persistent WTF-Cap counter | Shell wrapper delegating to `scripts/risk-counter.js` |
| **`scripts/risk-counter.js`** | (New) | Pure JS persistent state mutation, reading risk levels from `$AUTOPILOT_STATE_DIR/risk-*.json`. |
| **`scripts/tree.sh`** | Task-tree event log CLI | Shell wrapper delegating to `scripts/tree.js` |
| **`scripts/tree.js`** | (New) | Event appending, atomic locking (custom flock emulator using `fs.openSync(lock, 'wx')` with retry loops), index rebuilding, and board-status subcommands. |
| **`scripts/toggle-payload-capture.sh`**| Capture-payload wiring tool | Shell wrapper delegating to `scripts/toggle-payload-capture.js` |
| **`scripts/toggle-payload-capture.js`** | (New) | Modifies `hooks/hooks.json` array filters natively via JS (replacing `jq` logic). |
| **`scripts/doc-drift-gate.py`** | Doc-drift L1 baseline gate | Ported to `scripts/doc-drift-gate.js` (Python file deleted or archived). |
| **`scripts/doc-drift-gate.js`** | (New) | Link resolution and code fence checks rewritten in Node.js. |

---

## 4. Phases

### Phase 1: Port `risk-counter.sh` & `toggle-payload-capture.sh` · Effort S
* **Risk Counter (`scripts/risk-counter.js`)**: 
  - Read risk state JSON file. Apply increments. Append events with UTC timestamp. Write back.
  - Implement commands: `status`, `reset`, `increment`, `threshold-hit`, `path`.
* **Toggle Payload Capture (`scripts/toggle-payload-capture.js`)**:
  - Read `hooks.json`, perform AST-like injection of capture scripts on matchers, write back. Revert on disable.
* **Thin Shell Wrappers**: Write minimal wrappers forwarding arguments to JS scripts.
* **Acceptance Criteria**: `check-redispatch-prompt.test.sh` and capture tests pass.

### Phase 2: Port `session-start.sh` · Effort S
* **Session Start (`hooks/session-start.js`)**:
  - Check file ages using `fs.statSync().mtimeMs`.
  - Canonicalize current working directory using `fs.realpathSync()`.
  - Generate SHA-1 hashes of the CWD via `crypto.createHash('sha1')`.
  - Query current hostname via `os.hostname()`.
  - Assemble markdown context and escape for JSON before console printing.
* **Acceptance Criteria**: Context injection output matches original Bash output byte-for-byte (aside from OS differences).

### Phase 3: Port `doc-drift-gate.py` to JS · Effort S
* **Doc Drift Gate (`scripts/doc-drift-gate.js`)**:
  - Walk directory recursively (mimicking `os.walk` using async/sync FS APIs).
  - Apply link regex matches `_FILE_EXT` and `_GH_REL` to detect broken file links and unbalanced triple-backticks code fences.
* **Update `preflight-portability.sh`**: Change Python call to `node scripts/doc-drift-gate.js`.
* **Acceptance Criteria**: Preflight checks run green, `doc-drift-gate.test.sh` passes.

### Phase 4: Port `check-node-report.sh` · Effort L
* **Check Node Report (`scripts/check-node-report.js`)**:
  - Implement lightweight, robust schema validation in JS (checking required keys, numeric range of `confidence`, array structures).
  - Implement evidence pointer parser: `file:line-range` and `sha256:hex`.
  - Resolve pointer via Git if commit SHA is present using `child_process.execSync("git show ...")`.
  - Handle moved files (Mode A/B) and report warnings or errors.
  - Verify SHA256 checksums of artifacts using `crypto.createHash('sha256')`.
* **Acceptance Criteria**: `check-node-report.test.sh` (which checks invalid JSON, hash mismatches, stale pointers, and schema violations) passes with zero changes to test file.

### Phase 5: Port `tree.sh` (Task Tree Engine) · Effort H
* **Tree Engine (`scripts/tree.js`)**:
  - Implement subcommands: `init`, `emit`, `rebuild-index`, `next-decision`, `report`, `escalations`, `fetch`, `board-status`.
  - **Cross-Platform File Locking**: Implement a robust self-healing hybrid locking loop in JS using process existence, hostname, workspace keys, and random tokens:
    ```javascript
    function acquireLock(lockFile, timeoutMs = 5000) {
      const start = Date.now();
      const token = crypto.randomUUID();
      const lockData = JSON.stringify({
        pid: process.pid,
        ts: start,
        hostname: os.hostname(),
        cwd: process.cwd(),
        token: token
      });
      while (Date.now() - start < timeoutMs) {
        try {
          // Attempt exclusive write (wx)
          const fd = fs.openSync(lockFile, 'wx');
          fs.writeFileSync(fd, lockData);
          fs.closeSync(fd);
          return;
        } catch (err) {
          if (err.code !== 'EEXIST') throw err;
          // Lockfile exists: verify if stale (PID dead / timeout exceeded)
          try {
            const existing = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
            const isLocal = existing.hostname === os.hostname() && existing.cwd === process.cwd();
            let isAlive = true;
            if (isLocal && existing.pid) {
              isAlive = isProcessAlive(existing.pid);
            }
            const isStale = (Date.now() - existing.ts > 10000) || !isAlive;
            if (isStale) {
              // Attempt to recover lock safely (quarantine/warning logging instead of silent unlink)
              console.warn(`[LockRecovery] Stale lock detected (token: ${existing.token}). Overwriting.`);
              fs.unlinkSync(lockFile);
              continue; // retry immediate acquisition
            }
          } catch (readErr) {
            // Unparseable/empty lockfile is treated as stale/corrupted and quarantined
            console.warn(`[LockRecovery] Corrupt lockfile detected. Quarantining.`);
            try { fs.unlinkSync(lockFile); } catch (e) {}
          }
          // Sleep 50ms (synchronous loop delay)
          const waitTill = Date.now() + 50;
          while (Date.now() < waitTill) {}
        }
      }
      throw new Error("Lock timeout");
    }
    function isProcessAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        // EPERM means process exists but we lack permission to signal it
        return err.code === 'EPERM';
      }
    }
    ```
  - Event appending and JSONL parsing.
* **Acceptance Criteria**: `tree-engine.test.sh` passes completely.

### Phase 6: Port `qc-panel.sh` (QC Interrogation) · Effort H
* **QC Interrogation (`scripts/qc-panel.js`)**:
  - Parse CLI parameters: `--report`, `--artifacts`, `--diff`, `--out`, `--proj`, `--node`.
  - Implement parallel dispatching of judges (Claude via shell execution, Gemini via `agy`).
  - Robust JSON extraction `extract_last_json` in JS:
    ```javascript
    function extractLastJson(text) {
      // Find the last parseable JSON block starting with { and ending with }
      // Try parsing from every '{' index backwards to find the longest valid JSON.
    }
    ```
  - Determinstic merge of judge outputs, synthesize verdict using haiku synthesizer.
  - Call `scripts/calibration.sh` via child process.
* **Acceptance Criteria**: `qc-panel.test.sh` runs and passes with zero test failures.

### Phase 7: Verification and Cleanup · Effort S
* **Integrate & Validate**: Run `scripts/validate.sh` and `hooks/tests/run.sh`.
* **Sandbox Verification**: Remove `jq` and `python3` paths from environment `$PATH` and verify the plugin installs and executes successfully via `agy plugin validate` and `agy plugin install`.
* **Housekeeping**: Delete original `.py` files and clean up backup scripts.

---

## 5. Test / validation

* **L1 Unit Tests**:
  - Author Node.js unit tests (`scripts/check-node-report.test.js`, `scripts/tree.test.js`) verifying edge cases of JSON parsing, path canonicalization, and custom file locking.
* **L2 Integration Tests**:
  - Run `hooks/tests/run.sh` to execute all integration tests.
  - Validate all mock-execution paths inside stubs execute correctly.
* **Adversarial Check**:
  - Run the test suite on a temporary path with an empty/isolated `PATH` (stubbing out `jq` and `python3`) to guarantee no silent dependency fallback exists.

---

## 6. Risks + inversion

* **Risk 1: Stale lockfiles and concurrent Bash flock compatibility**
  - *What guarantees failure*: If a Node process crashes, a standard `'wx'` lockfile is left on disk, permanently deadlocking subsequent invocations.
  - *Mitigation*: Implement self-healing lock recovery by writing `{ pid, ts }` inside the lockfile. The locking logic checks if the owning PID is dead (using `process.kill(pid, 0)`) or if the lock has exceeded a 10s TTL, unlinking and reclaiming the lock automatically. Bash wrappers will also delegate locking completely to the JS side to avoid mixed descriptor/file-namespace locking blindspots.
* **Risk 2: Narrative pollution in LLM JSON responses**
  - *What guarantees failure*: Python's `json.JSONDecoder().raw_decode` scan is highly customized to extract the last valid JSON structure. A naive regex or `indexOf` parser will fail when there is narrative markdown surrounding the JSON.
  - *Mitigation*: Directly implement the balance-bracket parsing scanner in JS. It scans the string starting from each `{` index to the matching `}`, keeping the longest substring that parses successfully via `JSON.parse`.
* **Risk 3: Environment variables mapping**
  - *What guarantees failure*: Missing key environment seams (like `QC_CLAUDE_BIN` or `QC_AGY_BIN`) inside Node's `child_process.spawn`.
  - *Mitigation*: Explicitly inherit `process.env` in all child process executions.
* **Risk 4: Concurrency race during stale lock recovery**
  - *What guarantees failure*: A naive "read lock, decide stale, unlink" can race when two concurrent processes both decide a lock is stale and both try to unlink and recreate it simultaneously.
  - *Mitigation*: Include a random token in lock metadata. When a stale lock is detected, the reclaiming process must use a recovery mutex (such as a temporary lock folder/file) to serialize the unlink-and-reclaim sequence.
* **Risk 5: Binary asset corruption during CRLF normalization**
  - *What guarantees failure*: A blanket regex replace of `\r\n` to `\n` across arbitrary files can corrupt binary assets (images, PDFs) in the repository.
  - *Mitigation*: Use strict extension guards (only target `.md`, `.json`, `.js`, `.sh`, `.txt`) and verify the content is valid UTF-8 before applying CRLF normalization.

---

## 7. Out of scope

* Changing the core logic of the `calibration.sh` script (it doesn't use `jq` or `python3` for execution, only comments mention them; we will defer porting it to JS until a later phase).
* Introducing any external package managers (e.g. yarn, pnpm) or package registries.
* Modifying OpenCode's TypeScript plugin loader.

---

## 8. Open questions

1. **How should we handle stdout output validation in wrappers?**
   - *TL Recommendation*: Ensure thin wrappers forward stdout/stderr verbatim, matching standard exit codes (0 = pass, 1 = check fail, 2 = usage error).
2. **Do we want to rename the files to `.js` and update all imports, or keep the `.sh` extensions with wrappers?**
   - *TL Recommendation*: Keep thin `.sh` wrappers at the original paths, but locate the real logic in `.js` siblings. This prevents breaking third-party platforms or custom hooks that expect Bash scripts.

---

## Review log

* **R0**: Author (Tech Lead) proposal. Ready for user feedback.
* **R1 (2026-06-24)**: Dialectic loop review converged (Thesis vs. Antithesis → Synthesis).
  - **Round 1 (Thesis vs. Antithesis)**:
    - *Locking Blindspot*: A mix of Bash `flock` (OS advisory file descriptor lock) and Node `'wx'` (namespace-based lockfile) is blind to each other, creating race conditions. Stale locks from crashed processes cause permanent deadlocks.
    - *Startup Latency*: Node startup overhead (~30-50ms) compounds on tight telemetry loops.
    - *JSON Extraction*: Standard string slices are fragile compared to Python's `raw_decode` for extracting JSON from noisy LLM outputs.
    - *Cascading Failures*: Telemetry failures should not block critical developer workflows.
  - **Round 1 Synthesis**:
    - Build self-healing file locking using PID and timestamp verification to detect and recover from deadlocks.
    - Differentiate Fail-Closed (Critical Path: `check-node-report.js`, `tree.js`) from Fail-Open (Non-Critical Path: `risk-counter.js`, `session-start.js`, `toggle-payload-capture.js`).
    - Write a custom robust balanced-bracket JSON scanner in JS.
  - **Round 2 (Thesis vs. Antithesis)**:
    - *Windows Portability*: `process.kill(pid, 0)` behaves differently across OSes.
    - *Clock Drift*: Timestamp checks on lockfiles can fail due to system clock adjustments.
    - *Regex Parity*: RegEx translations in `doc-drift-gate` might introduce silent drift.
  - **Round 2 Synthesis**:
    - Wrap process checks in platform-specific logic and fall back safely.
    - Cap the lock TTL at 10 seconds.
    - Verify regex parity with explicit test patterns in `doc-drift-gate.test.js`.
* **R2/R3 (2026-06-24)**: Dialectic review via Codex GPT-5.5 (thinking = xhigh).
  - **Round 3 (Thesis vs. Antithesis)**:
    - *Lock Metadata*: PID-only ownership is vulnerable across different hosts or directories in multi-agent environments. Lock data needs detailed context (hostname, cwd, token).
    - *OS Process Probing*: `process.kill(pid, 0)` behavior throws `EPERM` on Windows/Unix if permission restricts signaling, which shouldn't be misread as stale.
    - *Lock Recovery Race*: Naive stale check unlinking is prone to race conditions if two processes try to recover the lock at the same time.
    - *Binary Corruption*: Blanket CRLF replacement can corrupt non-text files (images, zip, PDFs) in the repository.
    - *Console/Quarantine logging*: Silent stale-lock deletion hides concurrency defects.
  - **Round 3 Synthesis**:
    - Expand lock JSON metadata to include `hostname`, `cwd`, and a random `token` UUID.
    - Wrap `isProcessAlive` to safely treat `EPERM` as "process is alive."
    - Require extension/UTF-8 guards for CRLF normalization.
    - Output warnings and quarantine corrupted locks instead of silent deletion.
    - Standardize text output to canonical LF; avoid `os.EOL` to prevent CRLF injection on Windows.
