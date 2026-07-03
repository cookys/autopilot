# Probe Playbook — diagnostic probes indexed by symptom (L1)

Part of the quality-floor engine ([design](../docs/plans/2026-07-04-quality-floor-engine.md) §4.1).
When a run hits a symptom below, the orchestrator MATCHES an entry and runs its probe —
it does not invent a diagnosis. Every entry has four mandatory fields; the last two are the
**discriminating check**: if the probe's output matches *expected-if-NOT-match*, this entry
does not apply — try another entry or escalate.

**Hard rules**
- Probes must emit output a branch rule can parse exactly. "The command ran" is never evidence.
- **No matching entry ⇒ mandatory L4 escalation** (emit an `escalation_opened` tree event,
  quality-floor convention). Inventing a novel probe silently is forbidden; a novel probe that
  RESOLVES an escalation must be added here (growth rule below).
- Probes are executed by the orchestrator itself (artifact-not-self-report applies to probes:
  a dispatched engine's claim that it ran a probe is not a probe).

## Entries

### P1 — works-with-stubs, fails-with-the-real-engine
- **Symptom**: a parser/protocol/rail passes its stub-based test suite but misbehaves the
  first time the real engine runs through it.
- **Probe**: run the real engine ONCE with a trivial input, capturing stdout and stderr to
  SEPARATE files (`cmd > out.txt 2> err.txt`); `wc -l` both; diff their content against what
  the stub emits.
- **Expected if match**: the real engine's channel layout differs from the stub's (content on
  the other channel, extra chrome, duplicated payload).
- **Expected if NOT match**: channel layouts identical → the defect is in the changed code,
  not the engine contract; go to P4 (dump the parse input).
- **Incident**: v2.31.10 — codex exec puts the message on stdout and ALL chrome on stderr;
  `2>&1` capture broke the nonce parser on every real review while 107 stub assertions stayed
  green.

### P2 — tool behaves differently under the engine/harness than in an interactive shell
- **Symptom**: a CLI invocation works when typed in a shell but fails (or takes another code
  path) when spawned by a wrapper, engine, or hook.
- **Probe**: from INSIDE the spawned context (add a temporary wrapper line or a debug unit),
  log `command -v <tool>` and `<tool> --version`; compare against the interactive shell's.
- **Expected if match**: different path or version (PATH ordering, nvm/npm shims, stale
  global installs).
- **Expected if NOT match**: identical binary+version → suspect env/cwd/stdio, go to P7.
- **Incident**: v2.30.2 — the engine under nvm's node resolved a stale npm-global codex
  0.130.0 lacking a required flag; the shell resolved 0.142.2. Misclassified for a full
  session as a spawn-layer defect.

### P3 — intermittent empty output from a dispatched process
- **Symptom**: a runner's capture file is empty at check time; the run is classified
  empty/failed, but reruns sometimes succeed.
- **Probe**: re-read the SAME capture file after a delay (seconds to minutes) without
  rerunning; record byte counts at T0 and T+delay.
- **Expected if match**: the file has content later → late flush from a detached child;
  a bounded settle-wait (or a longer one) is the fix, and the content is harvestable.
- **Expected if NOT match**: still empty later → genuinely empty; treat as an engine-side
  failure (quota/silent-refusal), record a capability event, fail closed.
- **Incident**: v2.31.10 — grok wrote a 158-line answer AFTER the dispatcher's emptiness
  check (settle-wait shipped); MiniMax-M3 via cc-shim later exceeded even the 3s bound (the
  17KB critique was harvested minutes later); grok-build separately produced genuinely-empty
  output on large prompts (both cases distinguished by exactly this probe).

### P4 — parser rejects output that "looks valid" in the log
- **Symptom**: a fail-closed parser reports no-verdict/malformed, but eyeballing the captured
  log shows a plausible payload.
- **Probe**: dump the EXACT bytes the parser consumed (its input file/stream, not the
  human-facing log): `head -c 400 <parse-input> | od -c | head -20` — inspect for leading
  chrome, BOM/CR, duplicated blocks, or a missing terminator.
- **Expected if match**: parse input ≠ the payload you eyeballed (wrong channel/file, extra
  prefix, missing END line).
- **Expected if NOT match**: parse input is byte-clean → the parser rule itself is wrong;
  minimal-repro the rule with a here-doc fixture.
- **Incident**: v2.31.10 — two distinct hits: merged stderr chrome ahead of the nonce marker,
  and a model omitting the closing END marker at low effort because the prompt never demanded
  it.

### P5 — a test/gate passes, suspiciously
- **Symptom**: a gate goes green on the first try, or stays green when intuition says the
  change should have tripped it.
- **Probe**: perturbation — inject the exact defect class the gate guards (break the seeded
  invariant, plant the bug, remove the guarded line) and rerun the gate.
- **Expected if match**: gate stays GREEN under the injected defect → the gate is vacuous;
  fix the gate before trusting anything it passed.
- **Expected if NOT match**: gate goes red on injection (and green after revert) → the gate
  discriminates; the pass is trustworthy.
- **Incident**: 2026-06-26 `delegate-selftest-false-green` (a delegated implementer's own
  green ≠ criterion met) — the entire `check-test-integrity` program exists because of this
  class; v2.31.10 used perturbation to validate the new canonical-invariant seeds.

### P6 — config/setting appears not to apply
- **Symptom**: behavior doesn't change after editing a config; or behavior differs across
  machines/repos with "the same" config.
- **Probe**: print the RESOLVED config and its source layer via the owning resolver
  (`resolve-review-loop.sh`, `resolve-endpoint.sh --list`, `autopilot endpoints which`, …) —
  never infer from the file you edited.
- **Expected if match**: resolver shows another layer winning (env override, repo overlay,
  template default) or the edited file not in the resolution chain.
- **Expected if NOT match**: resolver shows your value → the consumer ignores that field;
  grep the consumer for the field name.
- **Incident**: the endpoints by-user/by-repo layering and `REVIEW_LOOP_CONFIG_OVERRIDE`
  both exist precisely because "which config won?" was repeatedly mis-guessed; v2.31.10's
  implementer failover was executed through this probe (resolver-confirm before dispatch).

### P7 — env var / stdin not reaching a child process
- **Symptom**: a child behaves as if a variable or stdin payload wasn't set, though the
  caller "sets" it.
- **Probe**: make the child print its own view: `env | grep <VAR>` (or `fs.readFileSync(0)`
  echo) INSIDE the child; simultaneously check the caller's construction for the classic
  scoping traps (`VAR=x cd dir && cmd` scopes VAR to `cd`; `export` inside `$(...)` is fine
  for processes started in that substitution but lost outside it; sourcing defines functions
  but may not RUN the loader).
- **Expected if match**: child's view lacks the value → fix the plumbing at the caller.
- **Expected if NOT match**: child sees the value → the child's own handling is at fault.
- **Incident**: v2.31.10 — `STUB_MODE=pass cd "$SBX" && "$SCRIPT"` applied the mode to `cd`
  only (every negative test silently ran the happy path); same session, sourcing
  `load-endpoints-env.sh` without calling `autopilot_load_endpoints_env` loaded nothing.

### P8 — flaky/failing test: mine or pre-existing?
- **Symptom**: a gate/test fails on the working branch; unclear whether the change introduced
  it.
- **Probe**: run the SAME test at the branch's base (fresh worktree: `git worktree add <tmp>
  <base>`), or use `scripts/verify-preexisting.sh`.
- **Expected if match**: fails at base too → PRE_EXISTING; classify, record, don't block the
  unrelated ship (but never silently — BACKLOG with a trigger).
- **Expected if NOT match**: green at base → INTRODUCED; it's yours, fix before merge.
- **Incident**: v2.31.10 — 4 suite failures split exactly this way (3 pre-existing, 1
  introduced by a new invariant seed); both wrong guesses would have been expensive.

## Growth rule
Every L4 escalation that was resolved by a probe NOT in this catalog MUST add an entry —
with all four fields, an incident citation, and at least one counterexample check (show one
nearby symptom the new entry must NOT match) so the catalog doesn't overfit yesterday's bug.
`skills/learn` / `skills/distill` own the capture path; `harness-maintenance` owns refreshing
platform-dependent entries (P1/P2/P3 cite engine behaviors that drift with CLI versions).
