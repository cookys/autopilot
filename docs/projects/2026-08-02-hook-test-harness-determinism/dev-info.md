# Developer info — hook test harness determinism

- Target branch: `develop`
- Feature branch: `fix/hook-test-harness-determinism-l4`
- Size: L (grouped Fix batch)
- Compatibility: internal-only
- Dependencies: platform/stdlib only
- Production paths: explicitly forbidden
- Foreman: reuse `/root/backlog_convergence_foreman` transcript
- Verification authority: independent depth-0 reviewer, not the implementer/foreman
- Integration: depth-0 locally merged the verified candidate to `develop`; no push or publication

## Base evidence

- Host: load average approximately 49 on 32 CPUs.
- `bash hooks/tests/dispatch-output-quiescence.test.sh`: 16 passed, 3 failed; current
  reproduction elapsed witnesses `9>5`, `10>5`, `9>6`, with semantic exit/status
  assertions green (the frozen earlier witness was `9/11/10`).
- `timeout 3s bash hooks/tests/session-start.test.sh < <(sleep 30)`: exit `124` after
  3 seconds.

## Candidate evidence

- Quiescence focused green: `PASS [dispatch-output-quiescence] 22 assertions` at timing
  factor 1 under the same saturated host.
- Semantic timing control: ordinary empty/immediate/multi-KB paths each consumed 4 logical
  250 ms polls; planted `AUTOPILOT_STABLE_POLLS=8` consumed 8 and failed the same `<=4`
  predicate as required.
- Held-open stdin green: exact bounded command exited `0` with
  `PASS [session-start] 18 assertions`; timeout exit `124` is asserted as failure.
- Full suite: `AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh` passed all 260 files.
- First-pass verifier: `repair_blind_verifier` (`Lagrange`) returned one lifecycle-only Major,
  `HTHD-001`; R1–R7 passed and no code/test finding remained. Tracker wording was repaired
  to consistently record a completed L4 candidate with depth-0-owned integration.
- Authoritative final QC: GPT-5.5/Codex, Gemini 3.6 Flash (High)/agy, and Claude Sonnet
  4.6/agy each returned parser-valid `SHIP-AS-IS` with no finding. Claude Opus was unavailable
  to the logged-in account and Claude Fable hit the account's weekly limit; neither attempt
  was counted as a panel seat.
- Depth-0 rerun: quiescence `22` assertions, held-open-stdin session-start `18` assertions,
  28/28 skill validation, and all deterministic sync/version/hook-inventory gates passed.
- Merge state: locally integrated to `develop`; no push, release, PR, or publication.

## Required commands

```bash
bash hooks/tests/dispatch-output-quiescence.test.sh
bash hooks/tests/session-start.test.sh
AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh
bash scripts/validate.sh
node scripts/sync-version.js --check
node scripts/check-hook-inventory.js --check
bash scripts/sync-all.sh --check
```
