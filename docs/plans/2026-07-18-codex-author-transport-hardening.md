# Codex author transport hardening (D0-T v4.1 Track A)

**Date**: 2026-07-18  
**Status**: In progress — implementation authority granted; Track B remains locked  
**Target**: v2.32.54  
**Branch**: `feat/v2.32.54-author-transport-hardening`  
**Fresh base**: `661ac1399b33a61bfb624fa694af192db22cd5b2`

## Background

Mnemos D0-R's prior fixed 30-minute OpenAI verification-author process ended with
exit 124 and an empty captured stdout. A same-tuple diagnostic canary later proved
that Codex emits its final answer on stdout, emits CLI chrome on stderr, and can
write the last assistant message to `--output-last-message`. The immutable v4.1
proposal therefore makes stdout the sole candidate authority and uses the sidecar
only as an exit-0 integrity witness.

The process design was independently accepted by fresh OpenAI, Anthropic, and
Google reviewers (`3/3 SHIP-AS-IS`) before implementation authority was granted.
The implementation target then advanced from the reviewed source snapshot
`edad7025486ad196d1124785794c39ff86e092b2` to current `develop`
`661ac1399b33a61bfb624fa694af192db22cd5b2`. The newer source added strict unit
contracts, a direct Anthropic-compatible author rail, identity containment, and
other dispatch changes. P0 must reconcile that drift before product edits; the
approved transport invariants do not weaken.

Authoritative design artifacts:

- `/tmp/mnemos-p2d-d0t-v4.1-transport-proposal.md` — SHA256
  `35a818cea4e22f4c0ee1a705418bf39c6fd106af7c5bb59096dad33a3edbd2b9`
- `/tmp/mnemos-p2d-d0t-v4.1-design-risk-closure-audit.md` — SHA256
  `23d2568ac71f3d86bc4b3809e6fc53206fe7d15d793ca213405ec5c058369adc`
- `/tmp/mnemos-p2d-d0t-v4.1-three-family-panel-report.md` — SHA256
  `64add056da921d12b7f5a0a690f69d33853bbd7f0b3a7c3deae7ab6e0938a916`

## Goal

Harden the Codex branch of `dispatch-author.sh` so a successful author result is
possible only after exit-first process-tree classification and exact stdout/sidecar
witness verification, while preserving strict-roster, strict-contract, result
consumer, and non-Codex behavior.

## Design decisions

1. **Stdout is the only content authority.** The sidecar is required on Codex exit
   0, compared byte-for-byte, and never substituted or parsed.
2. **Process truth precedes content truth.** Deadline, signal, nonzero exit, exit
   124, incomplete reap, and uncertain process-tree state reject every channel
   before content checks.
3. **Only two witness relations pass.** `stdout == sidecar`, or stdout equals the
   sidecar plus exactly one final LF byte. No other normalization is allowed.
4. **Artifacts are private and dispatcher-owned.** Per-run directory mode 0700;
   new regular files mode 0600; exclusive/no-follow creation and owner/link checks;
   no caller-controlled output paths.
5. **Stderr is sensitive metadata input, not content.** It remains separate. The
   session ID can be extracted only from one fixture-pinned `session id:` line in
   the unique initial pre-echo Codex chrome frame.
6. **Deadline cleanup is not author time.** A deadline becomes terminal before
   signalling; TERM then KILL reaps the complete process tree within a fixed
   10-second cleanup budget. Bytes written during cleanup cannot recover success.
7. **Compatibility is a gate.** Strict roster, strict contract, detach/result
   consumers, and every non-Codex runner retain their existing behavior.
8. **Generated and installed copies are evidence, not edit targets.** Edit canonical
   source, regenerate the Codex payload, reinstall through the supported source
   flow, and prove all three dispatcher hashes equal.

## Scope completeness audit (L-1.5)

| Dimension | In scope / decision |
|---|---|
| Source code + tests | Yes — canonical `scripts/dispatch-author.sh`; direct helper only if required for testable process control; deterministic author transport fixtures. |
| User-facing docs | Yes — script contract/header, transport reference if its public result/provenance contract changes, project record. |
| API / interface reference | Yes — additive result/provenance/error fields must be documented; existing status consumers must remain compatible. |
| Config templates / examples | No schema change. Caller output paths, JSONL, resume, and progress-extension knobs remain prohibited. |
| CHANGELOG | Yes — v2.32.54 hardening and rollback entry. |
| Version bump | Yes — shipped script behavior changes, therefore PATCH. Use `sync-version.js`; do not hand-edit mirrors. |
| Version sync verification | Yes — enumerate every tracked `2.32.53` occurrence before bump and run canonical sync checks afterward. |
| Migration notes | No breaking migration. New Codex checks are fail-closed and internal; document operational failure classes in the release note. |
| Dependent consumers | Yes — engine/result readers, detach path, strict-contract fields, strict-roster fields, Codex packaged payload, installed Codex cache. |
| Credit / attribution | No external OSS or third-party design is absorbed. The source is the internally reviewed Mnemos v4.1 process design. |
| Dogfood target | Yes — current Codex installation, supported reinstall, fresh identity/path resolution, three-way SHA proof. |
| Security / privacy | Yes — permissions, symlink/hardlink/path collision attacks, stderr separation, metadata allowlist, redaction and retention. |
| Process lifecycle | Yes — exit-first ordering, signal/deadline classification, TERM-ignoring child/grandchild reap, no late-flush recovery. |

## Explicit scope boundary

In scope:

- Codex author transport capture, exit/reap classification, witness validation,
  private artifact metadata, narrow session-ID extraction, tests, package sync,
  release metadata, supported reinstall, and hash proof.
- A one-time, explicit onboarding spike for the exact user-authorized
  `codex/gpt-5.6-soul` implementer bundle. Its evidence remains role-scoped and
  does not auto-promote the model.

Out of scope:

- Any Mnemos product/config/ledger mutation.
- Track B activation or any OpenAI D0-R verification-author attempt.
- Changing the frozen future author tuple, prompt, family separation, red oracle,
  Google implementation lock, or terminal three-family review rules.
- Treating the sidecar, stderr, rollout, session database, or diagnostic canary as
  candidate/oracle content.
- JSONL parsing, sidecar fallback, live rollout parsing, settle/late-flush recovery,
  progress-based deadline extension, 60-minute ladder, retry, resume, or continuation.
- Global automatic routing or scorecard promotion for `gpt-5.6-soul` without the
  role-specific evidence bar.

## User-stated requirements ledger

| User requirement (verbatim) | Mapping |
|---|---|
| `讓 CEO 全委執行吧， /l6 啟用 heto engine 執行 dev-flow , 送多模型聯審。` | L6 session marker; dev-flow L-size tracking; hetero implementation; separate verification authoring; terminal multi-family review. |
| `授權新的 D0-R transport-recovery scope：固定一次 30m strict-roster OpenAI author attempt，重新走三模型聯審，不得換家族或跳過 red oracle。` | The consumed 30m process remains terminal evidence. Track A preserves strict roster/family/red-oracle locks; it does not dispatch another attempt. The later v4.1 Track B envelope is separately authorized or remains locked. |
| `codex 可以派 gpt-5.6-soul ; 授權通過` | Exact model ID gets a fail-closed isolated implementer Stage-0 spike; Track A source/package/install authority is active. No silent `soul` → `sol` substitution. |

## Phases

### P0 — Drift closure and verification contract

- Reconcile current base against v4.1 sections 12.3–12.6.
- Map existing tests to the required matrix and name missing negative controls.
- Spike the exact `gpt-5.6-soul` implementer bundle in an isolated throwaway repo;
  capture resolved identity/version, process result, git artifact, and cleanup.
- Add deterministic RED fixtures before trusting a live transport implementation.

### P1 — Canonical Codex transport implementation

- Implement private run-artifact creation and validation.
- Capture stdout/stderr/last-message separately.
- Add exit-first deadline/signal/tree-reap classification.
- Enforce the exact witness relation and anchored pre-echo session-ID rule.
- Emit metadata-only result/provenance while retaining existing consumer fields.

### P2 — Compatibility, package, and release integration

- Preserve strict-roster/strict-contract and non-Codex behavior.
- Run existing result/error consumer suites.
- Regenerate the Codex payload with the repository sync flow.
- Add v2.32.54 changelog/project/version metadata using canonical version tooling.

### P3 — Independent quality and multi-family review

- Run Bash syntax, unannotated ShellCheck, targeted and full suites, completeness
  and secret scans, package-sync checks, and the quality pipeline.
- Independently author an adversarial verification harness on a family different
  from the implementer, then execute it at Depth 0.
- Run a fresh, mutually blind multi-family code panel; verified Critical or Major,
  timeout, empty/no verdict, or wrong provenance blocks acceptance.

### P4 — Supported reinstall and exact artifact proof

- Run the supported Codex source check/install flow.
- Resolve installed plugin identity/path after install, not from a stale path.
- Prove canonical source SHA == generated package SHA == installed cache SHA.
- If same-version installation cannot establish freshness, use the authorized
  minimal v2.32.54 cachebuster path, rerun all required checks, then reinstall.

### P5 — Finish-flow

- Final goal review, pre-merge review, merge to `develop`, post-merge review,
  project archive, session-end learning, and merged branch cleanup.

## Objective acceptance contract

The change is accepted only when all named commands/tests are green and their
negative controls have first failed against the base implementation:

```bash
bash -n scripts/dispatch-author.sh
shellcheck scripts/dispatch-author.sh
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/dispatch-author-strict-roster.test.sh
bash hooks/tests/dispatch-author-strict-endpoint.test.sh
bash hooks/tests/dispatch-author-session-mode.test.sh
bash hooks/tests/dispatch-author-result-failures.test.sh
bash hooks/tests/dispatch-author-result-provenance.test.sh
bash hooks/tests/dispatch-author-contract.test.sh
bash hooks/tests/dispatch-output-quiescence.test.sh
bash hooks/tests/codex-plugin-package.test.sh
bash hooks/tests/verification-author-resolver.test.sh
bash hooks/tests/run.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/sync-version.js --check
```

Additional mandatory fixture outcomes:

- exact and stdout-plus-one-LF witness pass;
- empty/missing/mismatched/inverse-LF sidecars fail;
- stderr-only/sidecar-only markers never become content;
- nonzero/124/signal/deadline with complete-looking partials fail before parsing;
- missing/duplicate/malformed/out-of-frame/prompt-injected session IDs fail;
- run dir/files prove 0700/0600, regular, owner-correct, link-count one;
- symlink/hardlink/reused-path/path-injection attempts fail;
- TERM-ignoring child and grandchild are KILLed and no descendant remains;
- result/ledger metadata contain no prompt, reasoning, command, tool output,
  stdout, stderr, sidecar, or rollout bodies;
- strict-roster, strict-contract, existing result/error consumers, and non-Codex
  runners preserve their current observable contract.

Installation acceptance additionally requires a fresh installed-path resolution and
one manifest showing the source base/commit/tree, package/version/marketplace identity,
install command/result, absolute installed dispatcher path, and equal SHA256 values.

## Risks and mitigations

- **Source drift after design review** — close with a line-by-line drift audit and
  fresh implementation review; do not assume the old source snapshot.
- **Process-group false confidence** — use a deterministic child/grandchild fixture
  and verify absence after reap, not only a parent exit code.
- **Content recovered from the wrong channel** — tests plant complete marker text in
  every rejected channel and assert it never reaches candidate parsing.
- **Private artifact path attacks** — dispatcher owns all paths; exclusive creation
  and pre/post inode checks fail closed.
- **Consumer breakage from richer result JSON** — preserve current top-level fields
  and exercise every current consumer suite.
- **Stale installed cache** — supported reinstall plus fresh path discovery and
  three-way hash equality; a successful command alone is not evidence.
- **New model alias ambiguity** — probe the exact `gpt-5.6-soul` ID and stop on any
  mismatch; never reinterpret it as existing `gpt-5.6-sol`.

## Review history

- v4.1 process design: fresh OpenAI/Anthropic/Google `3/3 SHIP-AS-IS`.
- Current-source drift audit: complete against fresh base `661ac139`. The base is
  not v4.1-compliant: its Codex branch has no internal
  `--output-last-message` witness, still treats post-exit output quiescence as a
  recoverable success path, has no deadline-first whole-tree TERM/KILL/reap
  proof, does not own private 0700/0600 artifacts, does not anchor the initial
  pre-echo `session id:` frame, and emits insufficient transport provenance.
  These are the P0 RED targets; no source behavior was assumed from the stale
  reviewed snapshot.
- Current L6 drift: `--strict-contract` now supersedes `--strict-roster` for
  verification authoring while the session marker is active, but the frozen
  future D0-R Track B invocation names `--strict-roster`. Track A will harden
  the shared Codex transport beneath both entry modes and will not weaken the
  contract gate. Choosing Track B's eventual entry mode remains an explicit
  activation decision after Track A; it is not silently resolved here.
- Exact `gpt-5.6-soul` implementer Stage-0: failed closed at G0/G1/G2. Codex
  0.144.4 resolved the requested literal model but the provider returned HTTP 400
  (`not supported when using Codex with a ChatGPT account`); no file changed, no
  commit was created, and the kept worktree/branch were reaped. No retry or
  `gpt-5.6-sol` substitution is authorized.
- Implementation code panel: pending P3.
