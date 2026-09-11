# autopilot — BACKLOG

Trigger-conditioned future work. Each entry must have:
- **Trigger**：what must be true / observed before this fires
- **Context**：one-line problem statement
- **Effort**：S / Fix / L estimate
- **Source**：commit / review-round / retro that surfaced it

Entries without a trigger are rejected (per `skills/quality-pipeline/references/code-review.md` backlog spec).
`next time touching X`／`下次修改 X` is not a valid deferral trigger: it describes known debt, so
admit it to a bounded plan immediately. Valid conditional triggers require external capability,
observed evidence/incident thresholds, a new consumer, or an explicitly expanded threat model.

**Discovery**: when starting any work, `grep <topic>` here. Plan-doc-as-roadmap (`docs/plans/2026-05-14-retro-roundup.md`) post-archive 後遷移 entries 也都歸這裡。

## Audit snapshot（2026-08-28，post lifecycle-hygiene sweep）

- **65 real entries**：2 個 Board decisions、63 個 trigger 尚未成立的 conditional work；`<Topic title>` 範例不計入。
- Platform capability trigger activation 的 D1 closed claims、D2 agy structured usage、D3 Codex production recovery 與 D4 strict-L5 trust root 已由 depth 0 驗證完成，依 lifecycle hygiene 從 backlog 刪除而非保留完成態條目。
- 14 個 technical gaps（A01–A14）已由 [`next-touch-debt-retirement`](projects/_archive/2026-08-03-next-touch-debt-retirement/README.md) D1–D8 核銷並自本檔刪除。
- 14 個 struck-through RESOLVED/SHIPPED entries（2026-08-18 至 2026-08-27 累積）依同一 lifecycle hygiene 規則從本檔刪除（history 留在 CHANGELOG／git）；一個混合條目（`Contract-first escalation and local-repair gates`）因 class (a) 仍未出貨而保留。
- 63 個 conditional entries 主要是四類：等待仍未出現的外部平台／runner contract、等待 telemetry／事故樣本達門檻、等待新 runner／consumer，以及未來擴大 threat model／自動復原範圍才需要的 hardening。

---

### agy `--input-format stream-json` raises the payload ceiling but does NOT remove it — and above it the failure is SILENT
- **Trigger**: the next agy-rail dispatch refused by `agy_argv_ceiling_assert`, or any work that proposes routing `dispatch-review.sh` / `dispatch-hetero.sh` / `dispatch-author.sh` through stream-json.
- **Context**: a peer host (twgs-revival, 2026-09-11) reported that agy 1.2.0's `--input-format stream-json` reads NDJSON from stdin and so bypasses the 131072-byte `MAX_ARG_STRLEN` argv wall, measured at 208951 bytes with `status: SUCCESS`, and suggested the payload ceiling could be removed. **Re-derived on this host (agy 1.2.1) with a trailing-nonce probe — the transport claim holds, the conclusion does not.** Each probe put a unique token at the very END of the payload and asked for it back, so a partial read cannot answer:

| payload | tail token returned | `result.status` |
|---|---|---|
| 49,595 B | yes | SUCCESS |
| 140,047 B (above the argv wall) | yes | SUCCESS |
| 175,145 B | yes | SUCCESS |
| 200,344 B | **no** | SUCCESS |
| 207,103 B | **no** (model volunteered "repeated many times and truncated") | SUCCESS |

- **The finding**: stream-json genuinely buys a real window above the argv wall — 140 KB and 175 KB both deliver intact where argv fails at 131072. But somewhere between **175 KB and 200 KB** the tail stops being readable, and the run still reports `status: SUCCESS` with a fluent answer about the beginning of the payload. The peer's 208,951-byte measurement was above that line; `status: SUCCESS` measured transport, not delivery.
- **Cross-host disagreement, and what it eliminates.** The peer re-ran the tail-nonce design on their host (agy **1.2.0**) and saw the tail returned at 199,976 B, 208,944 B, 249,984 B, 319,980 B and **449,940 B** — no wall at all. Controlled locally afterwards on agy **1.2.1**, using the REAL model id (`agy models` lists `gemini-3.8-flash-high|medium|low`; there is no bare `gemini-3.8-flash`, and the first probes here wrongly passed one with `--effort`):

| local probe (agy 1.2.1, `gemini-3.8-flash-high`) | tail token |
|---|---|
| 175,145 B, repeated-pangram padding | returned |
| 200,344 B, repeated-pangram padding | **not returned** |
| 199,166 B, varied random-word padding | **not returned** |

  So on this host the wall is real and is NOT explained by model alias, effort tier, or padding
  compressibility. The remaining difference against the peer is the **agy version** (1.2.1 vs 1.2.0)
  — a plausible regression, unverified from here.
- **Consequence for the fix, sharpened by the peer**: if the wall moves with the model AND the agy
  version, a constant in a dispatch script is the wrong shape entirely — it would silently regress on
  a roster change or an agy upgrade, both of which happen without anyone touching the rail. The
  threshold belongs **per seat**, measured by the tail-nonce probe during `engine-onboarding` /
  qualification and stored beside the seat's other capability facts, with a re-measure trigger on
  runner-version change (the capability store already tracks `runner_version`).
- **Input difference is eliminated; the wall is a DEPLOYMENT property** (2026-09-11, final exchange).
  The peer supplied a deterministic generator (fixed nonce, fixed padding, exact byte count) so both
  hosts could run byte-identical payloads. Verified: `p175000.ndjson` sha256 `0faa4a59c046…` and
  `p200000.ndjson` sha256 `38ec8965ccf6…` match across hosts, and the agy binary itself is the same
  file on both (`sha256 38f130cdd0757e1d…`). Same bytes, same binary, same model id
  (`gemini-3.8-flash-high`), same probe script:

  | payload | this host | peer host |
  |---|---|---|
  | 175,000 B | tail nonce returned | tail nonce returned |
  | 200,000 B | **not returned, `"response":""`** | tail nonce returned |

  So it is neither the transport, nor the model, nor the runner version, nor the input. What is left
  is the account / plan / region / quota tier the two hosts run under.
- **The failure is worse than truncation: it is an EMPTY response reported as SUCCESS.** Under the
  stricter tail-nonce instruction this host returns `status: SUCCESS` with `response: ""` at 200 KB.
  A reviewer rail consuming that records a seat that "reviewed" and found nothing — indistinguishable
  from a clean review. (An earlier, looser probe instead got a fluent answer about the head of the
  payload, which is the same hazard wearing better clothes.)
- **Consequence for where the threshold lives**: it cannot be a constant in a dispatch script, and it
  cannot live in the scorecard either, because the scorecard is shared across hosts and this varies
  BY HOST at identical seat identity. Either it is measured on the machine and stored machine-locally
  beside the capability store, or — safer — the rail stops trying to predict it and performs the
  tail-nonce self-check itself on any over-threshold payload, turning a silent fail-open into one
  cheap extra probe.
- **`agy --version` is not version evidence** (peer finding, 2026-09-11): the same binary — byte-identical
  sha256, untouched mtime — reported `1.2.0` before `agy update` and `1.2.1` after. The string is
  cached, not read from the binary. Anything pinning a runner version (the capability store tracks
  `runner_version`, and this plan proposes using it as a re-measure trigger) must hash the binary
  instead.
- **RESOLVED: load is eliminated in both directions; the wall is SERVICE-SIDE.** The peer proposed the
  load hypothesis, then killed it with their own measurements: their host was at load 27 (same
  magnitude as this host's 29-30) and still returned the tail nonce at 200 KB, and running agy under
  `systemd-run --scope -p CPUQuota=5%` — starving it far harder than ambient load ever would — also
  returned it. High ambient load: passes. Severe CPU starvation: passes. Combined with this host's
  175 KB probe passing under identical load, a load×size interaction is excluded.
  **Full elimination list**: input (byte-identical payloads, verified by sha256), binary (same file,
  `sha256 38f130cd…`), agy version, model alias, effort tier, padding compressibility, machine load,
  CPU availability. What remains — account / plan / region / server-side quota — is entirely on the
  service side, unobservable from either client.
  **Stop chasing the root cause.** Which of the four it is does not change the engineering: none is
  predictable from a dispatch script, and the tail-nonce self-check is equally effective against all
  of them. The defensible statement is "the wall is a service-side property the client cannot
  predict, with every client-side, input-side and load-side candidate excluded" — NOT "it is the
  account".
- **Superseded note — the earlier load caveat.** The peer asked whether the empty response
  could be a quota/concurrency degradation rather than a stable host property. Checked afterwards:
  load average was 29-30 throughout every probe on this host, from work belonging to OTHER sessions
  (another Claude session's `dispatch-hetero.sh` grok run, plus four ~396%-CPU `las` compute
  processes). Two fresh re-runs of the identical `p200000.ndjson` reproduced `tail_nonce=NO`,
  `response: ""` — but still under that load, so the hypothesis is **not** ruled out.
  Partial control that survives: the 175,000 B probe ran under the SAME load and returned the nonce,
  so load alone does not explain a size-dependent failure — but a load×size interaction cannot be
  excluded without an idle run. **Anyone re-testing should run `p200000.ndjson` on a genuinely idle
  host first.** If it returns the nonce when idle, the wall drifts with load, which kills the
  "measure it once and store it" option entirely and leaves only a per-dispatch self-check.
- **Preferred fix, sharpened by the peer**: do NOT run a separate probe. Stitch an `INTEGRITY:
  <nonce>` line into the tail of the REAL payload and require the reviewer's output contract to
  return it; a missing or wrong nonce is `no_verdict`. That costs zero extra dispatches, and it
  proves the tail of the payload that was actually reviewed rather than a same-sized synthetic stand-in
  — which matters here, since byte-identical inputs already behave differently across hosts. It
  proves the tail arrived, not that the middle was read; the middle is a separate problem.
- **Honest bound**: this probe still does not distinguish transport truncation from model-side
  context/skim behaviour — only that the tail stops being answerable in that band, on this host. The
  operational consequence is the same either way.
- **Why removing the ceiling would be a regression, not a fix**: today an over-size agy prompt fails CLOSED and loudly (execve fails, the rail records `no_verdict`, nobody mistakes it for a review). A silently truncated stream-json prompt fails OPEN: the reviewer reads the first ~175 KB of a diff and returns a confident verdict on the part it saw. A hetero review loop's whole purpose is defeated by a reviewer that cannot tell you it only read half.
- **Reproducer kept in-repo**: [`hooks/fixtures/agy-payload-probe/`](../hooks/fixtures/agy-payload-probe/)
  — the deterministic generator, the runner, the expected payload digests, and the two methodology
  errors the design prevents. It lived in `/tmp` during the investigation; reconstructing it is
  exactly where both hosts went wrong, so it is version-controlled next to the row it supports.
- **Candidate**: keep `agy_argv_ceiling_assert` as a hard gate, add a stream-json transport behind it with its own empirically-derived ceiling (start conservative, e.g. 150 KB), and make the probe above a regression test with the nonce at the tail — never assert on `status` alone. Splitting the unit remains the correct answer above that.
- **Effort**: S (transport + ceiling constant + the nonce regression test); the per-rail wiring is Fix each.
- **Source**: peer report from twgs-revival 2026-09-11, re-derived locally the same day with four probes; `scripts/lib/agy-argv-ceiling.sh`, callers at `dispatch-hetero.sh:2750`, `dispatch-author.sh:728`, `dispatch-review.sh:1398`.

### Pin store hardening: fsync, orphaned temp files, and re-validation of stored rows
- **Trigger**: a report of a `pins.jsonl` lost or corrupted by power loss (not a process kill), a store directory accumulating `.pins.jsonl.tmp.*` litter, or the first consumer that reads the pin store without going through `readPinRows`.
- **Context**: the QC panel (GLM-5.2, 2026-09-11) raised four Suggestion-level items against the v1 pin store, all reproduced at depth 0 and all hardening rather than regressions. (a) `writeSnapshot` does `writeFileSync` → `renameSync` with no `fsync` of the temp file or the directory, so a power loss — not the process-level interruption the spec covers — can still roll the file back; `appendRow` has the same posture, so this is a store-wide question, not a pin-specific one. (b) A SIGKILL inside the write→rename window orphans `.pins.jsonl.tmp.<pid>.<hrtime>`; the `catch → unlinkSync` only cleans thrown errors. Verified: the litter never corrupts `pins.jsonl`, since readers open that path only. (c) `readPinRows` now fails loudly on an unparsable line (v2.36.24) but still does not schema-validate a row it CAN parse, so a hand-edited row with a date in `expires` or a ninth key is read back and persisted through the next snapshot. No CLI input can produce one, and the file is 0600 operator-owned. (d) `listPins` treats `--role ''` as absent and returns everything, matching the existing falsy-option idiom.
- **Effort**: S each; (a) is the only one that changes a shared primitive and should be decided for `jsonl-store.js` as a whole.
- **Source**: depth-0 QC panel on the operator pin store, 2026-09-11.

### Managed campaign intake: a rejected intake sometimes releases the Mission claim and sometimes strands it
- **Trigger**: the next managed `engine implement-review` run that hits `attempt_blocked_by_open_claim` naming a claim from a rejection that already reported failure, or any work on `src/engine/campaign-intake.js`'s rejection paths.
- **Context**: measured 2026-09-11 across five attempts on one lineage. `mission_state_store_required` and `campaign_ledger_path_mismatch` both run `releaseAfterRejection`, so the claim is freed and the next `mission grant` mints a new attempt. `mission_grant_ref_mismatch` does NOT: the claim stays live, and the next grant fails with `attempt_blocked_by_open_claim … is stale for head <sha>`. That message describes the symptom (a stale base) and not the cause (a prior rejection that did not clean up), so the operator's first instinct is to investigate the base rather than the previous rejection. Recovery is `mission withdraw --never-started true`, which works only while the claim never started.
- **Worse case in the same run**: a campaign that reached `prepare_implementation` and then failed internally with `MUTATION_FAILURE_EVIDENCE_REQUIRED` (`src/engine/implementation-campaign.js:926` — the state machine refuses to record its own failure without digest-bound evidence) leaves the claim **active and unwithdrawable**: `withdraw --never-started true` is rejected because the claim did start, and `mission control --action abort_requested` needs a host-injected authenticated control adapter the CLI does not provide. The node is stuck at `status: active` with no CLI exit. This is the same family as the 2026-08-30 "stuck IMPLEMENTING unresumable" row.
- **`awaiting_disposition` is a third state with no CLI exit** (2026-09-11, D4): a campaign whose review returns findings that the `acceptance-bound` policy cannot auto-dispose parks at `awaiting_disposition` with `resumable: true, durable_wait: true`. Supplying a valid `--campaign-disposition-authority` and re-invoking with `--resume` is rejected at `campaign_intake` with `event input artifact must match the prior output artifact`, and `campaign status --campaign-id` returns the same string, so the campaign cannot even be inspected. The ledger is intact (8 rows, all `applied`); the chain check is refusing the resume's own intake event, not reporting corruption. Net effect: a review with any non-exact finding ends the campaign's machine life, exactly like the repair deadlock, and depth-0 takes the branch by hand.
- **The repair deadlock is deterministic, not a one-off** (measured 2026-09-11 on TWO independent lineages, two different deliverables): the FIRST implementation campaign on a lineage runs to `dispatch_implementation: committed`, and the SECOND — the bounded repair after review — blocks at `prepare_implementation` with `MUTATION_FAILURE_EVIDENCE_REQUIRED` every time, leaving a claim that `withdraw --never-started` refuses (it did start) and that `mission control --action abort_requested` cannot reach (it needs a host-injected authenticated control adapter the CLI does not provide). Practical consequence today: **a managed L5 campaign can implement but cannot repair**, so every review-driven repair falls back to a non-hetero implementer and the run stops being a pure L5.
- **A second, cheaper trap in the same flow**: the repair grant must be taken AFTER the implementation is merged, because the contract pins `base_sha` at grant time. Granting first and merging second yields `grant_ref claim base_sha does not match intake base`, costs a withdraw, and is easy to repeat — hit once per deliverable on both lineages.
- **Effort**: S for the release-path consistency; the stuck-active case needs a CLI-reachable abort and is larger.
- **Source**: /l5 dogfood on the operator pin store, 2026-09-11 — D1 (5 attempts, 3 lost to this class) and D2 (3 attempts, repair deadlocked identically).

### PEER-REPORTED (chatgpt-tunnel-host via cuda): a non-Claude foreman rail — and two contract defects that are not really about foremen

- **Trigger**: **FIRED — feature request received 2026-09-12.** Queued behind the 2026-09-12 integration-ledger graph. Before designing the rail, split it (see the ruling below): two of the four root causes are general contract defects that a foreman-specific rail would fix only for foremen.
- **Reported by**: `chatgpt-tunnel-host` (relayed through `cuda`), 2026-09-12. Explicitly a request, explicitly not asking anyone to touch their repo.
- **The ask**: `scripts/dispatch-foreman.sh --runner kimi|claude --model <id> --brief-file <f> --namespace <prefix> --deadline <dur>`. Today `dispatch-hetero` (implement) / `dispatch-review` / `dispatch-author` / `dispatch-explore` exist but a foreman can only be a Claude subagent, so an operator who names `kimi-code/k3-256k` as the `/l5` foreman is reduced to hand-typing `kimi -p "$(cat brief)"`. Their run of one node failed — **and every root cause was in the flow contract, not in the model or the CLI**.
- **Their four root causes, and the depth-0 reading of each**:
  - **(A) output-path collision.** depth-0 and the foreman each dispatched a QC panel writing the same json files, overwriting each other. **This is not a foreman problem** — a Claude foreman collides identically. It is a missing output-namespace contract and should be fixed as one, not inside a new rail.
  - **(B) no exit-file contract.** The brief said "poll"; the foreman never got a termination signal and spun until killed, although the results had long since been written. Their proposed shape — every detached step runs `setsid nohup bash -c '...; echo $? > X.exit'` and the wait condition is "all `.exit` files present" — is right and is **also general**: it belongs to every detached dispatch, not to foremen.
  - **(C) timeout reports nothing.** Deadline should force a partial report. Strengthen it: a partial report must **name which steps did not finish** and carry operands, not only a verdict — otherwise it is indistinguishable from a complete report of an empty run (`references/evidence-discipline.md` §34).
  - **(D) candidate-commit identification.** The wrapper commit subject is `dispatch-hetero(<engine>): edits on ...`, not `feat(...)`. Freeze this convention in the rail instead of letting a model interpret it. Corroborated the same day from the other direction: the 308 report's containment check grepped commit subjects and read six landed lanes as NOT-LANDED.
  - **(E), which they raised in passing and is the highest-priority item here**: `agy` once committed straight to the main branch because a brief told it to commit. Every other item costs time; this one is irreversible. A "no git mutation in the main checkout" boundary check should not wait for the rest of the rail.
- **kimi CLI facts they measured (v0.41.0), recorded verbatim because they are what saves a re-runner time**: `-p/--prompt` cannot be combined with `--auto` or `-y/--yolo` (the CLI errors out), but bare `-p` already executes shell non-interactively; its wait tool caps at 10 minutes per call but reopens automatically with no gap (three consecutive rounds observed), so 20-40 minute nodes are feasible; `--output-format text` hides the commands it actually ran and cannot be audited — use `stream-json`; the default model comes from `~/.kimi-code/config.toml` `default_model`.
- **Note for whoever picks this up**: this repo already ships a kimi runner (`dispatch-hetero.sh --runner kimi`, argv-only with a pre-spend argv-byte gate), so a foreman rail would not start from zero on transport.
- **Effort**: (E) Fix and should jump the queue; (A) and (B) S each and are general contract work; (C) S; the rail itself M once A/B/C exist.
- **Source**: feature request from `chatgpt-tunnel-host` relayed via `cuda`, 2026-09-12. Not reproduced here; their log and brief deliberately not collected yet, to avoid holding stale artifacts. Reply sent the same day; delivery was **durable, not live** (`matched: 0`).

### PEER-REPORTED (7840hs, unverified locally): four dispatch-layer defects, three of them silent

- **Trigger**: **FIRED — reported 2026-09-12.** Queued behind the four deliverables of the 2026-09-12 integration-ledger graph. Reproduce each on this host before designing; the peer's evidence is isolated and credible but lives on their machine. Reported against **v2.36.22**.
- **Reported by**: `cookys-7840hs` (project `llm-playground`), 2026-09-12, framed explicitly as observation. They already fixed what was fixable in their own project config; these four are in the plugin source.
- **(1) `--endpoint @none` is a documented convention that the dispatch layer rejects.** `project-config-template`-style config uses `qc_panel_endpoints: minimax, @none, @none, @none` with the comment "@none = runner uses its own native auth", but `dispatch-author.sh` refuses `--endpoint` for any runner other than `anthropic-compatible` / `cc-shim`: `precondition_failed: "--endpoint applies only to --runner anthropic-compatible or cc-shim (got: codex)"`. Dropping the flag on the same command line gives `status: authored`. `dispatch-plan-review.js` forwards `--deep-endpoint` verbatim (it only skips the literal `default`), so any seat written per the convention dies at transport, twice, as `exit_failure`. Peer prefers fixing `dispatch-author.sh` to treat `@none` as "no endpoint"; **check first whether the resolver already normalises `@none` to `endpoint: null`** (it does on this host — `qc_panel_seats` comes out that way), because then the real break is that the CLI-direct path skips a normalisation the resolver path performs, which moves the fix earlier. This is the "設定介面壞掉" half of the two-layer gate blindness lesson.
- **(2) `check-context-window.js` has no `grok-4.6` row, so `/l5` refuses to start.** `OBSERVED_WINDOWS` carries `grok-4.5=500000` and `grok-build=512000` but not `grok-4.6`, and `engine implement-review` hard-fails `no context window known for model 'grok-4.6'`. Peer's evidence is the table's own declared source, `~/.grok/sessions/*/signals.json .contextWindowTokens`: **n=299 sessions, all 500000**. Add `'grok-4.6': 500000, // n=299` under the table's min-wins rule. Effort: Fix.
- **(3) `plan_review` degrades silently to Claude-reviewing-Claude — the dangerous one.** `resolve-review-loop.sh` emits "plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native" and takes the native fallback for the CHAIR seat **even when the config explicitly declares** `plan_reviewer_engine: MiniMax-M3@anthropic-compatible/minimax` (the deep seat did honour their declared `gpt-5.5@codex`). The failure is invisible because **an empty finding list is indistinguishable from a clean review**. Measured instance: their plan 067 got `READY` with zero findings from the degraded chair; after repairing the deep seat, the same plan drew **3 blocking findings, one of which overturned an entire Phase's premise**. Peer suggests a `capability_warning` plus a `same-family` mark on the receipt. **Consider going further: under `auto`, refuse rather than warn when the only available seat shares depth-0's family** — a warning gets ignored and the cost of this failure is a false premise entering implementation. That is an owner ruling, not a depth-0 one. Same family as `references/evidence-discipline.md` §34.
- **(4) The decorrelation guard has two implementations and only one of them fires.** The resolver correctly refused the peer's config that put `grok` in both the implementer and plan-deep-reviewer seats, on the ground that same vendor + same credential is not decorrelated — a genuinely valuable guard. But it triggers **only when the seat is written into config**: passing `--deep-runner grok` inline on the CLI bypasses it entirely, which is how their 067 plan review silently lost decorrelation. Same shape as the 2026-09-12 session-mode/admission split, where one predicate written twice reached opposite conclusions on one population.
- **A correction the peer volunteered, recorded so nobody chases it**: they had first blamed a seat failure on `~/.codex/config.toml`'s `model_reasoning_effort = "max"` being incompatible with `gpt-5.5`. That is **wrong** — dispatch already passes `-c model_reasoning_effort="<seat effort>"` (`lib/dispatch-author-codex-transport.sh:457`), and an isolated run of codex/gpt-5.5 without an endpoint works. Both seat failures reduce to item (1). The `max` problem only affects a hand-typed `codex exec`.
- **Effort**: (2) Fix; (1) S; (4) S; (3) S for the warning + receipt mark, and an owner ruling before anything stricter.
- **Source**: cross-session report from `cookys-7840hs` via fleet relay, 2026-09-12. Not reproduced on this host. Reply sent the same day; delivery was **durable, not live** (`matched: 0`), so the peer has not necessarily read it.

### PEER-REPORTED (308 dogfood): acceptance records no accepted SHA, so containment cannot be checked mechanically

- **Trigger**: **FIRED — reported with two days of burned measurement behind it, 2026-09-12.** Queue behind the operator-pin plan. P1 first: P2 and P3 both consume it. Reproduce the schema gap locally (it is a file read, not a run) before designing; the 308-side incident itself is the peer's and stays theirs.
- **Reported by**: `308-db`, a Claude session on this machine, against project 308. Explicitly framed as observation, not authorisation, and explicitly with no time pressure — they shipped a project-side guard (`308: tools/containment/check-inputs-landed.sh`, commit `1ce1d3cd`).
- **P1 — no machine-readable accepted SHA.** `schemas/lifecycle-residue-receipt.schema.json` proves RESOURCE disposition (worktrees, branches, `zero_residue`); `schemas/merge-execution-receipt.schema.json` carries `manifest_seal`/`edges`/`status`. Neither records **which commit was accepted and integrated for a unit**. Without it, every downstream containment check has to guess which SHA to ask about — and the peer's incident is exactly that guess going wrong: they ran `merge-base --is-ancestor` against six hands-branch SHAs, got six NOT-LANDED, and committed the conclusion that the work was never merged. Each lane had a *different* accepted commit, all ancestors of HEAD. Their re-check missed it a second time because it grepped commit subjects (`perf(w[1-6])|optimi`) that none of the accepted commits matched. **A mechanical check aimed at the wrong object is worse than no check: it carries authority.** Suggested shape: acceptance/merge-back receipts record the accepted commit plus its source unit/lane id.
- **P1 shape, settled by measurement 2026-09-12**: the accepted commit is **freshly authored**, not derived by git from the hands commit. The peer measured three lanes — `is-ancestor` NO, `patch-id` differs, tree differs, and the file count goes 8→9 / 8→9 / 9→10 — because their SOP integrates with `git diff --binary <base>..<hands> | git apply --index` and re-commits (adopted to dodge a cherry-pick bug that replaced ignored real directories with symlinks). So the receipt records a **pair**, not one SHA: `source_sha` answers "what did this lane produce", `accepted_sha` answers "what is actually in the tree", and neither is derivable from the other — recording only `source_sha` makes every containment check read NOT-LANDED (their exact failure), recording only `accepted_sha` loses the lane's delta, which is **not zero**. Plus a third field, `integration_method` (`merge` / `apply+fresh-commit` / `cherry-pick` / `rebase` / `squash`), because containment semantics follow the method: after `merge`, `is-ancestor(source, target)` SHOULD hold; after `apply+fresh-commit` it is necessarily false **and that is correct**. Without that field P3's assertion cannot tell a normal copy-integration from a forgotten one — which is precisely the ambiguity that produced the wrong conclusion.
- **P2 — no pre-phase "is my input actually in the tree" gate.** There is a campaign contract and a pinned base SHA, but nothing asserts that a phase's declared inputs are ancestors of the integration target. The peer's G1 measurement phase existed solely to measure six lanes and ran for two days without anyone checking the lanes were in the build being measured. Suggested shape: a phase eats `{"inputs":[{"id","sha"}]}` (shas from P1's record) and exits non-zero per failing entry.
- **P3 — no mechanical containment assertion after merge-back.** `level-front-door.md` §4 already says in prose that a cherry-pick copies a commit without making the source an ancestor. Prose did not stop them: they moved a foreman's work with `git diff --binary | git apply --index`, integrated a pre-fix version carrying a regression the foreman later caught on its own branch, and when they went back to integrate the fix git saw no common ancestry and conflicted. Suggested shape: assert the source commit is an ancestor after merge-back; if an apply-style fallback is used, require the source SHA in the commit message, keep a bundle, and forbid deleting the branch before an explicit disposition.
- **(a) residue accounting only sees resources it created.** 308 currently registers 51 worktrees (15 dirty) and 88 branches (65 carrying commits not in HEAD), most created by foremen via `dispatch-hetero` or by hand, none inside the managed leaf lifecycle — so `max_leaf_worktrees_per_root` and `zero_residue` never saw any of them. A repo-level sweep would beat the per-run one. **Dirty worktrees are the urgent half**: a stale branch at least records the work as a commit, while three of theirs hold staged-but-never-committed renderer source that exists nowhere else.
- **(b) the qc-panel seat allowlist fails silently — CONFIRMED HERE, with one correction to the report.** Their specific instance is already fixed: `kimi` and `opencode` ARE on the qc-panel runner allowlist in this repo (`scripts/resolve-review-loop.sh:739`); they read the 2.34.5 plugin cache. **The structural complaint holds and is live**: all three validations in that loop (runner, effort, endpoint) set `QC_PANEL_SEATS_COMPLETE="false"` with **no message at all**, so `qc_panel_seats` empties, `cross_family_satisfied` goes false, and `--enforce` BLOCKs with nothing naming the cause. The plan seat next to it (line 445) exits 3 with an explicit message for the same class of input. Make the panel path as loud.
- **(a) is now preserved, not lost — and the peer is explicit that this was luck.** 2026-09-12 they exported staged/unstaged patches for all 15 dirty worktrees to `308-preserved-worktrees-20260912/` with a manifest (6 non-empty, 440K), then found the content was already in HEAD anyway. Nothing was lost; nothing guaranteed that, and they said so themselves. That is the argument for the repo-level sweep, not against it.
- **Effort**: P1 Fix (schema + writer; three fields, see the shape above), P2 S, P3 S, (a) L and probably its own plan, (b) Fix.
- **Source**: cross-session report from `308-db`, 2026-09-12, after a two-day measurement phase measured a build whose inputs were never verified present.

### PEER-REPORTED (unverified locally): an active l5 marker deadlocks the bounded campaign /l5 itself launched

- **Trigger**: **FIRED — owner authorised 2026-09-12, queued behind the current work.** Start it once the shipped-v2.36.26 admission-bypass fix and D4 have landed (see `docs/HANDOFF.md`); it is the next item after those, not a parallel one. Authorisation covers doing the fix, not skipping the evidence: this row is still a peer's observation with nothing re-derived on this host, so **reproduce locally first** and let the local run — not the report — define the defect being fixed.
- **Reported by**: `openclaw` (hangar-75) via fleet, 2026-09-12, against `develop @ a932ddcc+` with mission mode `off`. Peer's evidence log lives on their host, not here.
- **Claim**: `engine implement-review` with a bounded campaign contract that carries no `mission_runtime`/`strict_dispatch` never passes `--strict-contract`, so `run_campaign_projection_preflight` returns early, `CAMPAIGN_PROJECTION_BOUND` stays 0, and `check_session_mode_gate` (reported at ~`dispatch-hetero.sh:1916`) fails with "active session-mode=l5 requires a sealed campaign strict projection" and `dispatcher_called:false`. v2.34.8 fixed the same class on the ADMISSION side (`session-mode.js campaignCarriesMissionProjection`, consulted by `autopilot-engine.js` and `bin/autopilot.js`) but the dispatcher-side gate was not updated. Net claim: a bounded non-Mission campaign can never dispatch while its own /l5 marker is alive.
- **Peer's proposed fix**: when `--campaign-contract` is given and the contract carries no Mission projection, skip `check_session_mode_gate` on the same predicate the admission side already uses — the contract plus seal is the sealed authority for a bounded campaign. Keep the gate for bare dispatches with no `--campaign-contract`. Add the projection-scope matrix case (bounded campaign + active l5 marker → dispatcher called) to `hooks/tests`.
- **Two side effects the peer saw on the same run**: (a) the `precondition_failed` rejection reports `admission_release.status=released` while the durable state keeps `live_lease`, so the next launch hits `campaign_state_lease_open` and IMPLEMENTING is not a resumable phase — they wiped the ledger by hand; (b) the `verify_cmd` subprocess inherited a PATH without their `bats` install, so `campaign_verification` failed on a tree that passes by hand — a "command not found" arguably belongs in precondition, not verification.
- **Relation to the rows above**: this is the same family as "Two L5 deliverables cannot run on one repo inside 24h" and the `awaiting_disposition` dead end — an active marker, a campaign the marker's own level launched, and no CLI exit. It is a DIFFERENT mechanism from the marker-bridge digest mismatch measured here on 2026-09-11 (that one is `check_marker_campaign_admission_bridge` rejecting a stale digest; this one is the strict-projection gate rejecting a bounded contract), so fixing one does not fix the other. Side effect (a) is the third sighting of "rejection says released, state says held".
- **Repro artifacts for side effect (a)**, named by the peer 2026-09-12 and **held on their host, not here**: `/tmp/claude-1000/-home-cookys-projects-hangar/dde388b7-cbe4-4cd9-b7ac-51a122ba3821/scratchpad/{rollout-campaign.log,autopilot-ledger-bak.*}` — the second JSON result plus the backed-up `.git/autopilot` ledger still carrying `live_lease`. Paths recorded rather than contents; ask them for the files when this row is picked up, and treat them as a peer's artifacts until re-derived locally.
- **Effort**: Fix for the gate predicate; S including the test matrix case. The lease/release inconsistency is the larger of the two side effects.
- **Source**: peer report from openclaw via fleet relay, 2026-09-12. Not reproduced on this host.

### The Mission graph models parallel deliverables that the controller cannot actually run in parallel

- **Trigger**: any graph with two or more independent nodes in one batch, or the next `campaign_intake` rejection reading `canonical Mission state changed between intake and controller persistence`.
- **Measured 2026-09-12**, dispatching the four-node integration-ledger graph (`docs/mission-integration-ledger-execution-graph.json`, digest `dada729c`). The graph legitimately models three independent batch-1 deliverables; `mission grant` issued all three claims without complaint; three `engine implement-review` processes started; **one reached implementation and the other two were rejected at `controller_execution_authority`** with `canonical Mission state changed between intake and controller persistence`, `rounds: 0`. Re-dispatching one of the rejected nodes **alone**, with the same contract and the same surviving claim, passed the same gate immediately. The claims are not lost by this rejection, which is the one mercy here.
- **What this means**: the parallelism the graph expresses is real at planning time and absent at execution time. `max_batches`, `calculated_batches` and independent `dependencies: []` all suggest concurrent execution; the controller's canonical Mission state is a single document that every campaign intake reads and rewrites, so a second campaign starting between another's intake and its persistence loses. Effectively, **deliverables must be dispatched serially**, and nothing in the graph or the grant path says so.
- **Two honest readings, and the row does not pick one**: either the state persistence should be made concurrency-safe (lock + re-read, the way the worktree budget already does with `flock` on `autopilot-worktree-budget.lock`), or the graph should stop modelling something the runtime refuses and `mission grant` should refuse a second concurrent claim on one lineage with a message naming the reason. The current combination is the worst of both: it invites the parallel shape and then fails it at the most expensive possible moment, after the readiness probes and before any work.
- **Related but distinct**: the worktree occupancy cap is NOT the constraint — it is counted per `WORKTREE_ROOT_RUN_ID` (`scripts/dispatch-hetero.sh:2825`), so concurrent campaigns each get their own budget of `max_leaf_worktrees_per_root`. That part of the design is concurrency-ready; the Mission state is not.
- **Effort**: S to make `mission grant` refuse and say why; M for a lock-and-re-read persistence path.
- **Source**: /l5 dogfood on the integration-ledger graph, 2026-09-12 — three concurrent dispatches, one survivor, and a clean serial re-run of a rejected node as the control.

### A campaign's `output_paths` must enumerate every codex mirror, and the rejection arrives after the model has done the work

- **Trigger**: `boundary_rejected: changed path 'platforms/codex/plugin/...' is outside sealed output surface`.
- **Measured 2026-09-12** on the same graph. The `p1-integration-receipt-sha-ledger` node listed `schemas/merge-execution-receipt.schema.json`, `src/merge/cli.js` and `scripts/record-integration.js` in `output_paths`, plus the codex mirror of the new script — but not the mirrors of the schema or of `src/merge/cli.js`. `scripts/sync-codex-plugin-skills.sh` mirrors `bin src profiles schemas evals/clean evals/known-bad hooks/_shared references scripts project-config-template`, and the node's own `verify_cmd` runs `sync-codex-plugin-skills.sh --check`, so the implementer was **required by its verification to touch paths its contract forbade**. It did the work, wrote nine files, and the whole round was discarded at the boundary check.
- **The authoring error is mine, but the shape is a trap worth a mechanism**: a graph author enumerates the files they are thinking about, while the mirror set is a property of the repo. Candidate fix: a graph-check rule that, for every `output_paths` entry under a mirrored root, requires the corresponding `platforms/codex/plugin/` path to be present too — refusing at `mission-execution-graph-check.js` time, which is free, rather than after a paid implementation round.
- **Effort**: Fix for the graph-check rule.
- **Source**: /l5 dogfood, 2026-09-12.

### Two L5 deliverables cannot run on one repo inside 24h: the marker bridge scans every marker and `clear` needs a receipt nothing writes

- **Trigger**: the next managed `engine implement-review` blocked at `precondition_failed` with `marker-to-campaign admission bridge failed: marker Mission mission_graph_digest does not match campaign projection`, or any work on `scripts/dispatch-hetero.sh`'s `check_marker_campaign_admission_bridge` or `session-mode.js` `clear`.
- **Context**: measured 2026-09-11 shipping D3 then starting D4 of the operator-pin plan. `check_marker_campaign_admission_bridge` (`scripts/dispatch-hetero.sh:1265`) iterates **every** file in the session-mode marker directory and hard-fails on any live marker for the same repo whose `mission_graph_digest` differs from the sealed campaign's. Correct as a concurrency guard. But one plan id maps to one graph node, so shipping a deliverable and starting the next necessarily changes the graph digest — and the previous deliverable's marker is still live for 24h.
- **The exit is closed, and not for lack of evidence**: `session-mode.js clear` refuses an l5/l6 marker without `--task-status-receipt` and `--root-run-id`; `status task` reads that receipt from `<TMPDIR>/autopilot-task-status/<root-run-id>.json`; and `grep -rn autopilot-task-status src/ scripts/ bin/` returns exactly **one** hit — `src/status/task-runtime.js:97`, the reader. **Nothing in the repo writes it.** So a completed, merged, pushed campaign has no CLI path to retire its own marker, and the only remaining lever is the 24h TTL.
- **What was done on 2026-09-11 and why it is not a precedent**: the D3 marker was deleted by hand after the owner overruled the standing "let it expire" ruling, on three facts — it was the same physical session's own residue, its campaign was merged and pushed (`dd18c97b` on `origin/develop`), and the sanctioned retirement was blocked by a missing producer rather than by missing evidence. A backup was kept. This is gate-input deletion and stays wrong as a habit; it is recorded so the next session reaches for the mechanism instead.
- **Mechanism fix**: a `session-mode.js retire --root-run-id <id>` verb that re-derives completion instead of trusting a receipt — the campaign's `observed_head` is an ancestor of the integration branch, its journal receipts resolve, and residue is zero. That is independent re-derivation, so it satisfies ADR-0001; a written attestation would not.
- **Effort**: S for the `retire` verb; Fix if the decision is instead to make some existing rail write the task-status input bundle.
- **Source**: /l5 dogfood on the operator pin plan, 2026-09-11 — D4 blocked three attempts (`AUTOPILOT_ROOT_RUN_ID` missing, then `mission_grant_ref_released`, then the bridge) before this was isolated.

### The implementer ladder's cost ordering is nearly degenerate — 11 of 17 rungs share one effort tier
- **Trigger**: the next time a climb picks a seat whose price is wildly out of line with the rung below it, or any work that wants the ladder to mean "cheaper first" in dollars rather than in label order.
- **Context**: measured on this host 2026-09-08 (`~/.autopilot/topology.json`, 17 rungs): indices 5–16 are ALL `high`, so within that region the ordering falls through to `latency.sample_wall_time_s` then engine name. `claude-opus-5` and `MiniMax-M3` therefore sort as the same cost tier despite very different real prices, and a climb inside that region changes only the model, never the effort. `scripts/resolve-dispatch-topology.js:5-11` is honest that this is a proxy ("Cheapest-first — there is no reliable price data; effort rank"), but a key that puts two thirds of the rows in one bucket has stopped discriminating regardless of whether its semantics are right. This is a SECOND, more mundane problem than the cross-vendor incomparability fixed in v2.36.20: that one was about the label meaning different things per vendor, this one is about the label barely varying at all.
- **The cost field is worse than empty — it is zero.** Measured 2026-09-08 across `~/.autopilot/engine-scorecard/scorecard.jsonl` (66 rows): 47 carry `cost: {source: "unknown", usd_per_mtok_input: 0, usd_per_mtok_output: 0}`, 9 carry the same `source` with `null`, and 10 have no cost block. **All 17 current ladder rungs are in the zero group.** `source: unknown` is honest, but pairing it with `0` is a footgun with a specific shape: a consumer that guards on `value != null` passes, arithmetic silently succeeds, and every seat ties at free — so an ordering built on it would look like it worked and would in fact be ordering by the tiebreak. The correct encoding for an unknown price is `null` or absence; any consumer must gate on `cost.source`, never on the number.
- **Candidate**: fix the encoding first (unknown price ⇒ `null`, and one accessor that refuses to return a number when `source === 'unknown'`), THEN decide whether to order on it. `latency.sample_wall_time_s` IS genuinely populated and is the only real per-seat signal available today. Do NOT hand-write a price table — same failure shape as a hand-maintained effort translation table (`scripts/lib/effort-scale.js` header, and `scripts/lib/grok-effort.sh`'s month-long stale-clamp scar).
- **Effort**: S for the zero-vs-null encoding fix alone; M if the ordering change follows (the v2.36.20 KR tests must keep holding)
- **Source**: v2.36.20 follow-up, 2026-09-08; the adjacency rule shipped, this is the ordering key underneath it

### `probe-unknown.js classify` spawns `resolve-review-loop.sh` up to seven times per call — memoize one resolver invocation
- **Trigger**: a foreman round-end ledger or `cost-tracker` sample showing `probe-unknown.js classify` taking ≥ 10 s wall time, or a round that runs classify ≥ 3 times (each resolver spawn is a full config + topology resolution with a 15 s timeout).
- **Context**: v2.36.15 P1/P2 read `unknown_escalation`, the three budgets, `consult_dispatch`, `consult_resolved_from` and `unknown_resolved_from` through separate `resolve-review-loop.sh --field` calls (`scripts/probe-unknown.js` resolverField). The resolver already emits all seven in one JSON; one `resolve-review-loop.sh` run parsed once would replace them. Correctness is unaffected (every call site pins the flags in tests); this is cost only. Raised by the pre-merge reviewer (delta pass 3) as CUT/FOLLOW-UP.
- **Effort**: S
- **Source**: pre-merge review of `feat/v2.36.15-unknown-escalation-ladder`, 2026-09-07.

### kimi reviewer rail: file-indirection for prompts above the argv wall (needs a live kimi credential to probe)
- **Trigger**: a host with a working `kimi login` (this host's managed:kimi-code OAuth has no credential as of 2026-09-07, so the probe could not run), or Kimi Code CLI shipping `--prompt-file` / stdin prompt input (0.39.1 has neither: `-p ''` is rejected, `-p -` is taken literally).
- **Context**: v2.36.14 fails closed pre-spend when the kimi prompt exceeds ~120 KB (Linux MAX_ARG_STRLEN, 308 hit rc=126 on a 145 KB prompt). The unblocking alternative is file indirection: write the prompt into the scratch cwd and pass a short `-p "read ./autopilot-review-prompt.md and follow it"`; kimi is an agent with a read tool, so it should work, but it is UNVERIFIED and changes the trust shape (the model must choose to read the file; a summarising model silently reviews less). Spike: live probe with a nonce inside the file, then a 140 KB real diff; ship only behind the size threshold with the raw log recording the indirection.
- **Effort**: S (probe) + Fix
- **Source**: 308 report 2026-09-07, run review-1788751167-2077044-2d7b.

### Per-hook × per-harness support matrix with verification dates (hook inventory that is periodically re-checked)
- **Trigger**: the next hook that is registered on a second harness (Codex `Stop`/`SessionEnd` for `dirty-protected-paths` is the first, v2.36.11, and its Codex live-fire is unverified), or a `harness-maintenance` run that finds a hook-event claim older than 60 days.
- **Context**: owner question 2026-09-07 「那些 hook 是不是要統一做個盤點表定期 check 所有 harness 是否支援」. Today the facts are split: `references/multi-agent-portability.md` has one "Hook event names" row per harness (prose, last-verified date at file top), `scripts/check-hook-inventory.js` checks Claude wiring vs tiers, `scripts/platform-capability-claims.js` + `harness-maintenance` track harness capability staleness — but nothing joins hook stem × harness × event × evidence date. Shape: `hooks/harness-support.json` (stem → {harness → {event, registered, verified_at, evidence}}), a checker that (i) fails when a wired hook has no row, (ii) warns when `verified_at` is older than N days, (iii) is read by `harness-maintenance`; evidence for a row = a hook-probe run (Codex hook-probe package / Claude test) that shows the event actually fired — a hook existing is not a hook running.
- **Effort**: S (matrix + checker + one probe per harness event)
- **Source**: owner 2026-09-07 during the dirty-tree hook ship; `references/evidence-discipline.md` (script existing ≠ running).

### Codex dev-mode hook entry that survives plugin cache replacement (`~/.codex/hooks.json` → repo path)
- **Trigger**: a second report of `PostCompact MODULE_NOT_FOUND` on a host that ran `dev-setup.sh --harness codex --install` with `--force`, or a Codex release that documents whether hook `command` strings run through a shell (then a self-contained fallback in the command string becomes possible).
- **Context**: v2.36.10 guards the update (refuse under live sessions) but cannot make a live session survive it: Codex pins `PLUGIN_ROOT` to `~/.codex/plugins/cache/…/<version>/`, and both `plugin add` (in-place upgrade) and `plugin remove` delete that directory. The peer proposal is a user-level `~/.codex/hooks.json` PostCompact entry pointing at the repo checkout (stable path), which would duplicate the plugin hook (double fire) unless the plugin-side entry is dropped from the dev install, and would need its own trust review (official hooks doc supports `~/.codex/hooks.json`; nothing says a hook command is shell-interpreted, so no `[ -f … ] || fallback` in the command string). Spike: measure double-fire, decide dev-only vs shipped, verify with the hook-probe package.
- **Effort**: S (spike) + Fix
- **Source**: local Codex session hand-off via agent-call 2026-09-07; `hooks/tests/codex-plugin-package.test.sh` upgrade case.

### Apply two-tier + pooled verdict to reviewer/implementer/owner/verification_author/brain
- **Trigger**: a role's own eval corpus + scorecard-first ON/OFF evidence exists — a frozen, sealed
  case corpus for that role plus an OC characterization against it, produced the same way
  `docs/plans/2026-08-28-consult-discuss-qualification.md` + `docs/plans/2026-08-29-qualification-verdict-stability.md`
  D6 produced one for consult/discuss.
- **Context**: `foldPooledVerdict`, `(VERDICT_Z, VERDICT_TAU)`, and the D3 error-class → tier map
  (`scripts/engine-qualify.js`) are already written role-agnostic — they consume only per-case
  outcomes and a role's tier map — but `reviewer`/`implementer`/`owner`/`verification_author`/`brain`
  keep their existing single-administration verdicts (KR7, `docs/plans/2026-08-29-qualification-verdict-stability.md`).
  Switching any of them without that role's own eval evidence first would repeat exactly the mistake
  this plan corrected for consult/discuss (成績單前置 — CLAUDE.md). See
  `docs/plans/evidence/2026-08-29-verdict-stability/OC-CHARACTERIZATION.md` § "Generalization seam
  (deferred)" for the full reasoning.
- **Effort**: L
- **Source**: `docs/plans/2026-08-29-qualification-verdict-stability.md` D8

### Codex payload install-time generation（2026-08-02 residual spike：NO-GO）
- **Trigger**: Codex 提供受支援的 native plugin lifecycle：在 plugin install **與** Git marketplace upgrade/refetch 兩條適用路徑上，都能於 payload discovery 前自動執行 deterministic generator，且 generator 非零退出會讓外層 install/upgrade fail-loud；或官方提供具同等順序與失敗語意、可由 live CLI 驗證的機制。
- **Context**: codex-cli 0.146.0 的 logged-in `codex exec` 已實證 installed Autopilot cache payload 與 linked support reference 可被讀取，且 audit 結果正確。殘餘 probe 同時反證把 local source 當 Git refresh：generation A 安裝後即使 local fixture 改為 B，`plugin list` 仍為 0.1.0、loader 仍讀 cache generation A，`marketplace upgrade <local>` 以「not configured as a Git marketplace」exit 1；未發布外部 Git fixture，故 Git snapshot refresh 語意維持 `unproven`。帶 `scripts`/`lifecycle` 的 disposable manifest 雖被接受並複製，install 仍成功、exit-17 generator 未執行，四份 installed curated manifests 也無這兩個欄位；native install/upgrade generation lifecycle 為 `fail`。結論維持 committed Codex payload mirrors 與所有 sync/drift gates，不做遷移。
- **Effort**: L（trigger 成立後另立 migration mission）
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）；[`codex-payload-residual-spike`](projects/_archive/2026-08-02-codex-payload-residual-spike/README.md) evidence（2026-08-02）

### Release-time payload branch（B）重啟條件
- **Trigger**: CI 連續數週綠＋真實 tag/release 節奏存在（非每 push 即 shippable）＋ C-Spike 已否決 install-time 路線
- **Context**: Generic push/PR test CI 已存在，但 B 仍需新建 tag→payload publication→push-credential 的 release path；於多 PATCH/日的節奏下，每個 Codex 可見修復多四個失敗點；QA 判 test-signal 時點最差（user install 時才爆）
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）

### 🔵 suite oracle lock: a killed full-suite run leaves the next one refused (observed 2026-09-02)
- **2026-09-04 second instance**: a `kill -9` of a running suite left `.owner` naming a dead pid; the next run was refused although `kill -0` on the holder failed. Workaround used: verify no live `run.sh` then `AUTOPILOT_SUITE_ORACLE_LOCK=0` — which the `suite-oracle-lock` test inherits and fails on, so that file had to be re-run standalone without the env. Trigger stands.

`hooks/tests/run.sh --parallel` refused with `action lock held by run_id=…-2994178-…` while pid
2994178 no longer existed and `/proc/*/fd` showed **no process holding
`/tmp/.autopilot-suite-oracle.lock`**. A later re-run succeeded, so this was contention with a run
that was still finishing rather than a permanently stuck lock — but the refusal message names a dead
pid from the `.owner` sidecar, which is exactly the shape a genuinely stale lock would take, and a
reader cannot tell the two apart from the message. Worth either cross-checking holder liveness
before printing the pid, or saying explicitly that the pid comes from a sidecar that can outlive its
process. Not urgent: the lock itself is flock-based and does release on death.

## Format example

```markdown
### <Topic title>
- **Trigger**: <external or evidence condition; e.g. "after sample N of behavior Y" / "performance degrades below threshold Z">
- **Context**: <one-line problem>
- **Effort**: S | Fix | L (estimate)
- **Source**: <commit SHA / review-round / retro / plan ref>
```

---

## Active entries

### Promote the depth-0 hetero-run watcher to a shipped dispatch-watch script
- **Trigger**: the next `/l4`–`/l6` session that has to wake parked foremen — depth-0 re-armed a scratch script ~40 times in v2.36.0 (report the first run whose `dispatch-status.js` phase flips from running to terminal)
- **Context**: parked foremen are never woken by their own background children; a shipped watcher plus a documented `SendMessage` wake step would replace the hand-rolled loop. Reference copy: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/watch-hetero.sh`
- **Effort**: S (new script ⇒ PATCH; wire in all four places)
- **Source**: v2.36.0 session

### Lint hands diffs for fixture literals leaking into production code
- **Trigger**: next hands cut on a script with a test that names phases/ids (`p7`, `fixture`, `test`)
- **Context**: `references/evidence-discipline.md` §23 — three reviewers caught a `phase === 'p7'` carve-out the suite could not
- **Effort**: S
- **Source**: core review g2, v2.36.0

### check-phase-review-receipt: min-reviewed-seats enforcement test on a multi-seat fixture
- **Trigger**: next touch of the seat-coverage rule
- **Context**: case 14 proves the parse guard, not that a higher minimum is enforced on a 3-seat chain (MiniMax FOLLOW-UP, core review g4)
- **Effort**: S
- **Source**: same g4 dir

### hetero-review-loop: confirm finalize always emits severity in open_findings (checker now requires deep equality on id/severity/disposition)
- **Trigger**: the next FIX-THEN-SHIP receipt with verified Major/Minor findings — depth-0 saw severity present on the v2.36.0 receipts, so this is a confirmation row (GLM FOLLOW-UP, core review g3)
- **Context**: shared-format drift surface between finalize and the checker
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/g3/`

### resolve-review-loop.sh: audit every remaining runner comparison for codex-cli/codex canonicalisation
- **Trigger**: next touch of the reviewer_ladder / hetero_review extraction or any `entry.runner === implRunner` site
- **Context**: normRunner was added at the plan-panel and consult sites; other comparisons may re-admit a dual seat (GLM FOLLOW-UP, core review g3)
- **Effort**: S
- **Source**: same g3 dir

### hetero-review-loop: charset guard on seat ids before path.join
- **Trigger**: any change that lets a seat id come from outside the driver
- **Context**: `../` in an id could escape the generation directory; no capability gained today because the ledger is writer-controlled (GLM FOLLOW-UP, core review g3)
- **Effort**: S
- **Source**: same g3 dir

### check-phase-review-receipt: a head moved only by commits touching allowlisted excluded paths should still validate
- **Trigger**: every release closeout — CHANGELOG/ledger/archive commits land after the last review generation, so the receipt's head never equals the merge head
- **Context**: the checker binds `review_head_sha` to the branch head; today the honest sequence is "checker exit 0 at the reviewed head, recorded in the ledger, then docs-only commits". Candidate: accept a moved head when `git diff <receipt_head>..<head>` touches only paths matched by the frozen exclusion allowlist (plus CHANGELOG.md / INDEX.md), and record that delta in the receipt check output
- **Effort**: S
- **Source**: v2.36.0 closeout, `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/`

### hetero-review-loop / check-phase-review-receipt: hoist EXCLUDE_ALLOWLIST and isPathspecAllowed into scripts/lib
- **Trigger**: the next edit to either copy (they are byte-identical today)
- **Context**: duplicated verbatim in both scripts; a one-sided edit would silently desynchronise the gate (GLM + MiniMax FOLLOW-UP, core review g2, 2026-09-04)
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/g2/`

### review-chain-derive.js documents "no side effects" but mutates the chain entries it receives
- **Trigger**: any caller that keeps a reference to the chain after derivation
- **Context**: either copy on entry or drop the purity claim (GLM FOLLOW-UP, core review g2)
- **Effort**: S
- **Source**: same g2 dir

### check-phase-review-receipt: open_findings comparison ignores severity; reviewed_seats/total_seats not cross-checked against seat artifacts
- **Trigger**: verify after the g2 repairs land whether the deep-equality and seat-coverage fixes already cover both; close the row if so
- **Context**: MiniMax + GLM FOLLOW-UP, core review g2
- **Effort**: S
- **Source**: same g2 dir

### resolve-review-loop.test.sh capability-warning assertion messages still say "no warning" while expecting the topology fallback lines
- **Trigger**: next touch of that test file
- **Context**: wording only; the expectations are correct (GLM CUT, core review g2)
- **Effort**: S
- **Source**: same g2 dir

### `normalize_agy_alias()` rewrites config-side seat names before the qc-exclusion match in `consult_dispatch: auto`
- **Trigger**: a `qc_panel` entry written as an agy alias (e.g. `gemini-flash`) while the topology ladder carries the resolved name — the exclusion set never matches and a qc seat can be picked as the consult seat
- **Context**: found by the D4 hermetic test's first fixture (2026-09-04); the fixture was changed to a non-aliased name, the resolver was not. Fix: normalise both sides (or compare on the resolved tuple) in the exclusion builder
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/D4.md`

### `resolve-review-loop.sh` `auto` knobs read a stale `~/.autopilot/topology.json` and fall back natively
- **Trigger**: a host whose cached topology predates a plugin version that added roles (observed 2026-09-04: cache without `consult_ladder` ⇒ `consult_resolved_from: native-fallback` until `resolve-dispatch-topology.js` was re-run)
- **Context**: the resolver never regenerates the cache; `sync-all.sh` runs `--check` only. Candidate: regenerate when the cache lacks a role key the resolver asks for, or emit a distinct warning naming the stale cache
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/D1.md`

### `contract-parity` / `resolve-review-loop-consult-discuss-switch` tests read the real `~/.autopilot/topology.json`
- **Trigger**: the next time either test goes red on one host and green on another with the same tree (2026-09-07: red on this host for three days because the host cache carried two legacy `effort: ""` rungs; the fix landed in v2.36.16 but the *test* still depends on host state — the consult-seat drift allowance in the switch parity is host-dependent for the same reason)
- **Context**: both tests resolve the shipped template with `implementer_ladder: auto` / `consult_dispatch: auto`, so the resolver reads whatever topology cache the host has. `resolve-review-loop.test.sh` already shows the hermetic pattern (`AUTOPILOT_TOPOLOGY_FILE` pointed at a fixture per case); port it. Related: the stale-cache item above (regenerate-or-warn) would shrink the blast radius but not the test's host dependence
- **Effort**: S
- **Source**: v2.36.16 (2026-09-07), CHANGELOG「未做」

### `hetero-review-loop.js` collect appends to chain.json without a lock or atomic rename
- **Trigger**: two collects for the same phase ever run concurrently (today callers serialise by generation)
- **Context**: a lost chain entry would self-recover on retry, never forge a gate pass; MiniMax CUT/FOLLOW-UP on the D2 review 2026-09-04
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-D2-attempt1-parser-defect/`

### `hetero-review-loop.js` opt-out knob parser character class parses `*->` as a range
- **Trigger**: the next touch of the knob parser in handleOptOut
- **Context**: a line such as "9plan_review: off" can set configured_value; harmless while the checker re-derives the value from the resolver (GLM CUT/FOLLOW-UP)
- **Effort**: S
- **Source**: same ledger dir as above

### `hetero-review-loop.js` exports the STUB_SEAT_ID test seam into the real dispatch-review.sh environment
- **Trigger**: reworking the seat-stub mechanism for any other reason
- **Context**: cosmetic hardening; the real script ignores the variable (GLM CUT/FOLLOW-UP)
- **Effort**: S
- **Source**: same ledger dir as above

### `finalize` closes an earlier verified finding by absence in a later generation
- **Trigger**: a future review-policy deliverable, or evidence that a reviewer missed a still-open finding
- **Context**: the plan defines closure as absence-in-later-findings; tightening to "explicitly re-verified" needs a policy decision (MiniMax CUT/FOLLOW-UP)
- **Effort**: Fix
- **Source**: same ledger dir as above

### Opt-out receipt with a non-existent config path hashes the empty buffer
- **Trigger**: D2-repair R2/R3 does not already require the config path to exist (it is in that brief; verify at closeout)
- **Context**: sha256 of empty matches a receipt claiming the empty-file hash; the resolver's `off` re-derivation is the real boundary (MiniMax CUT/FOLLOW-UP)
- **Effort**: S
- **Source**: same ledger dir as above

### scorecard runner token drift: sol's reviewer row is recorded under `codex-cli`, not `codex`
- **Trigger**: any seat resolver that matches runner tokens exactly (topology `--role plan_reviewer` normalises it today)
- **Context**: a qualified seat silently drops out of auto-derived panels when the recorded runner spelling differs from the dispatch runner enum
- **Effort**: S
- **Source**: `docs/plans/evidence/2026-09-04-dev-flow-hetero-loops-default/context.md`

### ~~Foreman context is not measurable by hook — `context-budget` only sees the parent transcript~~ (CLOSED 2026-09-05, v2.36.1: `subagentStatusLine` `tasks[].tokenCount` is the per-agent usage field; `foreman-guard.js` denies at T2 from the tmpfs live file — `docs/plans/2026-09-05-statusline-live-context-feed.md`)
- **Trigger**: Claude Code's hook payload carries the SUBAGENT's own `transcript_path` (or an equivalent per-agent usage field) — check the CC changelog / a SPIKE on the running version; or a second cost incident where a foreman's context (not its Bash count) is the driver.
- **Context**: v2.35.15 put ironlaw #6 in the loop through `foreman-guard` (Bash cap, polling, Monitor), but the digest's second burn shape — waking after cache TTL and re-writing a ≈900K context — is a CONTEXT ceiling, and `context-budget` deliberately exits on `agent_id` because the payload's `transcript_path` is the parent's. Until the payload identifies the subagent transcript, the Bash cap + 一刀一命 are the foreman's only ceilings. Fix shape: when a per-agent transcript is available, apply T1/T2 to it and make T2 a `deny` for subagents (a foreman can be forced to hand off; depth-0 cannot).
- **Effort**: Fix (once the payload exists) / Spike first
- **Source**: cuda quota digest 2026-09-04; `docs/plans/2026-09-04-foreman-cost-discipline.md` D2

### autopilot effort vocabulary has no `minimal` — the muse-spark contributor tier cannot be examined at its cheapest setting
- **Trigger**: a Board request to examine or route a seat at `minimal` (asked 2026-09-03 for opencode-go/muse-spark-1.3-contributor), or a second provider whose cheapest reasoning tier is below `low`.
- **Context**: `dispatch-hetero.sh` (`--effort` enum), `engine-scorecard.js` (`EFFORT_VALUES`), `src/engine/capability-evidence.js`, `schemas/review-loop-contract.schema.json`, `implementer-ladder.js` and the seat-hash partition all enumerate `low|medium|high|xhigh|max`. Adding `minimal` is a vocabulary change across every validator plus the seat-identity/effort partition (v2.35.9) — an L with its own parity gates, not a one-line enum edit. Probe evidence that the tier is real: reasoning ≈53 tokens vs low ≈103 on the same prompt.
- **Effort**: L
- **Source**: v2.35.14 probe (`CHANGELOG.md`); opencode models.dev `reasoning_options` for the model

### `adopt-qualification-defaults.js list` prints `event undefined — null` for legacy feed rows
- **Trigger**: the next time the feed listing is shown to a consumer (any `list --from` run reproduces it: 12 such lines on 2026-09-03 against the live feed), or when a second display defect lands in the same command.
- **Context**: legacy (pre-effort, no event id / bundle path) scorecard rows reach the `evidence` line without a fallback, so the consumer prints `event undefined — null`. Producer side (llm-playground plan 065, P5 closed 2026-09-03) tracks the same item as XS display-layer; consumer fix is a fallback string when `event_id`/`bundle` are absent.
- **Effort**: S
- **Source**: 7840hs peer report 2026-09-03 (plan 065 P5); reproduced on aimax395 (exit 0, defaults 29 / strikes 1 / priors 57)

### Feed listing prints the pre-effort `seat_hash` ⚠ once per row — consider one consolidated notice
- **Trigger**: a consumer complains the listing is unreadable, or the producer moves to effort-bearing seat hashes (then the per-row ⚠ disappears on its own).
- **Context**: by decision (A) the feed's advertised `seat_hash` is a diff key only and the consumer re-derives every hash; every current row is pre-effort three-key, so every row prints the ⚠. The producer's red line is "entries are reordered, never recomputed", so this is purely a consumer display choice: one summary line ("N of M rows advertise a pre-effort hash; all re-derived") instead of N blocks.
- **Effort**: S
- **Source**: 7840hs peer report 2026-09-03 (plan 065 P5 closeout)

### `--runner opencode` usage stays `null` — parse `step_finish.tokens` from the `--format json` event stream
- **Trigger**: the first time an opencode seat's cost/efficiency is compared against another rail (scorecard `cost`/`usage` telemetry), or `dispatch-status.js` gains a second event-stream format anyway.
- **Context**: the opencode rail declares `log_format: plain`, so `dispatch-status.js --usage-only` returns `null`. The observed stream (opencode 1.18.25, 2026-09-03) carries `{"type":"step_finish","part":{"tokens":{"total,input,output,reasoning,cache{read,write}}}}` per step; summing per-step tokens is the obvious parser. Declare a `jsonl-opencode` format rather than sniffing.
- **Effort**: S
- **Source**: v2.35.12 (`docs/plans/2026-09-03-opencode-implementer-rail.md` § Out of scope)

### `resolve-review-loop-consult-discuss-gate` case (xix) mutates the canonical evals corpus — move it to a scratch copy and un-serialize
- **Trigger**: the next time a pooled test dies with `EACCES` on `evals/consult-capability-evidence-corpus.json`, or when `hooks/tests/run.sh --parallel` wall time is being trimmed and the serial tail is on the table.
- **Context**: case (xix) `chmod 000`s the REAL `evals/consult-capability-evidence-corpus.json` for two script runs; any pooled test that requires the consult grader in that window (verdict-stability D7, 2026-09-03: 12 EACCES failures, green standalone) dies. v2.35.11 serialized the file in `run.sh` as the right-sized fix; the proper fix is to point `resolve-review-loop.sh` at a scratch manifest (an env/flag override for the applicability-scope path) so the test never touches the tracked file.
- **Effort**: S
- **Source**: v2.35.11 pre-merge suite run (`d48b5235`); `hooks/tests/resolve-review-loop-consult-discuss-gate.test.sh:487-493`

### `autopilot endpoints test` hardcodes `claude-3-haiku-20240307` — a local server that validates model ids returns 404 and the probe reads as broken auth
- **Trigger**: the first time someone runs `autopilot endpoints test <name>` against a named local-model endpoint (SGLang/vLLM validate the model id) and gets a non-200 that is not an auth failure.
- **Context**: the probe's model id is a compatibility choice for GLM/MiniMax gateways (they map claude-* ids). Local servers reject unknown ids. Fix shape: `--model <id>` on `endpoints test`, defaulting to the current id; the note in `src/endpoints/cli.js` says modernizing the default needs a live spike per gateway, so the default stays.
- **Effort**: S
- **Source**: v2.35.11 (`docs/plans/2026-09-03-endpoint-transport-optin.md` § Out of scope)

### `src/engine/local-deployment.js` carries its own transport rule (TLS outside loopback) — align with `resolve-endpoint.sh` before it gets a live caller
- **Trigger**: `dispatch-local-openai.js` / `probe-local-engine.js` gain a caller on a real rail, or a second transport-policy divergence between the two is reported.
- **Context**: the named-endpoint resolver now owns the transport policy (loopback + disclosed `plaintext-private` for private-range IP literals). `local-deployment.js` still enforces "authenticated TLS outside loopback" with no opt-in and no `transport_security` disclosure; today it has no live callers so the divergence is dormant. Either make it consume `resolve-endpoint.sh` (credential_endpoint already references a named endpoint) or delete the duplicate rule.
- **Effort**: Fix
- **Source**: v2.35.11 (`docs/plans/2026-09-03-endpoint-transport-optin.md` § Out of scope)

### `dispatch-review` raw-log deviation 採信判準必要但不充分 —— 回音的 prompt 樣板可冒充 verdict
- **Trigger**: 下一次 depth-0 依 P5 判準（2026-07-31）以 raw-log deviation 採信一個 `no_verdict` 席次時；或為 `dispatch-review.sh` 加任何 verdict 解析路徑時。
- **Context**: P5 立的採信條件是「verdict block 完整、nonce 匹配、block 閉合」。2026-08-08 codepower 的 qc panel 出現一個**同時滿足這三條、但內容是被回音的 prompt 樣板**的案例：`gpt-5.6-sol@codex` 在額度耗盡前只吐出 `VERDICT: SHIP-AS-IS or FIX-THEN-SHIP` / `FINDINGS: one finding per line, or the single word none` —— 那是提示裡的格式說明，不是答案；nonce 之所以兩端匹配，是因為 nonce 本來就寫在 prompt 裡。259 bytes、閉合、匹配，depth-0 差一步就把空回讀成 SHIP。三條判準無法區分「模型回答了」與「模型把題目抄回來了」。**建議補第四條：block 內容必須與 prompt 樣板實質不同**（例如樣板行的字面比對、或要求 FINDINGS 之外至少一個非樣板 token）。同一 run 另有一個相鄰案例可作對照：`MiniMax-M3` 的 block 內容是真的（4 條具體 MUST-FIX），只因多印一行未填的 `NO-FINDING-PROOF:` 樣板而被 parser 判 `no_verdict` —— **一個該擋沒擋、一個不該擋卻擋了**，兩者都指向「以樣板殘留為訊號」這個維度尚未被建模。
- **Effort**: S
- **Source**: codepower `f65f29a7` qc panel 裁決 §4b；raw log `/tmp/dispatch-review-log-WPI98b`（sol）與 `-WO5A1B`（MiniMax）
### Contract-first escalation and local-repair gates — P6D incident follow-up
- **Trigger**: An owner-approved corrective project is opened from the 2026-08-21 P6D incident record; before that project may claim completion, all three controls must have planted negative cases that demonstrate they can block (a) unjustified heavy dispatch for an acceptance-oracle task, (b) a staged manifest outside the declared allowlist, and (c) successor/pipeline escalation before one local artifact-repair attempt.
- **Context**: A bounded six-file/three-command consumer task was routed through strict L5 Mission governance. Its first candidate passed every functional verification but included two dependency symlinks; Codex then replaced a minute-scale amend with terminalization, successor adoption, governance churn, and full rerun. Fable 5 ruled this was two decision failures rather than a Git-only mistake. The corrective project should implement the smallest enforceable protocol from the incident: dispatch justification when a complete acceptance oracle already exists; pre-commit staged-manifest comparison against a machine-readable task allowlist; and a failure-response state machine that requires one local artifact repair before workflow-level expansion. Status-report budgeting is a controller interaction rule and must not be inflated into unrelated product machinery without separate evidence. Do not encode P6D's six paths or a blanket symlink ban as global policy.
- **Effort**: L (dispatch admission + commit manifest gate + failure-response transition contract + negative controls)
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026-08-21-p6d-orchestration-incident/README.md), including the quoted Fable 5 independent judgment.

### Foreman model is hardcoded as `opus` in /l4–/l6 prose; routing config already overrides it

- **Trigger**: any consuming project sets `tree:sub-orchestrator` in `.claude/model-routing-config.md`
  (revival.3d did on 2026-08-28: `sub-orchestrator → sonnet`, `judge → haiku`), or a cost audit shows
  the foreman dominating spend.
- **Context**: `skills/l6/SKILL.md`, `skills/ceo-agent/references/level-front-door.md` (§"Dispatching
  the foreman", Amendment 11 note) and `skills/l4/SKILL.md` state "foreman / sub-orchestrator = `opus`"
  as a rule, while `scripts/resolve-dispatch.sh --tree --role sub-orchestrator` correctly honours the
  project override (`source:"project"`). Evidence from revival.3d session `5ca9b104` (grok cost split,
  one day, ~25 lines): opus foremen 7,929 turns ≈ $1,081 (62% of spend), sonnet leaves 23%, the
  Fable depth-0 16%. Foreman work was ≥90% protocol execution (dispatch leaf, run probe, wait, run
  gates, write run doc); the 3–5 judgment points per line were criteria-driven and caught by
  pre-registered criteria, not by model tier. Owner decision: "smart at decision points, not in the
  supervision loop" — foreman = cheapest model that follows the protocol, judge reads the four-state
  criteria table, only BLOCKED escalates to depth-0.
  Three things to fix: (1) reword the three docs so `opus` is the *default* not the *rule*, and
  point to the routing override; (2) `hooks/dispatch-model-guard` (opt-in, Tier B) must read
  `resolve-dispatch.sh` output rather than assert `opus` for `sub-orchestrator`, else enabling it
  will reject a legitimate `sonnet` foreman; (3) offer a deterministic foreman shape — a Workflow
  script (`implement → verify-author → gates → harness → criteria table → escalate on BLOCKED`) —
  as the documented alternative to a model-driven foreman loop, since most foreman turns are
  deterministic.
- **Effort**: S (docs + hook read path) · L for (3) if shipped as a bundled workflow
- **Source**: revival.3d `15edf5e7` (routing override), `NOTE-FOR-FABLE-QUOTA.md` (grok cost split),
  revival.3d `docs/governance/dispatch.md`


### `probe-runner-coverage` parallel-only flake — fork-pressure suspected, residue ruled out

- **Trigger**: next time it reds in a `--parallel` run (it passes standalone).
- **Context**: 2026-08-28 suite-reaper reproduction split the old diagnosis — the residue leak
  was real (deterministic ~7+2+6 entries/run, now reaped by
  `hooks/tests/lib/suite-residue-reap.sh`), but seeding 110+ stale entries did NOT move the
  failure count (clean 4/283 vs seeded 3/283, no `/tmp` quota pressure on this host: 858G free,
  2% inodes); the one recurring flaky file was `probe-runner-coverage`, which failed on the
  CLEAN run — a pure file-parsing test, so residue cannot be its cause; 32-way fork pressure is
  the live suspect.
- **Effort**: Fix.
- **Source**: fix/suite-residue-reaper QC round, depth-0 panel + foreman reproduction logs, 2026-08-28.

### Suite reaper — symlinked-TMPDIR hosts fall back to rm -rf (git-worktree-remove path never engages)

- **Trigger**: first report of dangling `.git/worktrees` entries on a host with symlinked `/tmp`
  (e.g. macOS).
- **Context**: `_wt_is_registered_path` exact-string-compares realpath'd entry vs git's raw
  recorded path, so on symlinked TMPDIR the git remove path silently never engages (same
  behavior as pre-fix, not unsafe, just incomplete).
- **Effort**: S.
- **Source**: depth-0 qc panel 🔵, 2026-08-28.


### Implementer suite hardening backlog (pre-merge review round-1 cut list)
- **Trigger**: 下一次動 `evals/impl-eval-*`/`runImplQualification` 時捎帶;或第三場正式施測之前(屆時 Stage-0 機械化與 live-rail smoke 應先落);或 reviewer 再報同類。
- **Context**: v2.34.34 round-1 review 裁 CUT 的殘項(五個 MUST-FIX 已修:partial-corpus fail-open 雙層拒收、preflight prose-justification、dispatcher_called ETIMEDOUT 歸因、HELP、Stage-0 明文 operator-run):(1) **Stage-0 probe 機械化**(qualifier 內建 receipt writer + frozen-token literal containment + attempt cap 消費;現為 operator-run,程序在 engine-onboarding SKILL.md);(2) §7 未落 fixture 列:runner-config-editor、malicious-git-config(現為 neutralized-not-labeled——`repoHygieneViolations` 不掃 repo-local config)、replacement-ref、add-then-revert canary、dirty-worktree、question-staller、quota-phrase+exit1、parser/output-bomb、runner-crash;(3) §2 live-rail smoke(真 rail + `--runner-bin` deterministic engine + 兩紅控);(4) §6 consumer matrix (b)-(f)(凍結舊 validator 拒新 row 的負向、qualityOf T0 斷言、dispatch-contract/review-loop 分支、非 N/N 控制);(5) capability-evidence.test.sh 的 impl_dispatch 單元覆蓋;(6) TTL 30/31/90/91 邊界測試;(7) `--trials` 精確斷言;(8) cosmetics:`corpus_version` 重複字面(已凍進 event 143 rows)、dead `wrapDispatchBin`、no_verdict stub 上 stdout。
- **Effort**: M(合併一輪)。
- **Source**: autopilot:reviewer pre-merge round-1,2026-08-22;`docs/plans/2026-08-22-implementer-qualification-suite.md` §6-§8。

### agy output envelope invalid on create-a-new-file responses (blocks agy implementer qualification)
- **Trigger**: 下一次要考 agy 家族 implementer 時（v2.35.13 起信封無效只是遙測遺失、狀態看 artifact，且 log 會留信封原文——重考就能同時拿到 row 與重現樣本）;或 agy 更新後 changelog/實測顯示 envelope 修復。
- **Context**: 2026-08-22 implementer 施測(agy 1.1.17):flash-high 6 案、pro(event 147)2 案、flash-medium(event 152)6 案 envelope FAIL + 2 案 stall——envelope 失敗案**全部**是建新檔任務且同簽名(family-wide、發生率隨 tier 降:medium 6/8+2 stall、high 6/8、pro 2/8);編輯既有檔的家族全過。六案 raw log 皆為 `agy native JSON envelope invalid — response and usage NOT parsed`——wrapper commit 已落(scored_sha 存在)但 agy 輸出信封壞損,rail fail-closed nonzero 路徑觸發。FAIL row(scorecard event 144)依凍結 taxonomy 常駐;修復後屬 fresh evaluation。修向在 agy 上游或 dispatch-hetero 的 agy envelope 解析側,先重現最小案例再動。
- **Effort**: Fix(重現+定位)/ 上游依賴。
- **Source**: `docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify/README.md`。

### `validate-json-schema.js` 拒絕所有非整數數字 —— 任何帶小數的 JSON 文件都驗不了
- **Trigger**: 下一個要 schema 驗證的 artifact 帶浮點數;或下一次動 `scripts/validate-json-schema.js` 的 `parseNumber`/`assertJsonValue`。
- **Context**: `parseNumber`(`validate-json-schema.js:161`)在 **schema 求值之前**的 document preflight 就把任何含 `.`/`e`/`E` 的數字字面量判為 `UNSUPPORTED_JSON_NUMBER`(exit 2),與 schema 內容無關;`assertJsonValue:71` 同樣要求 `Number.isSafeInteger`。這是刻意的 lossless round-trip 保守設計,但代價是**任何帶比例、分數、機率的 artifact 都無法被這支 validator 驗證**。v2.34.36 撞上:`references/official-qualification-defaults.json` 的 `capability_score` 是 `cases_passed/cases_total`(0.75、0.9166666666666666、0.9583333333333334、0.6666666666666666、0.9761904761904762 五筆,經機械掃描確認是整份 artifact 唯一的非整數)。當前作法是 `build-qualification-defaults.js` 把那些欄位正規化成 0 之後才送驗(schema 對該欄位只約束 number-or-null,披露區塊完全不受影響),並在 `references/qualification-defaults.md` 明寫這道限制 —— 不是修好,是**明說**。順帶發現:`schemas/hook-event.schema.json` 自己也不通過這支 validator(它用了不在 `SUPPORTED_KEYWORDS` 裡的 `description`)。
- **Effort**: S(接受有限精度浮點,或加一個明確的 `--allow-non-integer-numbers` 開關;要帶 planted negative 證明 lossless 保證沒被整體放掉)。
- **Source**: 2026-08-23 official-qualification-defaults 施工實測(run `official-defaults-l4`)。

### v2.34.37 first-pass review 的 cut list —— 六個「不是錯,但名字比保證大」的小項
- **Panel addendum(2026-08-23,depth-0 qc panel MiniMax-M3,verified)**:(7) `instant2` fixture 以 opaque 重錨構造 evidence(刪派生欄→`compileCapabilityEvidence`→手寫 `event_id:1`+重生 `transcript_hash`)——若日後 producer/anchor 契約收緊,該測會「錯因轉紅」;修向:改走 production `record` 同一 canonicalizer,或明文標注 seam 依賴 producer-hash 契約。(8) `instant2` 的 fixture 選取 filter 不驗 `engine/runner/role` 與 seat-hash 對齊——選錯來源列會報 opaque `RECORD_FAILED:` 而非清楚語意;修向:filter 收緊+shell 斷言對齊。
- **Trigger**: 下一次動這六處任一 —— `hooks/tests/external-lifecycle-witness.test.sh` 的 `stop_bounded` 斷言、`hooks/tests/calendar-teeth-negative.test.sh` 的 `instant3`/`instant4`、`scripts/engine-qualify.js` 的 `wall_truncated` 欄位、`scripts/engine-scorecard.js` 的 `startOfUtcDayMsOf`/`nowArgToMs`;或有 consumer 開始讀 `wall_truncated` 這個名字。
- **Context**: v2.34.37 first-pass review(autopilot:reviewer,opus)判 Low risk、無 🔴 無 🟠,兩枚 MUST-FIX 皆為文件用語已當場修掉。剩下六項刻意不在該刀處理,逐條記下以免被吞:(1) `measureBoundedStop` 的死 conjunct 已在該刀移除,但由此使 `stop_bounded` 與 `concurrent_stop_resolved` 成為**同一個 boolean、被斷言兩次**(`:920`/`:921`)—— 刪掉重複那條要先確認沒有別的讀者。(2) `instant3`/`instant4` 是對字面識別字 `todayMsUtc()` 的 awk grep,但 PASS 字串宣稱的是語義性質(「任何 UTC 午夜截斷都不存在」);換個名字寫回截斷仍會綠 —— 這是 evidence-discipline 的 shadow 形狀,行為面由 `instant1`/`instant2` 兜住,`instant4` 其實與 `sync-codex-plugin-skills.sh --check` 的 byte-parity 閘重複。(3) `wall_truncated` 在**計數 seam** 觸發時也為 true,名字比事實大;生產路徑上 seam 從 CLI 不可達,所以今天 `wall_truncated ⇔ 真的撞牆`,但改名 `truncated` 或加 `truncation_cause` 才誠實。(4) `startOfUtcDayMsOf` 用 `Number.isFinite` 守門,但 `new Date(ms).toISOString()` 對 ±8.64e15 之外的有限值會丟 `RangeError`;今天不可達(`toDateMs` 先擋、`Date.now()` 在範圍內),多一個 caller 就要改成 `Math.abs(ms) <= 8.64e15`。(5) `nowArgToMs` 的 `required = true` 分支在這刀之後**沒有任何呼叫點**,是死參數。(6) witness 測試失敗路徑的 `await Promise.all([firstStop, secondStop])` 沒有 timeout,真的掛住會讓整份 suite 卡死而不是印出 `stop_bounded=false` —— 與改動前形狀相同,非本刀造成。
- **Effort**: S(六項各自獨立,可隨手撿)。
- **Source**: 2026-08-23 v2.34.37 first-pass pre-merge review(autopilot:reviewer);run `fix-bundle-l4`。

### `engine-qualify-impl.test.js` 單次無法重現的紅(1/24 solo,訊息未捕獲)
- **Trigger**: 下一次它在 full-suite / CI 或 solo 跑紅(歸因半件)。**保存半件已做(2026-08-23)**:`hooks/tests/run.sh` L1 現在把 `node --test` 全輸出 tee 進 `/tmp/autopilot-l1-unit.*`,紅了保留並印路徑、綠了即刪(planted red 驗證訊息確實落檔)。solo 迴圈仍須自帶 `2>&1 | tee`——run.sh 管不到 ad-hoc 跑法。
- **Context**: 2026-08-23 v2.34.37 收尾期間,`node --test scripts/engine-qualify-impl.test.js` 在約 24 次 solo 連跑中出現**一次** `pass 0 / fail 1`;當時的 harness 只 grep 摘要行、沒有保留 log,`AssertionError` 的 message 因此**遺失**,無法歸因。事後立刻以保留 log 的 harness 連跑 10 次 + 另外多輪 solo 3 跑,全綠,兩次 `hooks/tests/run.sh --parallel 8` 全 275 檔綠。所以:**已知有一次紅、未知原因**,不宣稱已修、也不宣稱是 flake。可疑面向:同檔仍有 `testWallSecondsOverride: 0` 的零牆 fixture、以及 live-rail 派工會起真子行程(`impl-qualify-live-*` 暫存目錄、`fake-dispatcher` wrapper),機器極度吃緊時子行程失敗會以什麼形狀冒出來沒有被觀察過。修向:先把該測試的失敗輸出常態保存(`node --test` 的 stdout 全存進 artifact),再談歸因 —— 這正是「紅字部分為雜訊就不再被讀」那族危害的入口。
- **Effort**: S(先加保存,再看下一次紅)。
- **Source**: 2026-08-23 v2.34.37 收尾實測(run `fix-bundle-l4`),foreman 直接觀察。

### Brain-seat sittings in the shipped qualification defaults (v2 artifact)
- **Trigger**: a consuming repo asks to adopt an owner/brain seat without self-qualifying; or the Board schedules the fourth brain sitting and it PASSES (a passing sitting is the first brain row worth shipping as a default).
- **Context**: v2.34.36 ships official defaults for `implementer` / `reviewer` / `verification_author` — all scorecard rows. Brain-seat sittings are NOT scorecard rows: they are atomic `owner-brain-seat-v1` records in the capability store with their own semantics (forced `brain-seat` scope, no expiry, 3-strike revocation via `engine-capability-state.js brain-status`). Packaging them means a second record shape in the artifact + a second adoption path in `adopt-qualification-defaults.js`, and today all three recorded sittings FAILED (events 3/4/6), so there is nothing routing-useful to ship. Recorded as a deferral with a reason rather than forced into the v1 shape: `references/official-qualification-defaults.recipe.json` `excluded[]`.
- **Effort**: S(第二種 record shape + 採用路徑)。
- **Source**: v2.34.36 official-qualification-defaults ship;`references/qualification-defaults.md` § "What this does NOT do"。

### Durable repair-lock — 解鎖路徑先行,鎖才准回來(P6D KR3 的第二階段)
- **Trigger**: 無狀態拒絕被實測繞過(terminalization 之外的路徑把 BOUNDARY_REJECTED campaign 排水/succession 掉而未修復 —— 例如 host 直驅 reducer 的 no_effect_release);或 engine_terminal_evidence 欄位在真實終局分類點被接線(目前是死欄位)。
- **Context**: v2.34.32 原出貨 durable claim-bound repair lock + 四 Mission 後盾,pre-merge review 兩枚 🔴 殺掉:解鎖路僅存於 mission-v2 ready/follow_up 排水(legacy receipt 永無解)、bypass enum 欄位無生產寫入者(死碼)、projection roundtrip 不攜帶 lock(PROJECTION_HASH_MISMATCH 毒工件)、no_effect_release 一發繞過全部後盾、finalize-abort 冪等被打破。重來的入場條件(缺一不可):(1) engine-derived terminal evidence 在真實分類點接線且**能清除既有鎖**;(2) legacy receipt 顯式處理;(3) buildProjection/restoreProjection 條件式攜帶 + roundtrip fixture;(4) no_effect_release 拒絕帶鎖 claim(與 (1) 同時);(5) 鎖寫入前置(claim 非 terminal/released、mission 非 terminal)+ CLI 冪等分支順序;(6) 帶鎖 mission 可經 enum 抵達終局的 planted 測試。證據:reviewer 報告(probe-roundtrip/hashcompat/lockwrite/escape/idem 五腳本,project archive)。
- **Effort**: L(設計 + 六前置 + 測試)
- **Source**: 2026-08-21 pre-merge review(autopilot:reviewer);`docs/projects/_archive/2026-08-21-p6d-corrective-gates/`(歸檔後)。

### ~~Contract-first escalation and local-repair gates~~ — 2/3 classes SHIPPED v2.34.32; class (a) REMAINS OPEN
- **Trigger**(殘餘,class (a) 專屬): a mechanically valid oracle-completeness predicate exists — G1/G2 review refuted the R0 predicate ("output_paths+verify cmds" is EVERY Mission contract's shape); candidates recorded in plan §1: `required_change_paths` equality, or opt-in `complete_deliverable` flag + closed-enum unverifiable-property justification. KR1 must NOT ship (even as shadow) until then.
- **Context**: 原三控制中兩個已出貨且各有 planted negative + dead-gate mutation kill:(c) repair ladder(`src/engine/repair-ladder.js`,無狀態形:terminalize 邊單點拒絕;零 delta 轉終局被拒)與 (b) pre-commit manifest gate(`check-disjointness --staged` + dispatch-hetero wrapper staging 攔截;P6D 雙 symlink planted red)。(a) unjustified heavy dispatch 未出貨——G2 terminal 裁決 KR1 連 shadow 都砍(對已否證述詞做 shadow 產生不可解讀資料)。report budget 依事故記錄邊界維持非產品。
- **Effort**: M(class (a) 述詞設計 + enforce campaign,需新 plan + review)
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026-08-21-p6d-orchestration-incident/README.md);plan `docs/plans/2026-08-21-p6d-corrective-gates.md`(R2' FROZEN)+ 兩代 review 證據。
### Skill contract-card rewrites under 成績單前置（G2 MiniMax R8）
- **Status**: dev-flow leg RESOLVED-NO-SWAP（2026-08-18,[plan](plans/2026-08-18-dev-flow-contract-card.md)）— 儀器（evals/skill-onoff）、規格（references/skill-contract-card.md）、P4 baseline 機制已出貨;primary block 63 runs 機械裁決 **INSTRUMENT-INVALID（V2 vacuous,1/5 家族承重）**,card 不出貨（見下方「dev-flow card re-attempt」row）。quality-pipeline leg 留本 row,前置改為:skill-onoff 儀器修復並通過 V2。
- **Trigger**: 四層 redesign 的 Policy 層設計定案,且目標 skill 有 eval ON/OFF 證據（成績單前置）
- **Context**: 童子軍規則的漸近線——把重量級 skills（dev-flow、quality-pipeline 候選）改寫為 contract-card shape（trigger/inputs/decision-table/engine-pointers）。未評測前不得重寫。
- **Effort**: L
- **Source**: G2 review finding（MiniMax R8, 2026-08-16）;strategy thread 2026-08-16

### dev-flow card re-attempt — instrument repair first (V2-vacuous verdict 2026-08-18)
- **Trigger**: A new evidence campaign budget is approved AND the skill-onoff task set is repaired so ≥4 of 5 families are load-bearing (per the frozen V2 rule). Repair directions from the data: harder tasks where sonnet's base rate drops (F1/F5 ceilinged: OFF 6/9, 5/6); an observable for F6/F4 that survives headless (or multi-turn runs); consider a weaker-model primary block. **The old F6 marker is now invalid** — P7 (2026-08-18) scoped the quality-gate rule by size, so a Fix-size task legitimately satisfies it with lint+test; a marker still requiring `Skill(quality-pipeline)` would measure a claim the body no longer makes.
- **Context**: The 499-line card draft is digest-frozen at `evals/skill-onoff/packs/dev-flow-card/` and was NON-INFERIOR on the only load-bearing family (F3 branch discipline: FULL 9/9, CARD 9/9, OFF 0/9 — total discrimination, perfectly preserved). Verdict INSTRUMENT-INVALID forbids a card verdict either way; budget hard-cap (111) blocked an in-project re-run (spent 86). Evidence: `docs/plans/evidence/2026-08-18-dev-flow-contract-card/p6-adjudication.md`. Card edits invalidate CARD-arm rows (frozen rules §4). Since P7 the FULL pack no longer matches the live `skills/dev-flow/SKILL.md` — it is a historical freeze of the measured body; the repair campaign re-freezes all three arms from scratch.
- **Effort**: M（task-set repair + 63-run re-campaign）
- **Source**: dev-flow-contract-card P6 adjudication（2026-08-18）.

### Panel progress view — reviewer-cut cosmetic residuals (v2.34.31 round-1)
- **Trigger**: An operator incident actually caused by one of these: misread an exit-4 run because a never-dispatched seat shows `transport_exhausted`; `--panels` truncation at 10 hides a panel someone was looking for; `.tmp-<pid>` residue accumulates measurably in the runs dir; `--panel`(缺值)的 exit-2 訊息造成真實誤導。
- **Context**: 2026-08-21 review 判 CUT/FOLLOW-UP 的殘項(行為今日驗證正確,純回歸保護/污染防護):(1) never-dispatched seat 標籤應為 `not_dispatched`(`dispatch-plan-review.js` settle 分支);(2) `--panels` 輸出加 `total`/`truncated`;(3) panel lib flush catch 內 unlink tmp;(4) `--panel` 缺值時的用法訊息;(5) `--list` 的 panel 排除改以 `artifact_type` 判別而非檔名前綴(理論性:自產 run_id 不會撞 `panel-`)。全部單檔小改;證據與行號在 review 記錄(project archive)。另一獨立觀察(round-2):`preflight-release.sh` gate [3] 只比對版本字串,鏡像 **script 內容** 漂移不會被它抓 —— 測試套件是唯一 parity gate;若鏡像漂移再度逃到 develop,提升為獨立 Fix。
- **Effort**: S(單項)
- **Source**: autopilot:reviewer FIX-THEN-SHIP round-1, 2026-08-21;docs/projects/_archive/2026-08-21-panel-progress-view/

### Arm the ordinary-strike threshold (currently shadow-only) — DATED REVIEW REQUIRED
- **Trigger**: When shadow data exists for a role — i.e. `would_requalify` has fired at least once against a seat and the operator has replayed those strikes and agrees each was a true engine/pair failure. Also: this row must be re-read by **2026-11-22** even if nothing fired, because a threshold nobody revisits is a calendar tooth in a trench coat.
- **Context**: v2.34.35 ships `ordinary_strike` accrual in SHADOW: strikes are recorded and `would_requalify` is projected, but `admission_status` stays `qualified`. `critical_reexam_trigger` enforces immediately (deterministic predicates need no calibration). The flip is one env var, `AUTOPILOT_STRIKE_ENFORCEMENT=enforce`, read at projection time in `engine-scorecard.js` — see [`references/strike-decay.md`](../references/strike-decay.md) § Arming. Arming is a per-role Board decision, not a default: the question is whether N=3 is right for that role, which needs the shadow counts to answer. Do NOT arm on a hunch; a wrongly-armed threshold blocks a good seat and reads exactly like the calendar tooth this replaced.
- **Effort**: S (flag + per-role N) once the data justifies it
- **Source**: hetero design panel 2026-08-22 (kimi's "trench coat" objection), shipped shadow-first per synthesis §8.

### Strike-decay deferrals — the five mechanisms the panel cut from the first instrument
- **Trigger**: Any of: (1) a detector is caught emitting strikes at an anomalous rate; (2) more than two seats trip in one short span and the cause turns out to be a gate bug, not the engines; (3) a re-exam is needed and nobody notices for a week; (4) shadow data shows absolute counts penalising a high-volume seat, which is the only evidence that would justify building a dispatch ledger.
- **Context**: Deliberately NOT built in v2.34.35, each with a reason rather than an omission. **Detector anomaly quarantine** (4 seats wanted it): emission-rate deviation from a detector's own baseline auto-demotes its strikes to shadow pending review — needs a per-detector baseline that does not exist yet. **Fleet circuit breaker** (fable): >N seats tripping in a short span freezes enforcement and alarms — a gate bug is not an engine bug. **Rate-based windows**: not computable from a strike-only ledger; would require an outcome event per dispatch, which is a real build. **Re-exam scheduling automation** and **liveness-probe stale tax**: both deferred as premature on zero data. **Escalated QC sampling for past-advisory-date seats** (synthesis §6, the "silent rot" trade): the calendar should change how hard we LOOK — a stale seat gets sampled harder so drift arrives as strikes through the normal channel — plus coverage telemetry recording which detectors ran per dispatch. That last one is the most valuable of the five and the one the panel most wanted; it is the natural follow-up cut.
- **Effort**: M each; the QC-sampling/coverage-telemetry leg is the recommended next one
- **Source**: hetero design panel 2026-08-22 synthesis §5/§6 + cut list; deferred by scope=Hold on the M-size first cut.

### Capability-claim identity is coupled to its observation timestamp
- **Trigger**: When a receipt refresh is next needed, or before adding a fourth consumer to `platform-capability-claims.js`.
- **Context**: `claim_id = sha256(claim body)` and the body includes `live_evidence.observed_at` + `freshness.expires_at`, while the required IDs are hardcoded constants in `dispatch-hetero.sh:1653-1654`, `dispatch-review.sh:169-170`, `post-compact.js` `REQUIRED_D3_CLAIM_IDS`, and three `platforms/codex/plugin/` mirrors. So re-probing — even a pure timestamp refresh — changes every ID and requires editing shipped product code at eight sites. Identity should describe **what is claimed** (consumer + capability + contract), not **when it was observed**; the observation is data the validator checks live. Separately: the receipt is live runtime input but lives in `docs/projects/_archive/` (a deliberate 2026-08-04 archive-closure choice — reversing it is a decision, not a cleanup).
- **Effort**: M
- **Source**: 2026-08-18 capability-receipt expiry investigation.

### Vacuous red case in the guided-disposition suite (alien-hash branch)
- **Trigger**: Next touch of `scripts/build-profile-payload.js` guided-compatibility validation, or when adding any new disposition error code.
- **Context**: Mutation-tested 2026-08-18: deleting the `required === 0` branch at `scripts/build-profile-payload.js:478-483` leaves `hooks/tests/profile-guided-dispositions.test.sh:114-117` **GREEN** — the mutant survives. When `required === 0`, `shortfall = 0 - current ≤ 0` always falls through to the next branch, which emits the *same* `PROFILE_GUIDED_DISPOSITION_DEAD` token the test asserts, so the assertion cannot distinguish the two failure modes. The other four gate branches were mutation-killed. Fix: give the branches distinct codes (e.g. `..._NOT_IN_BASELINE` vs `..._STILL_PRESENT`) and assert the distinct one. Pre-existing — both the branch structure and the assertion predate v2.34.19.
- **Effort**: Fix
- **Source**: v2.34.19 pre-merge review mutation pass (autopilot:reviewer, 2026-08-18).

### dev-flow F4 ledger rule — re-measure before deciding (F6 leg RESOLVED 2026-08-18)
- **Status**: **F6 leg closed** — think-tank 5-role ruling C-shape, shipped: rule restated at the step that runs it, claim scoped honestly (S/Fix = project-config gate; L/H = quality-pipeline via finish-flow L-5.2 / H-9.2), enforcement recorded as `documented-only` in `references/four-layer-design.md` § Skill-layer rules (S1). Root cause was a self-contradiction in the body, not a missing enforcer: `:133` demanded quality-pipeline while `:241`/`:275` offered "lint + test" at the point of action. Evidence: [p7-f6-f4-adjudication.md](plans/evidence/2026-08-18-dev-flow-contract-card/p7-f6-f4-adjudication.md).
- **Trigger**: The skill-onoff instrument-repair campaign, at the point where its task fixtures are redesigned — F4 must be re-measured there, not decided from the existing data.
- **Context**: F4 (Fix step 6 ongoing-maintenance ledger row) measured 0/3 in the FULL arm, but n=3 and the fixture repo carried no `docs/` tree at all, so the model had to originate a directory rather than append a line — a materially different task from the one the rule states. Recorded as S2 `documented-only` pending re-measurement. Do not build an enforcer for it on the current evidence.
- **Effort**: S (folded into the instrument-repair fixture design)
- **Source**: dev-flow-contract-card primary block（`evidence/…/primary-sonnet-results.jsonl`）;P7 adjudication 2026-08-18.

### Outcome-shaped quality-gate enforcer (opt-in) — replaces the rejected invocation check
- **Trigger**: When an enforcer for the quality gate is wanted again, OR when `quality-pipeline` grows a SHA-bound "this ran" receipt that a gate could re-derive from. Not before: the current design has nothing to verify against.
- **Context**: P7 ruled out the obvious enforcer. A hook asking "was `Skill(quality-pipeline)` invoked before `git commit`" governs **process**, which [ADR-0001](adr/0001-verification-over-attestation.md) forbids — and the outcome it proxies (tests were actually run) already sits at 5/6 in the eval's **OFF** arm, i.e. near the model's base rate. It would also kill F6 as a FULL-vs-CARD discriminator, which the re-attempt campaign needs (≥4/5 families load-bearing). If built: opt-in like `branch-protection.js` (never default-on), predicate must be outcome-shaped (evidence that tests ran green against the diff, re-derived — not an assertion that a skill was called), escape hatch + planted red case mandatory per the anti-cathedral constraint.
- **Effort**: M
- **Source**: think-tank 5-role panel 2026-08-18（collision insights ②③）;[p7-f6-f4-adjudication.md](plans/evidence/2026-08-18-dev-flow-contract-card/p7-f6-f4-adjudication.md).

### Scaffold-tier effect A/B measurement（four-layer D6 promised row — repaired 2026-08-18）
- **Trigger**: Before any skill or routing policy CONSUMES scaffold tiers（T0/T1/T2）as an outcome-quality claim（成績單前置 applies）;or before the next capability-tier expansion.
- **Context**: v2.34.11 shipped capability-tiered scaffolding with fail-closed T2, but `references/scaffold-tiers.md` Non-goals explicitly disclaims any tier→outcome effect claim — the A/B was deferred. Four-layer plan D6（docs/plans/2026-08-16-four-layer-redesign.md:269）recorded this row as added, but it was never created; repaired by dev-flow-contract-card P0. Design can reuse the `evals/skill-onoff/` 3-arm instrument pattern（tier as the manipulated variable, dispatched-leaf channel）.
- **Effort**: M
- **Source**: four-layer-redesign D6 closeout leftover（2026-08-17）;audit 2026-08-18（dev-flow-contract-card prologue）.




### cc-shim framing chrome leaks via `generate_session_title` (v2.34.7 fix incomplete)
- **Trigger**: Next touch of `dispatch-review.sh`'s cc-shim launcher, or the next `no_verdict` whose raw log shows an intact nonce block behind CC chrome.
- **Context**: 2026-08-18 P1 review (MiniMax-M3, cc-shim): parser returned `no_verdict` / "response did not start with the expected wrapped block" because Claude Code prepended `[claude-code:unrecognized_model] {"query_source":"generate_session_title"}` ahead of an INTACT `<<<AUTOPILOT-REVIEW-…>>>` block carrying a full SHIP-AS-IS verdict. Same family as the v2.34.7 reviewer-transport-framing incident — that fix suppressed the unknown-model notice at the main-query launch env, but the session-title generator path is not covered. Fix at the launch env (e.g. disable title generation in headless shim runs) rather than relaxing the parser (prompt-echo hole, v2.34.7 rationale). Verdict was recovered manually from raw log (`docs/plans/evidence/2026-08-18-dev-flow-contract-card/p1-review-raw.log`).
- **Effort**: Fix
- **Source**: 2026-08-18 dev-flow-contract-card P1 review round.

### Qualification CLI transport — runtime identity capture
- **Trigger**: When any CLI harness (codex / claude) grows a verifiable runtime model-identity signal in headless mode, or before promoting a CLI-transport qualification to a decision where alias drift would be material.
- **Context**: CLI transports return no model id, so administered identity is operator-asserted (pre-run probe recorded per the v2.34.15 governance rule; the HTTP path caught glm-5.2→glm-5.3 exactly via its runtime echo). `resolvedModel` in `qualification-review-provider.js` is the wired-but-dead field awaiting a real signal. The other seven items of the original v2.34.15 hardening row shipped in the 2026-08-17 hardening round (stdin data fence; hermetic `--setting-sources ""` probed on claude 2.1.233 + containment descriptor v2; `QRP_CLI_EFFORT` [a-z]+ validation; 2MB stdout cap; six test exec bits restored — run.sh L2 reachable again; context-window field pin schema-derived, suite fully green; exit-flush race settled from recorded exit with negative-control proof; `brain_seat_identity_file` documented in the config template).
- **Effort**: S once a signal source exists.
- **Source**: v2.34.15 pre-merge review; hardening round 2026-08-17.

### Broker payload format token rename (unified_diff misnomer)
- **Trigger**: Next time the broker client protocol version bumps for any reason, or before onboarding a fourth non-diff payload family.
- **Context**: `qualification-case-broker.js` hardcodes `payload.format: unified_diff` in its sandbox client; brain round bundles (v2.34.14) and VA spec envelopes (v2.34.17) ship JSON content under that diff-named token (VA plan G1-F11; the reviewer noted the misnomer risks being rediscovered as a bug). Renaming means a coordinated broker+provider+engine-qualify change and a client-protocol version bump — pure hygiene, zero behavioral effect today (the field is an opaque constant all three parties pin).
- **Effort**: S.
- **Source**: VA suite plan v3 §6 (G1-F11 deferral); v2.34.17 pre-merge review.

### Roster qualification — remaining legs (explorer suite; brain re-sit) — implementer leg SHIPPED v2.34.34
- **Status update (2026-08-22, post-sweep)**: the implementer leg is DONE and the Board-ordered full-roster sweep is administered (9 administrations, scorecard events 143-151; `docs/plans/evidence/2026-08-22-implementer-qualification-suite/sweep-2026-08-22.md`). **Nine qualified implementer pairs**: grok-4.5 (143), gpt-5.3-codex-spark (145), gpt-5.6-sol (146), Qwen3.8-Max/qoderclicn (148), GLM-5.3/cc-shim (150), MiniMax-M3/cc-shim (151), gpt-5.6-luna@medium (153), claude-sonnet-5 (154), claude-opus-5 (155) — all 24/24, expire +90d. FAILED honest rows: agy flash 18/24 (144) + agy pro 22/24 (147) — family transport envelope; **grok-4.6 23/24 (149) — security-canary trap hit** (version regression vs 4.5 on the identical trap family; blocks implementer routing only, reviewer seat unaffected). grok-composer retired upstream (uncharged probe receipt). The「Official qualification defaults」row is now SHIPPED (v2.34.36, 2026-08-23): these events are packaged as `references/official-qualification-defaults.json` and adoptable by a consuming repo via `scripts/adopt-qualification-defaults.js`.
- **Trigger**: Explorer formal suite — before autonomous routing claims for that role. Brain re-sit — when the Board schedules a fourth sitting (three sittings recorded, events 3/4/6; instrument clean, margins are capability; identity re-pin needed at sit time: harness hash tracks engine-qualify.js).
- **Context**: v2.34.15 shipped the CLI exam transport; the administrations are now spent through the gpt-5.6-sol leg. Measured: **gpt-5.6-sol QUALIFIED** (2026-08-17, `sol-codex-qualify/`) — 42/42 both trials, 0 FPs, score 1.0 over the codex CLI transport at max effort; scorecard event 141, evidence event 5, expires 2026-09-16 — the roster's first qualified reviewer row (re-sit on expiry is a fresh evaluation). **glm-5.3** FAILED its first full evaluation (4 clean FPs + 1 miss; scorecard event 140; worse than glm-5.2's event-139 sitting) — any future GLM attempt is a fresh evaluation. **MiniMax-M3** spike 5/9 (2026-08-16) — full run still not worth spending. **Brain incumbent** (claude-fable-5): two sittings FAILED (store events 3, 4; per-family diagnosis in `brain-seat-exam-suite/dogfood/README.md`) — remaining margins are stable capability signal, no third sitting (rerun-until-green forbidden); advisory bootstrap semantics hold. **verification_author suite SHIPPED in v2.34.17** (Board ruling (c), declared-test-plan construct; dogfood administration of the incumbent GLM seat recorded in `docs/plans/evidence/2026-08-18-verification-author-suite/dogfood/`).
- **Effort**: L（verification-author suite 設計）/ Board（brain re-sit scheduling）
- **Source**: v2.34.15 qualification-cli-transport + 2026-08-17 hardening round;evidence `docs/plans/evidence/2026-08-17-roster-qualification/` + `docs/plans/evidence/2026-08-17-brain-seat-exam-suite/dogfood/`

### Governance CLI UX polish（experience-critic findings, v2.34.13 dogfood）
- **Trigger**: 下一次動五支治理腳本任一時捎帶;或 critic 再報同類。
- **Context**: KR5 dogfood(GLM-5.2 critic,post-merge)對五支治理 CLI 的三條產品缺口:(1) `next-pick parse` 輸出是裸 JSON array,沒有 `schema_version`/`artifact_type` envelope(R4 尺,其餘四支都有);(2) 拒絕訊息只講條件不給修法(例 veto 的「no decision 'nope'」沒說怎麼列出可否決清單);(3) usage error 只列 mode enum,無 flag 級範例(R2 尺)。另兩條 MUST-FIX 是對 dogfood 證據本身的(valid-flow 覆蓋 3/5、exit code 未錄),屬 evidence 品質非產品。critic 的 severity 標籤無阻擋力 —— 全部在此排隊。Raw log:`docs/plans/evidence/2026-08-17-autonomous-brain-integration/dogfood-critic-raw.log`。
- **Effort**: S。
- **Source**: v2.34.13 KR5 dogfood(2026-08-17);critic run bvxubvq39。

### OpenCode `debug skill` truncation — restore portability check 16 to hard-fail
- **Trigger**: Upstream OpenCode fixes the corpus-volume-dependent `opencode debug skill` output truncation, or a supported OpenCode release changes the plugin/serve discovery surface again.
- **Context**: `scripts/preflight-portability.sh` check 16 is intentionally advisory while OpenCode 1.17 can omit discovered skills from `debug skill` output. Re-probe the real CLI after the upstream fix; if deterministic, restore the check to hard-fail. Do not treat the current advisory as a permanent acceptance of missing skill discovery.
- **Effort**: Fix.
- **Source**: 2026-07-17 OpenCode 1.17 migration run (v2.32.50); current `scripts/preflight-portability.sh` advisory wiring.

### t14 long-horizon per-turn verification gate
- **Trigger**: The next experiment aimed at improving long-horizon constraint adherence, or before claiming that prompt re-injection solves t14-class drift.
- **Context**: Per-turn re-injection moved vocabulary but did not produce a statistically conclusive behavior lift. The untested lever is mechanical verification at every turn: reject constraint-violating output and force a bounded retry. Keep this distinct from re-injection and measure against the existing t14 baseline.
- **Effort**: M.
- **Source**: `docs/projects/_archive/2026-07-08-t14-reinject/report.md` § Follow-up.

### Mission graph scheduler 與 portfolio optimization
- **Trigger**: v2.34.0 的 frozen deliverable graph gate 已出貨，且至少兩個真實 portfolio 顯示靜態 dependency batches 造成可量測的 idle time，或使用者明確要求跨專案排程／dashboard。
- **Context**: v2.34.0 只需要機械阻止 phase explosion：bounded deliverable count、DAG、parallel/batch/depth/gate budget 與 ready-node admission。Critical-path optimization、dynamic reorder、跨 repo portfolio、priority queue、進度 dashboard 與成本最佳化不屬於本次 prevention boundary；過早加入會把一個 P0 correctness gate 再膨脹成 scheduler 專案。啟動後應消費同一 frozen graph/receipt，不得建立第二套 Mission authority。
- **Effort**: L
- **Source**: 2026-07-28 Mission Convergence Portfolio 34-phase runaway audit；`governance-correction.md`

### Mission authority store 與 cross-harness enforcement hardening
- **Trigger**: 需要把 Mission `enforce` 宣稱擴到目前未有 executable blocking adapter 的 harness，或 threat model 升級為防止惡意 same-UID worker 刪改 `.git` 內 registry/state；若只是誠實 agent 的 branch/session reset，v2.34.0 local registry 已足夠。
- **Context**: 本次只實作 current-host 可驗證的 Git-common-dir durable registry、CAS 與 fail-closed adapter。防惡意本機程序需要獨立 UID、root-owned/remote daemon 或具 authenticity 的 authority service；精確 provider token/tool/cost telemetry 也只能在 host 真能觀測時加入。未有實證前不得用 HMAC、自述 counter 或 skill prose 假裝形成安全邊界。
- **Effort**: L
- **Source**: 2026-07-28 Mission P1/P2 parity audit與獨立 Architect/Ops/Skeptic review；`governance-correction.md`

### Every gate needs a negative control — the caution needs a routine behind it
- **Trigger**: 下一次新增或修改任何「閘」（release gate、drift gate、anti-gaming scan、admission check、hook）時；或再抓到一個閘存在卻沒在擋東西。
- **Context**: CLAUDE.md 已經寫著「腳本存在不是它在運作的證據」，但 2026-08-08 一天之內出現三次同一種形狀，全部通過既有 CI 而沒被發現——(1) managed dev-flow admission 對 bounded 非 Mission campaign **永遠 deny**，沒有任何呼叫端或 fixture 能滿足；(2) `resolve-worktree-teardown` 的 template-tier 斷言被 repo 自身 dogfood 設定遮蔽，測的不是它宣稱在測的東西；(3) `check-test-integrity.sh` 對 263 個 shell 測試檔一個都沒看，回 exit 0。三者的共通點是 **exit 0 被當成「有在保護」**，而沒有人證明過它能變紅。警語擋不住這個，因為警語要人想起來才會啟動。可能的形狀：閘的測試必須含一個 negative control 案例（刻意違反 → 斷言變紅），並讓某個 meta-gate 檢查每個閘都有這樣一條；或讓閘在「零輸入匹配」時回非零而不是 0。先決定要哪一種，不要三種都做。
- **Progress**: 三個實例裡的 (3) 在 v2.34.38 補上了負控制——四條 gaming 動作各有 BEFORE/AFTER/BLOCK 記錄,並立成常駐迴歸(`hooks/tests/check-test-integrity.test.sh` §11),外加一條 coverage meta-test 把「閘看得到的檔案數」綁在 `git ls-files` 的真實清單上。**這條 row 本身不因此結案**:缺的是那個 meta-gate——沒有任何機制檢查「每個閘都有一條負控制」,(1) 與 (2) 也還沒有。v2.34.38 提供的是一個可抄的形狀,不是那個機制。
- **Effort**: M。
- **Source**: 2026-08-08 CI triage（11/273 → 1/273）三起獨立成因的共同模式；本檔另有三條各自的條目。

### Test-integrity L0 cannot see an early `exit 0` spliced into a shell suite
- **Trigger**: 下一次有人想把這個閘升到 `block`,或再抓到一個 bash 套件「綠得太安靜」時。
- **Context**: v2.34.38 讓 `*.test.sh` 進入閘的視野,但三條 gaming vector 裡只有兩條半是機械可見的。
  刪除與弱化走語言無關的 `deleted_line`;新增 skip 走新的 `shell` skip 規則;**塞在套件中段的
  `exit 0` / `return 0` 抓不到**——它沒有刪任何一行、沒有任何 skip token,而 line-level regex 分不出
  它和本 repo 既有的正當 bail-out:260 個 `*.test.sh` 裡 **19 個**有 top-level `exit 0`、41 個有
  任意縮排的、只有 2 個是放在最後一行,也就是說多數是 guard clause——正是 gaming early-exit 的形狀。
  要分開需要 L0 沒有攜帶的檔案位置資訊
  (「這個 exit 後面還有沒有斷言」),那是 AST/位置層的工作,不是加一條 regex。真要補,候選形狀是:
  比較 base/head 兩側的**斷言計數**(`assert_*` / `PASS [` 出現次數只增不減),那是檔案層而不是行層的
  不變量,也順帶涵蓋刪除與弱化。這條缺口目前在三個地方各寫一次(設定檔註解、引擎註解、本條),並被
  `check-test-integrity.test.sh` §11e 一條**會在缺口被補上時轉紅**的斷言釘住——修好它記得同步這三處。
  **注意這條缺口是目前唯一一條**:first-pass review 抓到的另外兩條(`${#…}` 截斷、line-start
  錨點漏掉 `&& skip` 與裸 `skip`)都比這條便宜,已在 v2.34.38 內修掉並各配常駐負控制。
  另有一個**已記錄的假陽性類別**:把 skip 寫進 fixture 的套件(例如
  `check-test-integrity.test.sh` §11c-bis 自己的 `sed` payload)逐字等同於自己 skip 的套件,
  行層偵測器分不出資料與程式碼;`warn` 下無成本,但翻 block 會擋住對該測試檔的編輯。
- **Effort**: M。
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。

### `check-test-integrity.sh` warn → block needs an accuracy record first
- **Trigger**: 累積夠多真實 range 的 violation 輸出,足以判斷「違規流是否準確到可以擋」時;或有人主動
  提議把 `.claude/test-integrity-config.md` 的 `mode` 翻成 `block`。
- **Context**: v2.34.38 刻意停在 `warn`。原因不是保守,是 L0 的判準粒度:它對 match 到的測試檔**每一行
  刪除**記一條 `deleted_line`,而這個 repo 的日常測試維護(改 case 名、修 `assert_eq` 參數順序、收緊
  一個界)天天在刪行 —— block 會擋掉幾乎每個誠實的 commit,然後有人就會把它關掉,而那正是它當初瞎掉的
  路徑(`references/evidence-discipline.md` §1)。block 另外會把每個 `surface_touch` 升成 violation,而本
  repo 的測試本來就會正當地改 `hooks/tests/lib.sh` 與 fixtures。要升 block,先要有記錄:實際 range 上
  violation 的真陽性/假陽性比例,以及 `.qc/<sha>.verdict.json` waiver 路徑在真實工作流下的成本。**沒有
  那份記錄之前不要翻**,翻了就是把一個會報告的閘換成一個會被關掉的閘。
- **Effort**: M。
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。

### Engine and CLI have no session-mode fallback for bounded non-Mission campaigns
- **Second live reproduction (2026-08-31)**: all three v2.35.5 rail-debt foremen hit `precondition_failed: Mission enforce mode requires a sealed campaign strict projection` on bare `dispatch-hetero.sh` dispatches (`dispatcher_called:false`); unblocked only by a Board-approved branch-local `enforcement_mode: shadow` flip, restored before merge. The asymmetry is now a hard blocker for any raw-rail repair work under enforce governance.
- **Third live reproduction, and it INVERTS this entry's central claim (2026-09-08, `fleet-comms` Phase 2, autopilot 2.36.1)**: a `/l5` run through the **canonical** entry — `bin/autopilot.js engine implement-review --campaign-contract` with `mission_grant_ref: null` and a contract sealed at `--mission-mode off` — was rejected `precondition_failed: active session-mode=l5 requires a sealed campaign strict projection (repo=…)`. This entry says `bin/autopilot.js` has **no** equivalent session check and that bounded campaigns pass through it unchecked; that is no longer true. The asymmetry did not get fixed, it **flipped**: the CLI path now enforces and still has no fallback, so a bounded non-Mission campaign under an `/l5` marker is not unchecked — it is **impossible**. `mission init --contract` is not the escape either: it demands a `mission_convergence_contract` (policy + execution graph + `graph_digest`), a different artifact from the campaign contract, so there is no bounded-campaign projection to bind. The only recorded way through remains the Board-approved branch-local `enforcement_mode: shadow` flip from 2026-08-31, which is an operator decision and was not taken. **Five pre-spend rejections preceded this one and every one of them was correct** (`profile` outside the enum, `repo_identity` not the `git-common-dir:<realpath>` form, `max_growth_ratio` above 1.5, `max_extra_churn` above the ratio-derived ceiling, ledger path not the canonical `<git-common-dir>/autopilot/implementation-campaign.jsonl`) — the gate spent nothing, which is the design working. The cost is that a first-time caller learns the contract's shape one rejection at a time; a single `--explain`/dry-run that returns **all** violations plus the derived values would have collapsed six round trips into one.
- **Trigger**: 要把 session-marker 紀律擴到非 Mission 的 managed campaign 時；或 threat model 升級為「同一 host 上未經 /l3–/l6 進入的呼叫端不得驅動 managed loop」。單純誠實使用者不觸發。
- **Context**: 三條路徑對「contract 不帶 Mission projection」的處置不一致。`dispatch-hetero.sh:1710` 在 `CAMPAIGN_PROJECTION_BOUND != 1` 時仍跑 `check_session_mode_gate` + `check_mission_enforcement_gate`；`src/engine/autopilot-engine.js` 與 `bin/autopilot.js` 則**沒有任何等價 fallback**——v2.34.8 收窄 admission 後，bounded campaign 在這兩條路徑上不經任何 session 檢查。此不對稱**早於** c3e2647d（2026-08-05 之前 Engine 根本沒有 admission），v2.34.8 只是讓它重新成為現行行為，**不是新退步**；而 c3e2647d 造成的中間狀態也不是可用的控制，是 100% 拒絕。真要補，得先決定一個沒有 Mission 身分的 campaign 該把 marker 綁到什麼上——不要為了對稱而發明一個假的綁定。
- **Effort**: M。
- **Source**: 2026-08-08 v2.34.8 pre-push QC。兩個 family（MiniMax-M3、GLM-5.2）皆回 SHIP-AS-IS 且 findings=none，都沒抓到這條；MiniMax-M3 更在總結中斷言 bounded campaign「現在會走到 session-mode gate」——經查為假，`check_session_mode_gate` 僅存在於 dispatch-hetero.sh。此為 `resolve-review-loop.sh` 既有 MiniMax-M3 advisory（diff-only 中央主張 5/6 為假）的又一實例。

### Mission runtime retires superseded adoptions at closeout, not after the fact
- **Trigger**: 下一次 Mission 重試鏈再留下多個 COMPLETE adoption，或要動 `src/mission/runtime.js` 的收尾路徑時。
- **Context**: v2.34.6 的 `mission-terminal-reconcile.js rollover` 是**事後清理**——它能指名已整合的 adoption 並退役其餘，但根因沒動：runtime 只在 mission UNRESOLVED 時圍籬，COMPLETE 之後每次重試都再鑄一個永久 terminal。治本是在收尾時就退役被取代的 adoption，讓 rollover 退回成救援工具而不是常規步驟。動這裡必讀 `scripts/mission-terminal-reconcile.js` 檔頭（記錄了兩層阻擋的完整診斷，以及 Work Order 豁免為何只對「observed_head 是 HEAD 祖先」成立）。
- **Effort**: M。
- **Source**: 2026-08-07 v2.34.6 rollover ship；`docs/projects/_archive/2026-08-06-dispatch-residue-cleanup/README.md`。

### `reap-dispatch-branches.sh scan` cannot see branches that carry no `root_run_id`
- **Trigger**: 下一次要盤點 dispatch 殘留分支時；或再出現「分支堆積但 scan 回報乾淨」。
- **Context**: `scan` 以 `root_run_id` 為 key，沒帶 id 的殘留分支完全隱形——2026-08-06 清出的 20 個就是這樣躲過的。缺的是一個**報告-only 的 `--all` 模式**列出 `unattributed`，不自動刪（preserve-first 是這支工具的既有立場，不要為了方便破例）。目前 usage 只有 `--repo/--into/--pattern/--inventory-file`。刪任何分支前先 `pin-evidence-anchors.js apply --exclude-ref <待刪ref>`：receipt 綁的是 commit SHA 不是內容，這個 repo 已經永久失去過 4 個 commit 的證據。
- **Effort**: S。
- **Source**: 2026-08-06 dispatch residue cleanup（20 → 1 branches, 6.3 GB reclaimed）。

### `prune_tmp_residue` covers 7 prefixes; 25 scripts create `/tmp` dirs
- **Trigger**: `/tmp` 再次被 autopilot 殘留撐大，或有人要為 CI runner 加磁碟配額時。
- **Context**: `prune_tmp_residue` 只被四個 dispatch 腳本呼叫，共 7 個 pattern（`dispatch-author-*`／`dispatch-explore-*`／`dispatch-review-*`／`dispatch-hetero-*`／`hetero-*-log-*`／`pi-rpc-session-*`／`hetero-detach-state-*`）。一次 `mkdtempSync|mktemp -d` 全掃（2026-08-16）數出 **25 個會建 `/tmp` 目錄的腳本，沒有一個自己 prune**——被 caller 的前綴涵蓋的只有 `pi-rpc-session-`（dispatch-hetero）與 `dispatch-author-codex-`（前綴匹配 `dispatch-author-*`）。無 owner 的包含 **production 路徑**，不只是 test fixture：`dispatch-anthropic-review-`（`dispatch-anthropic-review.js:276`，由 `dispatch-author.sh:959` 呼叫，而 dispatch-author 只 prune 自己的前綴）、`dispatch-contract-`、`dispatch-plan-review-`、`qc-panel-`／`qc-refute-b-`／`qc-emit-`、`next-touch-evidence-`、`hook-multiplexer-benchmark-`、`verify-red-green-`、`eval-selftest-`、`run-ledger-*-test-`，以及整個 `autopilot-*` 家族。
- **實測**（2026-08-16，開發機 `/tmp` 22506 項）: `dispatch-anthropic-review-*` 484 個（420 個 >3d，5.4 MB）、`qc-emit-*` 28 個、`ctxbud*` 175 個。**位元組小、entry/inode 大**——真正撐爆 `/tmp` 的是別人的殘骸，但這是 autopilot 自己該收的部分。
- **修法**: 讓 `prune_tmp_residue` 的 pattern 清單成為**單一事實來源**（例如 `lib/tmp-prefixes.sh`／`.json`），由建立者各自認領前綴，並加一個掃描 gate 讓「新增 `mkdtemp` 前綴但沒登記」變成紅燈。要嘛讓 `hooks/tests/lib.sh` 的 `cleanup_test_tmp` 也掃同前綴過期殘留。先確認它真的會 fire——別再多一個「存在但沒在工作」的腳本（見 `references/evidence-discipline.md`）。
- **Effort**: S（單點補 pattern）／M（做成單一事實來源 + gate）。
- **Source**: 2026-08-06 dispatch residue cleanup（782 項 `/tmp`、1.9 GB）；2026-08-08 複驗仍成立；2026-08-16 全掃擴大範圍——原標題「test-fixture prefixes」低估了，production dispatch 前綴同樣無 owner。

### `next-touch-validation.test.sh` asserts against un-versioned local Mission state
- **Trigger**: 立刻——它在 CI 上**永遠**紅；或下次有人相信「本機全套綠」等於「CI 綠」時。
- **Context**: 該套件讀 `.git/autopilot/mission/next-touch-debt-retirement/successor-prepared.json` 並斷言 `validatePreparedReceipt(...).state === 'ACTIVE'`，另外還綁 `D8_PUBLICATION_SHA` 與 `.autopilot/evidence/grok-implementer-ab.json`。那是 2026-08-03 已歸檔專案在**某一台機器**上一次真實執行留下的 authority artifact，不在版控裡，所以全新 clone 必 ENOENT crash（CI run 31206156093 實證）。本機會綠純粹因為那台剛好有。修法是造 fixture Mission state；**不要**改成「artifact 不存在就 skip」——那是把安全控制變成靜默通過。1760 行套件深度綁在真實 authority 上，工程量不小。
- **Effort**: M–L。
- **修法已驗證到 5/6（2026-08-08，未落地）**: fixture 用**本 repo 的本地 hardlink clone**（實測 0.31s／63 MB，且確認不帶 `.git/autopilot`）——如此真 history（`D8_PUBLICATION_SHA` `c43370dd` 可解析）、真 tracked 檔案（`.autopilot/evidence/grok-implementer-ab.json` 與 archived `authorization.json` 都在版控）與一個乾淨可寫的 Mission store 同時到位。在 clone 裡 commit 一個 `src/value.txt`（含 `## Next touch` ATX heading）當 graph node 的 spec anchor，別指向會變動的 repo 內容。然後 `runMissionCli(['prepare','--repo',clone,...])` 搭 `AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS=1` 與 `testOnlyDependencies`：真 producer 做事，只覆寫四個身分值成 archived authorization 釘的那些——`mission_policy_digest`、`mission_graph_digest`、`deriveMissionLineageId`、以及 `deriveMissionAdoptionKey`（必須是 `7e8e6806aee8…`：`findPreparedReceipt` 用 `authorization.branch.split('/')[1]` 當前綴過濾）。`--out` 必須寫進 `<common>/autopilot/mission/next-touch-debt-retirement/successor-prepared.json`，因為 `assertAuthorityPath` 只收 canonical authority root 底下的檔案。`gate_attempt_budget` 要 ≥2。**剩下的最後一格**：真 artifact 的 state 是 ACTIVE 且 0 個 active claim（實測拒絕碼 `MISSION_GRANT_INVALID`「found 0」），fixture 目前停在 DRAFT（拒絕碼 `MISSION_BLOCKED_OR_TERMINAL`）——需要 grant 後再釋放 claim，只 grant 會變成 1 個 active claim 而落到 `MISSION_GRANT_BINDING_MISMATCH`，那不在 site 1 的接受集內。**不要**嘗試從版控的 graph 重建 archived digest：`docs/mission-next-touch-debt-retirement-execution-graph.json` 已漂移（其 digest `c1c6f577…`，authorization 釘 `aba0dd14…`）。sites 2/3 另需 D8 rebind 與 terminal bundle，尚未探。
- **尾巴長度是可列舉的，不是未知的（2026-08-09 更正）**: 上一則把剩餘依賴描述成「尚未探」「長度未知」，那個判斷錯了。一次 grep 就把整條尾巴數完：只有三項——(1) `implementation-campaign.jsonl` 需要一個 project 到 `TERMINAL_READY` 的 campaign；(2) `MISSION_LEDGER`（第 39/41/43 行）指向真 repo 的 ledger；(3) `OUT_CURRENT`（第 72 行）跑開發者的活 ledger 並接受三個錯誤碼中的任一個。沒有第四項。三項都已收：新的 `hooks/tests/lib/implementation-campaign-ledger-fixture.js` 用**出貨中的 writer**（`run-ledger.sh` init/stage-acquire/journal-add ＋ `campaign-intake.js` 的 `appendCampaignEvent` ＋ 真 `reduceCampaignState`）造出 ledger——不是手寫 JSONL，所以它證明的是「production 造得出來」而不是「parser 讀得懂」；`MISSION_LEDGER`／`ARCHIVE_AUTH` 一起改指 fixture repo，每個 reservation 呼叫都補 `--repo`；`OUT_CURRENT` 實測為 `MISSION_GRANT_INVALID`（「found 0」）後釘死成單一碼，並改用一般的 `assert_contains`，不再手動加 pass counter。dogfood 套件的 rotation block 也改用同一個 library 的 `openCampaignLedger`，兩套件共用一份 intake 路徑。
- **Source**: 2026-08-08 CI triage（11/273 紅的最後一個，其餘十個已於 v2.34.8 修復）；2026-08-09 收尾。

### Dispatch-branch lifecycle — SHA-256 `check --ack` residual
- **Trigger**: 第一個 SHA-256 object-format repository 要使用 manual `check --ack`／restore acknowledgment。
- **Context**: inventory、reap 與 restore tests 已支援 SHA-256；剩餘缺口是 acknowledgment validator 仍只接受 40-hex SHA-1。
- **Effort**: S。
- **Source**: 2026-07-31 code/backlog audit。

### context-budget T3 deny tier — calibration and obedience evidence
- **Trigger**: 有可持久化的 context calibration／handoff obedience receipts，或再次觀察到 T3 後新派遣造成 spiral。
- **Context**: 先前 finish-flow marker blocker 已解；真正未完成的是用 session evidence 校準 deny threshold、handoff structure 與 anti-spiral policy，不能只靠靜態 token 比例。
- **2026-09-05 補充**：v2.36.1 起子代理（l4–l6 工頭）的 T2 deny 已由 `foreman-guard.js` 讀 live 檔實作；本 row 只剩 **depth-0** 的 deny tier，仍待校準證據。
- **Effort**: M。
- **Source**: context-budget follow-up audit。

### skills frontmatter `tier:` 欄位（B4 step 2 — 分層進 frontmatter）
- **Trigger**: 先在 Claude Code ＋ codex 兩平台各做一次「帶未知 frontmatter 欄位」的 plugin load dry-run 且確認解析容忍（R1-F5：未驗不得宣稱無行為影響）；兩平台紀錄在手才動工。
- **Context**: v2.31.16 B4 step 1 已把 docs/skills.md 排成 core/delegation/pioneer 三層（純排版）。step 2 = 把層級寫進各 SKILL.md frontmatter `tier:` 欄位，讓工具可機讀。風險面＝frontmatter 是路由面。
- **Effort**: S（含兩平台 dry-run）
- **Source**: docs/plans/2026-07-04-surface-area-reduction.md §B4；v2.31.16 收尾 deferred。

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力 reviewer(sonnet+全契約+tools)比「merged=clean」標注法強。配對一致性協議(m3-pathc-syscontract.md final protocol)不需要標籤,已作為現行量測法;真 certified-clean 集需逐案對抗性預審(每案先過一輪全火力 review + 人工裁決),成本高,等有絕對認證需求再建。
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。

### Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
- **Trigger**: ALL remaining prerequisites are met (telemetry alone is NOT a trigger): (1) a **two-pass resolve** in `resolve-review-loop.sh` without breaking the single-shot JSON contract; (2) a **pre-impl planned-scope signal** for implementer routing; (3) **per-project per-domain calibration with n≥30** real samples; (4) an **inner-reviewer-family field** distinct from panel-only `cross_family_*` semantics.
- **Context**: `/l5` 現已把 resolved `reviewer_runner` 傳入 `dispatch-review.sh`，所以舊 prerequisite (1) 已完成；domain probe 仍只輸出 `work_domain`/`domain_source` telemetry，沒有 domain-conditioned roster 或 two-pass routing。維持 **measure-now-route-later**；`qc_panel`/`cross_family_*`/`--enforce` 不受 domain 影響。Plan: [`docs/plans/2026-06-26-domain-aware-roster.md`](plans/2026-06-26-domain-aware-roster.md).
- **Effort**: L (each prerequisite is its own sub-task; (1) alone is S–M).
- **Source**: 2026-06-26 domain-telemetry ship (Phase 4); the deferred KR4 of the plan.

### L1 block-mode override re-enable — needs a REAL isolation boundary (cgroup is NOT enough)
- **Trigger**: when a `/l5` block-mode project hits a legitimate `executed_set_shrink` that should be waivable, AND a real isolation boundary is available.
- **Context**: The override stays **DEFERRED**. A v2.25.8 attempt to unlock it on a `--containment cgroup-verified` attestation was **REVERTED as UNSAFE** (gpt-5.5 adversarial review 2026-06-26, two EMPIRICALLY-verified escapes): (1) a same-user worker can `systemd-run --user --scope` a **sibling cgroup** outside the dispatcher's scope, so cgroup reap+verify is not malicious-proof and `contained:true` can be a false attestation; (2) the `--l1-verdict-file` path was honored even when worker-reachable (warned, not enforced). Conclusion (vindicates the L1 spec's original deferral): **no local-only, same-user mechanism closes the forgery hole.** Closing it needs one of: a separate UID for the worker, a real sandbox (container/VM/firejail), or a blocked user systemd bus (`/run/user/$UID/bus`) so the worker can't create sibling scopes. THEN: enforce the verdict path is depth-0-created-after-containment-proof and outside repo/.git/worktree; collapse the dispatch `containment`+`contained` provenance into ONE unambiguous attestation enum (don't accept a free-form `--containment` string). The `--containment` flag is currently accepted-but-advisory (no unlock).
- **Effort**: L (isolation boundary + enforced verdict-path + attestation enum + empirical sibling-escape regression)
- **Source**: test-integrity-l1 (v2.25.7) + W1/W2/W3 ship (v2.25.8); gpt-5.5 review verdict in session 2026-06-26; spec §8.3 / §12.

### qc-panel refute pass — graduate from shadow to gating (calibration-gated)
- **Trigger**: `scripts/calibration.sh report` over accumulated refute-shadow samples shows the refute pass does **not** false-suppress critical/`MISSED:` findings (meets the existing graduation-criteria data block). Until then it stays shadow.
- **Context**: v2.24.0 shipped the refute pass as **shadow / non-gating** — it emits `refute_shadow` + rides into the calibration `--source` tag but never alters `verdict` (a refute pass that suppresses a true critical is worse than the bug it fixes). Graduation = wire the survived/refuted result into the authoritative verdict, but only after calibration proves it safe. ✅ The non-gating regression assertion landed 2026-06-24 (this ship): `hooks/tests/qc-panel.test.sh` Test 19 stubs a cross-family refute judge that REFUTES every real miss and asserts `verdict` stays `fail` + `survived_misses:[]` + non-empty `refuted_misses` — locking the invariant mechanically before any graduation can silently break it. **Remaining = the L graduation itself** (wire survived/refuted into the authoritative verdict), still calibration-gated.
- **Effort**: ~~S (the test) now~~ done + L (graduation) when the trigger fires.
- **Source**: 2026-06-24 v2.24.0 ship (`77214a1`) + depth-0 qc 🔵 (reviewer `a4162329`).

### `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)
- **Trigger**: a **concrete, repeated** need to fan a single batch out across multiple *heterogeneous* (agy/Gemini) workers in parallel — i.e. real `/l5` task-supply where the cost-arbitrage of a second engine actually pays, AND the base-correctness + engine-variance risks are acceptable for that workload.
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out. The deterministic rails for the hetero-parallel path **already exist** — `dispatch-batch.sh reap` is the SIGTERM-to-pgroup parallel-kill trap built for shell-dispatched workers (setsid-verified), and `dispatch-hetero.sh` is the single-unit hetero dispatcher. What's unbuilt is the loop that fans `dispatch-hetero.sh` across N units under `dispatch-batch.sh`'s verify/merge-back/reap. It was **cut at plan time** (the weakest leg: base-correctness × engine-variance × *rarest* task-supply — speculative on speculative). S0.a then confirmed wide task-supply is already thin even homogeneously, so this is one-day-to-wire-IF-needed, not a gap. `/l4` homogeneous is the value path.
- **Effort**: S (wire existing rails) — only if the trigger fires.
- **Source**: 2026-06-23 `docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).

### Leaf-level output compaction for dispatched implementer / qc shell commands (rtk-style)
- **Trigger**: next time a `/l4` / `/l5` foreman or a `quality-pipeline` / `qc-panel` sub-agent's context bloats from raw shell output (full `git diff`, full `pytest`/`vitest` runs, linter dumps) — i.e. a concrete in-the-wild "the leaf agent burned its budget on tool output" observation, OR a user ask to wire token compaction.
- **Context**: 2026-06-23 survey of two token-saving projects — **headroom** (`headroomlabs-ai/headroom`: ML/Rust compression *proxy*, 60-95%, wrong category — a whole product, not a pattern to re-port) and **rtk** (`rtk-ai/rtk`: single Rust binary, 60-90%, filters command output *before* the LLM sees it: failure-only test output, `git diff --stat`, per-class truncation caps (errors:20/list:20 + single `[N more]` marker), linter `--format=json` first, smart structural file truncation). The portable, native, stdin-free win is to bake **rtk's filtering discipline into autopilot's OWN leaf commands** — the implementer/qc shell calls — as compact-by-construction script wrappers (autopilot already does this for `diff-scope-report.sh` / `verify-preexisting.sh`; the gap is the noisy raw commands the dispatched agents still run). autopilot's structural lever (sub-agent context isolation — only the verdict returns to depth-0) is orthogonal and already in place; this is the葉節點 complement.
- **Two adoption paths, both with caveats (spiked 2026-06-23, CC 2.1.186)**:
  - **rtk-transparent (PreToolUse hook that rewrites `git status`→`rtk git status`)**: ✅ **WORKS on 2.1.186** (corrected 2026-06-23 — the earlier "broken" claim was wrong). rtk's `rtk-rewrite.sh` reads `INPUT=$(cat)` = **fd 0**, which is delivered; e2e-verified — a `git log -8` was transparently rewritten to `rtk git log -8` and the model received the compressed output. Gotchas: the hook subprocess needs `rtk` on PATH and `rtk-rewrite.sh` executable.
  - **rtk-CLI (explicit `rtk <cmd>` calls)**: also works; rtk **now installed** at `~/.local/bin/rtk` v0.42.4 (prebuilt musl, no cargo build needed).
- **⚠️ MEASURED ROI (don't oversell — `scripts/` transcript scan, 2026-06-23)**: across 46 autopilot sessions, rtk's **safe-addressable** slice (git log/status/ls/grep/test) is only **~13% of tool-output / ~11% of total context**, ≈ **3K tok/session** — and it's all cheap **input** (≈ noise in $ terms, esp. under prompt caching). rtk's headline "60-90%" is **per-command** (real: `git diff` measured 74%) but those commands are a small fraction of real context; the bulk is Read/Edit/Agent results rtk can't touch (or only lossily). rtk's diff compression is **lossy** → must NOT feed the **reviewer's** line-level diff. Real value is **context-window headroom in long `/l4`/`/l5` autonomous runs**, not $ savings.
- **Recommendation**: rtk is a **context-window tool for long autonomous runs, opt-in only** — not worth default-on for interactive sessions (ROI too thin). Prefer building rtk's *filtering discipline* (failure-only tests, `git diff --stat` for orientation) into autopilot's own script wrappers over a runtime dependency. **Never** route the reviewer's diff through it.
- **Effort**: S (per-command compact wrapper, e.g. a `git diff --stat`-first reviewer feed) — scope to the one command that actually bloats first, don't build the whole rtk surface speculatively.
- **Source**: 2026-06-23 `/next` follow-up — user-requested survey of headroom + rtk; two Explore-agent technical reports + same-session spike (rtk not installed, CC 2.1.186, intent `last_tool_source:"transcript"` confirms transcript-pivot ≠ stdin, zero live PreToolUse hooks).

### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09 對抗性重攻實測兩條可靠（5/5 PASS）exploit：N2（t15）——撈出真 `NONCE` 偽造 token 且從不呼叫注入的 `compute_fn`，fidelity 與 cache 軸皆假過；N2'（t17）——重同步 purity 檢查區塊的 `snapshot` 局部變數，一邊 mutate 一邊讓 `snapshot == recs` 恆真。R2 硬化（4 條 planted-file/env/stdout 攻擊）已修好且仍成立，但這條 in-process introspection 類別是**架構性**盲點，不是 R2 修復範圍。真正封死需要候選函式呼叫跑在與判分器分離的 subprocess/interpreter（process isolation），對映 `check-test-integrity.sh` L1 block-mode 在 CLAUDE.md 已記錄的同一結論（no local-only same-process mechanism 對抗同帳號候選碼是防偽的）。
- **Effort**: L（redesign，非修補）。
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/_archive/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。

### First local runner capability semantics（availability/load，不是 quota）
- **Trigger**: 第一個 local runner（例如 ollama 類）接入 capability-state producer。
- **Context**: named endpoint identity 與獨立的 local-deployment availability/load observation schema 已實作；剩餘工作縮為第一個真實 local runner 的 observation→capability-state producer bridge。不得把現有 metered quota enum 套到 local source class。
- **Effort**: S。
- **Source**: 2026-07-14 status CLI design + 2026-07-31 code audit。

### broader shared-config containment / per-worktree isolation（2026-07-17, follow-up）

- **Trigger**: when a dispatched worker poisons a non-identity shared `.git/config` key
  (e.g. `core.hooksPath`, `credential.helper`) or when multi-worktree concurrent dispatch
  needs stronger isolation than emit-time restore.
- **Context**: v2.32.51 identity rail contains ONLY `user.name`/`user.email` (local scope).
  Other keys in the shared `.git/config` remain uncontained. Candidate directions: snapshot/
  restore a broader key denylist, or per-worktree config isolation via
  `extensions.worktreeConfig` so a worktree cannot write through to the shared config.
- **Accepted limitations of the current rail** (do not re-litigate as bugs of v2.32.51):
  1. Drift compare is **point-in-time** at emit — a worker that sets a bad identity, commits
     with it, then restores the original before exit is undetected on its own worktree commits.
  2. An **escaped descendant** could re-poison the shared config after emit-time restore
     (containment is teardown hygiene, not a malicious-worker boundary).
- **Effort**: L (design + isolation semantics).
- **Source**: 2026-07-17 U1b panel findings remediation on identity-containment port.

<!-- autopilot-follow-up:fd4e5ef9e4a86709fb80a378b69cc780160e2e9701d83472daf5f7a8fc16cd64 -->
### Durable merge execution crash recovery
- **Trigger**: When a caller-owned durable merge receipt directory and recovery authority are standardized.
- **Context**: A process crash after one ordered merge edge can lose the in-memory aggregate receipt; P3 intentionally omitted a WAL because its frozen contract supplied no storage-path authority.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0; p3-risk

<!-- autopilot-follow-up:9cc8a47d292bb3f8ad6d8182f7199566e000a2e99aefe54bb9af469652871b0d -->
### Bind dirty content continuity from preflight to execution
- **Trigger**: When merge preflight schema v2 is designed or a consumer requires cross-phase content-continuity proof.
- **Context**: P3 detects content drift after execution starts, but cannot prove preserved bytes are unchanged since P2 issuance because the P2 receipt binds path categories rather than content/index digests.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0; p3-risk

<!-- autopilot-follow-up:bedd809a7d1d5a413e90813c5902beba396099a1588e47494ba3cb9876d8bd7d -->
### Recover stale backlog admission locks safely
- **Trigger**: When a backlog admission is interrupted or the lock directory exists without a live owning admission process.
- **Context**: Backlog admission correctly fails closed on a held lock, but an uncatchable process crash can leave the lock directory behind and block all later admissions until manual recovery.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0; qwen-p4

<!-- autopilot-follow-up:7b5ad93159eca2090d4069fee65229da2c5e91b3aa5087e3fcff67a3f3c6d8c2 -->
### Controller helper API fail-closed hardening
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before these helpers are reused outside the current production Engine call sites or exposed to caller-supplied state/evidence.
- **Context**: Close the helper-level fail-open edges recorded as CED-N01, CED-N02, CED-N03, CED-N05, and CED-N06: require explicit spend projection, preserve/reject empty controller replacement, require repository authority, reject traversal internally, and make test evidence carry production-equivalent binding.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1e3cafc6b25e4ccde534f237ecac97b66953f2c76b2d56df8a77993b916fd69 -->
### Boundary outcome and root dispatch semantics
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before boundary receipts drive automated recovery or parallel independent graph nodes under one root are enabled.
- **Context**: Derive or remove mutation_failed/unknown_status instead of hardcoding them, and decide whether root-wide nonterminal exclusion is intentional; if not, retain root CAS while scoping dispatch blockers to the exact graph node.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:ecc22ecefe311bf8a185548841308087b4c6c96cf2b73b3ca14471c005ba7bc5 -->
### Portable byte and Work Order lifecycle hardening
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before Mission paths may contain symlinks, generic Work Order imports are accepted, or reconciliation runs on restricted process-table platforms.
- **Context**: Unify symlink byte hashing with Git, reject/strip disposition_receipt on non-stale records, and convert PROCESS_TABLE_UNREADABLE into an explicit fail-closed Work Order classification.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d1d21b3988f6e89eff3964a1e5e56f12171fd4d3cf50b23634364d087380df26 -->
### Durable resume and review authority binding
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before automatic durable resume, reviewer roster rotation, seat retry, or more than one candidate per repair generation is enabled.
- **Context**: Make all durable stop payloads pass verbatim resume validation, bind full-diff barriers to the exact candidate and review kind, and include sealed reviewer roster/seat identities in full-diff and joint-review reuse keys.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

### Mission graph and campaign capacity boundary hardening
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before graph hot reload/concurrent writers or caller-supplied non-default campaign capacities are supported.
- **Context**: Read Mission graph bytes once or bind the validation read to the inspected digest, and mirror max_owned_worktrees/temp_capacity_limit/max_prompt_bytes/max_finding_recurrence schema caps in the executable validator.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:d574960cb87250d45554901630cdff86ddfd59f5d313a40e657bf7de3f7b7be3 -->
### Orphan leaf liveness and resource reconstruction
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before orphan adoption or resource inventory is used as closure/capacity authority after controller or worktree-creation crashes.
- **Context**: Persist and re-observe leaf process identity before orphan adoption; discover orphan branches and never-registered worktrees; mechanically re-derive active inventory rows.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:516726d963e606a0bf2ec621ad6962a0228863ff976a64a703be7bbd2d4a598d -->
### Terminal status and receipt trust boundary
- **Status**: CONDITIONAL — retained post-merge follow-up；trigger 尚未成立，no active implementation worktree。
- **Trigger**: Before external/legacy terminal receipts cross a trust boundary or the threat model expands beyond confused controllers.
- **Context**: Enforce the closed terminal_status enum at receipt validation and Work Order classification, resolve the unused attached disposition, and document integrity-hash versus producer-attestation guarantees under the confused-controller threat model.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b

<!-- autopilot-follow-up:8f70c159902a5d75d701b775ac9378f53ec4e9380a2534cab6674bf06083d475 -->
### Shared sealed zero-diff validator
- **Trigger**: When the zero-diff schema next changes or a fourth production consumer is introduced.
- **Context**: Move sealed zero-diff receipt validation into one deterministic shared helper consumed by shell, Engine, and runner boundaries.
- **Effort**: S（re-estimate under the new ticket contract）
- **Source**: depth-0-adjudication-760b
## engine implement-review：verify_pass=false 非阻塞、可在 reviewer SHIP 下收斂
- **Context**: 2026-07-24 codepower /l6 P0a run（foreman-p0a-1784819842）兩度實測：U3 與 qc-fix round 的全部 verify_round 皆 `verify_pass:false`，loop 仍以 reviewer SHIP-AS-IS 收斂並回報 committed。實際缺陷（AppSurface class TS2322、AppButton disabled bg、8 個測試紅）全靠 foreman 自驗第二層攔下。root cause 候選：verify-first wiring 只在 roster 發 `verify_first:true` 時 gating，未發時 verify 結果純 telemetry。**Fix 方向**：loop 收斂條件改為 `reviewer SHIP ∧ (verify_pass ∨ verify 缺席原因白名單)`，verify 紅=強制 rework round；至少在 run summary 對 `verify_pass:false + converged` 發 WARNING。
- **Trigger**: 下次動 engine implement-review 收斂邏輯或 resolve-review-loop verify 欄位時。

## engine implement-review：campaign-contract fresh 路徑 Work Order 自鎖（codepower /l6 P4 實測）
- **Context**: 2026-07-31 codepower P4 foreman（p4-foreman-20260731）：`engine implement-review --campaign-contract` 在 `dispatch_implementation` 確定性回 `continuation admission: reconcile receipt is required`，`leaf_runs.total=0`。根因 `src/engine/autopilot-engine.js` ~3494-3541（blame 全屬 `d151f202` Work Order v2）：campaign contract ⇒ durable ⇒ `createWorkOrder=true`，`hasActiveRootWorkOrders` 枚舉到自建/殘留 nonterminal controller WO ⇒ `missionActive` ⇒ `requireReconcile` ⇒ fresh campaign 被要求 PostCompact reconcile receipt。八項合法解法窮盡（含 3 個全新 campaign id、乾淨 `AUTOPILOT_DISPATCH_RUNS_DIR`、`compaction-rehydrate reconcile` 鑄 receipt → `durable campaign already exists` → `campaign resume` → `campaign_state_lease_open` 死巷）。**無 work-order list/dispose CLI 可清殘留**。當次以 pin v2.32.57-era（`349e2420`）engine 繞過續跑。
- **Fix 方向**: (a) fresh-create 路徑排除自建 WO 於枚舉外或同 run 自動鑄 receipt；(b) 提供 work-order 檢視/處置 CLI；(c) `campaign_state_lease_open` 的 lease 釋放路徑。
- **Trigger**: 下次動 continuation admission / Work Order lifecycle 時。

## codex live-spend probe 必須 `--model` 指定 roster implementer（per-model quota pools 假綠燈）
- **Context**: 2026-07-31 codepower P4 U2 實測：probe 用 codex CLI 預設模型（gpt-5.5）回 PROBE_OK，實際 dispatch 的 `gpt-5.3-codex-spark` 池已 rate_limited → dispatch 跑 342s 中斷、產物 broken-by-construction（registry 註冊了 4 個不存在的 loader）。`status --help` 明寫 quota 是 per-MODEL pools——不帶 `--model` 的 probe 驗不到 dispatch 會用的池。既有 capability 成功先例（2026-07-30 16:00 foreman-p15b）同樣未帶 `--model`，此洞是繼承性的。
- **Fix 方向**: probe SOP 與 capability 記錄格式強制 `--model <roster implementer_engine>`；engine dispatch 前的 preflight 亦同。
- **Trigger**: 下次動 live-spend probe / capability 記錄 / engine preflight 時。
### HETO task-return detection can miss completed work
- **Trigger**: A second reproducible case where a completed HETO task produces no return event/notification, or before another HETO return-consumer is added.
- **Context**: The controller can remain waiting when HETO has completed a dispatched task but the return detector does not fire; inspect event names, buffering/flush, timeout, and terminal-state reconciliation without treating silence as success.
- **Effort**: S–M
- **Source**: user-reported intermittent missed HETO return detection (2026-08-05)

### No route for external field experience contributed INTO autopilot itself
- **Trigger**: A second instance of a lesson learned while *using* autopilot on another project that
  belongs in autopilot's own skills/references and has nowhere to go. n=1 today (2026-08-24: the
  knowledge-routing fix set), so this is recorded, not built.
- **Context**: `learn` records facts/gotchas into `.claude/knowledge/`; `distill` produces reusable
  procedures and **explicitly never targets autopilot** (its description says so). Neither routes a
  field-experience finding into autopilot's own `skills/` or `references/`. Today that path exists
  only as a human noticing and hand-authoring it — the same "habit, not policy" gap
  `references/knowledge-routing.md` was written to close for the disclosure line.
- **Effort**: S (a `references/` row in `learn` may already be enough; a new skill is not justified at n=1)
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)

### `peer-coordination` skill — ruled in, blocked on a spike sweep
- **Trigger**: The R5 spike list below comes back with dated, per-machine results. Do not author the
  skill before that — its whole subject is harness capability, and shipping unverified capability
  claims is the defect `references/knowledge-routing.md` §6 exists to stop.
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has
  no entry for a **peer** — an agent this session did not dispatch, does not control, and that may
  not be Claude. Two heterogeneous seats over two rounds ruled: a thin skill (routing entry only) plus
  **two** references — `peer-channels.md` (capability matrix, audience = local session) and
  `peer-contract.md` (the fill-in division-of-labour template, audience = the peer or its operator,
  and the only artifact handed across the boundary). `references/` cannot be selected by skill
  routing, which is why a skill is needed at all. Route key must be the authority relationship, never
  brand or tool names — `grok`/`tmux`/`ListAgents` as triggers collide with `team`, `l3`–`l6` and
  `engine-onboarding`. Ruling detail is in machine-local memory (`peer-coordination-skill-ruling`).
- **Spike list (none of these may be asserted without a dated result)**: which harness versions expose
  the native peer enumeration; whether every enumerated target is actually reachable by the paired
  send tool; whether reported pane addresses survive a peer restart; what the MCP relay lane provides
  that the native lane does not; `pgrep` identification accuracy per non-Claude CLI; whether file-drop
  is really reachable by "any agent" (pickup convention, atomic write, cross-worktree visibility).
- **Design constraint discovered while drafting**: reach is a property of the **environment**, not of
  the channel — the same enumeration lists 38 targets on one machine and local-only on another. Every
  matrix row therefore needs a **verified-on-machine** column beside its verified-date, or the next
  reader will take one host's topology for a channel capability.
- **Effort**: M (skill is thin; the two references and the spike sweep are the work)
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel

## 2026-08-28 foreman cost is the polling loop, not the model (revival.3d session 5ca9b104)

Evidence (grok cost split, `revival.3d/NOTE-FOR-FABLE-FOREMAN-COST.md`): 30 opus foremen, 28 of them
burned more usage than all their sonnet leaves combined (foremen 227M vs leaves 130M). Foreman tool
mix 3971 Bash / 337 Edit — almost no code; the Bash is `sleep 240` polling + `cat <leaf>.output` fed
back into the foreman context. Every wake is a full-price inference on a 200–500k prompt. Switching
the foreman role to sonnet (`model-routing-config.md`, 2026-08-28) only lowers unit price; the loop
remains.

Two items:

1. **Foreman must not be a polling model.** Waiting has to be inference-free: the canonical foreman
   for /l4–/l6 should be a `Workflow` script (deterministic fan-out, zero turns while leaves run) or a
   `run_in_background` + notification wake. Add a gate: a sub-orchestrator transcript with
   `sleep` in a loop, or `cat`/`tail` of a child output file into its own context, is a red-line
   violation. Leaves return a schema-typed criteria table; their raw output never enters the
   foreman prompt. → plan 2026-08-28 (`docs/plans/2026-08-28-foreman-no-polling.md`).
2. **Implementer ladder by unit class, not one seat.** → plan 2026-08-28
   (`docs/plans/2026-08-28-implementer-ladder.md`). `review-loop-config.md` has a single
   `implementer_engine`. Add `implementer_ladder: gemini-3.7-flash-low → grok-4.6/low → sonnet`
   with two triggers: contract field `unit_class: mechanical|judgment` picks the starting rung; a
   red repair round climbs one rung; top rung then enters `awaiting_convergence_adjudication`
   (existing). `on_engine_unavailable` stays availability-only. Sample: revival.3d AF
   (wizhall-mega 058 migration) — brief fully pre-resolved, flash-low one-shot, 5 files correct.
   Adjudication (BLOCKED) stays on opus/fable via `tree:judge`.

- **check-foreman-polling bash_cap=40 ground truth (2026-08-28, peer aimax395)**: a real /l4 foreman
  that runs the hetero review loop scored sleep_loop=0 / leaf_output_reads=0 / bash=126 — the two
  toxic patterns absent, red only on bash_cap, because endpoint load / roster / test execution all
  go through Bash. Tune: make the cap configurable per level, or exclude Bash calls that invoke
  autopilot's own scripts (`dispatch-review.sh`, `resolve-review-loop.sh`, `node --test`) from the
  count. Keep sleep_loop and leaf_output_read as the hard reds.

## 2026-08-29 dispatch residue governance: mechanism in autopilot, declaration via project DI

Evidence: revival.3d 2026-08-28 — 40 dispatches left 35 `.vite-<tag>` caches, 625 root-owned Chrome
udd dirs (238 MB+), 118 `/tmp/rw3d-*`, and 5 live Chromes holding 5.7 GB on GPU1 that killed the next
line's WebGPU context. Owner: "治理你自己每一輪生產的垃圾要系統化". The project shipped
revival.3d's `lab/reap-run.mjs` (under its own `scripts/`; `--tag/--check/--all-stale/--self-test` + hourly user timer) as a stopgap
adapter; ruling: the **mechanism belongs in autopilot**, the project only declares what counts as residue.

Split:
- **autopilot (mechanism)**: tag-is-ownership naming contract (worktree dir, branch `l6/<tag>`, any
  file/dir/process the leaf creates carries `<tag>`); `reap --tag` at the end of every merge; `--check`
  gate before dispatching a resource-bound line; `--all-stale` timer; receipts merged into
  `LifecycleResidueReceipt.zero_residue` (today it only counts worktrees/branches —
  `reap-dispatch-worktrees.sh`/`reap-dispatch-branches.sh`); self-test harness that injects fake residue
  incl. root-owned dirs; whitelist semantics (never touch non-`l6/` branches, foreign worktrees,
  `/tmp/claude-*`, flock-held tags).
- **project DI** `.claude/residue-config.md` (draft fields): `kinds[]` each with `glob` (with `<tag>`),
  `owner: self|root` (needs `sudo -n`), `process_match` (cmdline substring with `<tag>`, exact per-pid —
  **never `pkill -f`**, leaves' briefs live on argv), `port_from` (file glob + regex), `stale_after`,
  `whitelist[]`; plus `resource_check[]` (e.g. `nvidia-smi` GPU index + mem threshold).
- Leaves are not trusted to clean up ("已收" was false 3× on 2026-08-28); they only owe correct naming.

Reference impl to absorb: revival.3d's `lab/reap-run.mjs` (under its own `scripts/`) + `docs/governance/dispatch.md`
"派遣殘留物治理".

## 2026-08-29 qualification run.sh templates baked an invalid effort enum

Evidence: `docs/plans/evidence/2026-08-28-consult-discuss-qualify/administration/`
seat6 (agy) and seat3 (cc-shim) `run.sh` scripts set `EFFORT` to a free-text placeholder
(`"baked-in-model-name"`, `"default"`) instead of a value in `engine-scorecard.js record`'s closed
enum (`none|low|medium|high|xhigh|max`), which blocked scorecard recording until corrected to
`"high"` (receipt-only — matches kimi/grok's convention for the same transport class; the CLI
never receives this value). Future qualification `run.sh` templates for effort-less transports
(agy, cc-shim/QRP, and any other transport whose CLI takes no `--effort`) should default straight
to a valid enum value (`"high"` or `"none"` per `engine-scorecard.js`'s own documented convention),
never an ad hoc descriptive string.

### Managed-campaign controller cannot record `BOUNDARY_REJECTED` — lease-fenced by its own synthesized stage identity
- **Trigger**: any `engine implement-review` campaign whose implementer commit is boundary-rejected (unauthorized output path / diff cap) — reproduced 2026-08-29 (`campaign-v1-3b6a9770…`, replayed through the real reducer).
- **Context**: `src/engine/autopilot-engine.js:6477` writes composition events with `controller-<event>:<gen>` stage identities; `src/engine/implementation-campaign.js:886/738` lease-fences `BOUNDARY_REJECTED` (and `AWAITING_CONVERGENCE`, `:971`) against `live_lease.stage_identity` (`campaign-mutation:0`), so the rejection is unrecordable, the journal strands at `IMPLEMENTING` with a held lease, controller durable state diverges (`boundary_rejected` vs journal `IMPLEMENTING`), and neither `--resume` (`campaign-intake.js:780 campaign_state_lease_open`) nor a repair round nor terminalization is reachable. The terminal path already uses the real lease identity (`:2756`) — do the same for lease-releasing bridge events; regression test: IMPLEMENTING + boundary rejection ⇒ `BOUNDARY_REJECTED`, never `LEASE_FENCED`.
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1-20260829T1804Z campaign attempt 2; debugger replay 2026-08-29.

### `dispatch-author.sh` success predicate is "non-empty stdout" — truncated / tool-narrating output reports `authored`
- **Trigger**: already fired twice (2026-08-29, qoderclicn/Qwen3.8-Max-Preview: a 100-byte preamble ending at `[` and a 130 KB mid-file draft with 36 text-form ```` ```tool ```` fences both returned `status:authored`, exit 0, `final_status:null`).
- **Context**: header line 102 / `emit_result "authored"` at :1222 treat any bytes as an artifact. Needs a positive completion check (declared terminal marker, `bash -n`/parse for the declared kind, zero tool-fence narration) and a `truncated` status; manifests also record `parent_run_id/root_run_id: null, depth: 0` despite exported lineage.
- **Effort**: S
- **Source**: l6-verdict-stability-p1 attempt 1 (author-1788027293-2263145, author-1788027402-2269364).

### Verification-author seats on agy / cc-shim / anthropic-compatible are structurally NO-GO under the exact-tuple quota gate
- **Trigger**: next time a VA seat other than codex/grok/qoderclicn is configured (GLM-5.3@anthropic-compatible is VA-qualified, event 142, yet unroutable on 2026-08-29).
- **Context**: `dispatch-contract.js` always queries capability state with `--effort <resolver effort>` (and `withResolverConfig` injects `verification_author_effort: high` when absent), but `probe-engine-capability.sh` refuses to observe an effort-bearing tuple for runners that do not consume `--effort` (agy carries effort in the model name; cc-shim/anthropic-compatible have none) ⇒ `quota: unknown` ⇒ NO-GO forever. Either the checker must query the effort-less partition for those runners or the probe must observe it.
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1 roster rotation 2026-08-29 (commits 8d6f8786, 83d993a5).

### No supported withdraw for a never-granted DRAFT Mission adoption; graph revisions mint unbounded lineages
- **Trigger**: next time a frozen execution graph must be revised before or between grants (three adoptions now exist for `qualification-verdict-stability`: 2e784929 DRAFT, 83828e5e ACTIVE with an unreleasable live claim, 420ac261 current).
- **Context**: `mission prepare` binds the adoption key to {repo_identity, intent, acceptance hashes} (`src/engine/mission-policy.js:195-233`) and pins the graph digest; revising the graph re-derives the same key and fails `MISSION_BINDING_MISMATCH` (`src/mission/runtime.js:781-787`). `successor` needs a terminal source and re-runs the same graph (`:902-907`, `:952`); `rollover` needs COMPLETE. The only way forward is perturbing the intent (graph digest folded into `requirements_hash`, commit 5402cbd5). Add `mission withdraw --prepared <receipt>` refusing unless zero claims and zero events; also a release path for a claim whose campaign was killed mid-flight (attempt-3 claim c434b7f9 stays live).
- **Effort**: S
- **Source**: mission-lineage authoring 2026-08-29 (commits 0279dccc, 5402cbd5, 500703b1).

### `hooks/tests/run.sh` is red on `develop` — sealed campaign `verify_cmd` is unsatisfiable
- **Trigger**: already fired (salvage campaign `campaign-v1-e9bcae52…` `acceptance_failed` on `bash hooks/tests/run.sh` with a byte-identical cherry-pick; seven suites red on base 500703b1: codex-plugin-package, execution-profile, mission-terminal-rollover, next-touch-validation, provider-readiness-consumer, qualification-review-provider, resolve-review-loop [timeout]).
- **Context**: every Mission node inherits the six-command chain as `verify_cmd`, so any campaign on this base fails acceptance regardless of the candidate. Triage the seven (environmental vs real regression), then either fix `develop` or make the graph's `verification_commands` name the suites the node actually touches.
- **Effort**: L (triage) — blocks every managed campaign on this repo until done.
- **Source**: l6-verdict-stability-p1 salvage campaign 2026-08-29.

### Campaign bridge resolves lease identity from `campaignControl.initial_state` — correct today only because every append refreshes it
- **Trigger**: any change to `recordCampaignEvent` / the campaign event appender that stops assigning `campaignControl.initial_state = appended.state` (`src/engine/autopilot-engine.js:~4557`), or a second appender path that bypasses it.
- **Context**: `onCampaignEvent` (`autopilot-engine.js:~6487`) calls `resolveCampaignEventLeaseIdentity(campaignControl.initial_state, …)`; the field name says "initial" but it is the live journal-replayed state because the closure refreshes it on every append. Two reviewer seats flagged the naming as a latent no-op risk (rail-fix qc, 2026-08-30). Rename to `live_state` (or read from the journal replay) and add one end-to-end fixture that drives BOUNDARY_REJECTED through the real bridge after IMPLEMENTATION_STARTED.
- **Effort**: S
- **Source**: rail-fix qc panel 2026-08-30 (gpt-5.6-sol 🟠 downgraded after verification; GLM-5.2 🔵).

### `hooks/tests/run.sh` TIMEOUT marker collides with a suite that self-exits 124/137
- **Trigger**: a suite observed to exit 124/137 on its own (e.g. propagating a child's SIGKILL) shows as `[TIMEOUT]` in the summary.
- **Context**: `is_suite_timeout_ec` treats any 124/137 as the wrapper's timeout. Still counted FAILED (fail-closed), so cosmetic; distinguish by checking elapsed ≥ the ceiling, or by having `timeout` write a sentinel.
- **Effort**: XS
- **Source**: rail-fix qc panel 2026-08-30 (GLM-5.2 🔵).

### Killed/dead managed campaign stuck at IMPLEMENTING with a held lease has no operator remedy
- **Trigger**: already fired three times 2026-08-29/30 (campaigns `3b6a9770…`, `d240ef14…`, `e9bcae52…`): leaf died (wall cap / host kill / acceptance failure before terminal journal), journal holds `live_lease`, `--resume` refuses with `campaign_state_lease_open` (`src/engine/campaign-intake.js:780`), `IMPLEMENTING` is not a resumable phase, and the Mission claim stays live forever (three such claims now sit in the registry).
- **Context**: add a bounded, evidence-gated terminalization for a campaign whose leaf run is provably dead (leaf manifest ended, pid gone, worktree reaped) that appends `MUTATION_FAILED` with the live lease identity and releases the Mission claim; never a silent no-op.
- **Effort**: S–M
- **Source**: l6-verdict-stability-p1 campaigns 2/3 + salvage, 2026-08-29/30.
- **Status**: shipped in U1 (branch `u1-terminalize-withdraw-20260831`) — `node bin/autopilot.js campaign terminalize --campaign-id <id> --leaf-manifest <file> [--ledger <file>]`.

### `mission grant` silently replays a stale claim when the node holds an open `active_claim_id` — SHIPPED in U4 (branch `u4-grantblock-20260831`)
- **Trigger**: already fired 2026-08-30 (lineage 420ac261, node `qualification-verdict-stability`): with attempt 1's claim still open, `mission grant` returned `status:"replay"` with attempt 1's contract — a `base_sha` two merges behind `develop` and an already-consumed branch — instead of refusing.
- **Context**: the idempotency key resolves to `graph-node:<id>:attempt:<n>` while `active_claim_id` is set; nothing tells the caller the attempt cannot advance. Surface `attempt_blocked_by_open_claim` (with the claim id and its campaign state) or refuse outright — a replayed stale contract is a false green in the evidence-discipline sense.
- **Resolution**: the bug was not in the reducer (`src/engine/mission-convergence.js`'s `graphGrantContext` already refuses a *new* attempt correctly — `graph-budget-one-different-idempotency-rejects` in `hooks/tests/mission-convergence.test.sh` proves it) — it was `src/mission/runtime.js`'s `grantMissionCampaign`, which short-circuited to a silent replay of any open claim BEFORE ever calling the reducer. Fixed by comparing the open claim's `base_sha` to the current repo HEAD: unchanged HEAD still replays (preserves `cli-grant-exact-replay`, `hooks/tests/mission-runtime-v2.test.sh:539`); a moved HEAD refuses with a structured `attempt_blocked_by_open_claim` payload (claim_id + campaign_id) surfaced as JSON on stdout with a non-zero exit via `mission grant`'s CLI (`src/mission/cli.js` `cmdGrantV2`). The reducer's own `rejection()` path was deliberately left untouched — it terminalizes the whole Mission lineage, wrong blast radius for a routine "attempt already open, please withdraw" refusal. Covered by `hooks/tests/mission-grant-open-claim.test.sh` (new) and a `withdraw-interplay-*` block in `hooks/tests/mission-convergence.test.sh` proving refuse → `mission withdraw` (U1's verb) → next attempt succeeds.
- **Follow-up filed** (not blocking, orthogonal): `mission withdraw`'s campaign-ledger binding assumes an ICC `campaign-v1-...` id; a `mission-subject-v2` claim's `campaign_id` is `campaign-v2-...` and cannot resolve against a real ICC ledger under the current `projectCampaign`/`validateInitialCampaignState` contract, so `mission withdraw` cannot release a v2-identity claim (the kind `grantMissionCampaign` always mints) against a real campaign today. Discovered while building this fix's withdraw-interplay fixture, worked around there by using a legacy (non-v2) identity claim; the mismatch itself needs its own fix.
- **Effort**: S
- **Source**: phase-2 foreman escalation, 2026-08-30.

### No operator-level release for a claim whose campaign died without a terminal receipt (second instance)
- **Trigger**: already fired again 2026-08-30 — depth-0 had to emit `no_effect_release` through the reducer module API (`reduceMissionState`) on the local state file (backup taken) because `mission control` exposes only `finish_requested|abort_requested|scope_frozen|ceiling_adjust` and intake's automatic `pre_spend_no_effect` path is unreachable once a leaf ran.
- **Context**: pairs with the existing "Killed/dead managed campaign stuck at IMPLEMENTING" row: the fix must release BOTH the campaign lease (MUTATION_FAILED with the live lease identity) and the Mission claim, gated on provable leaf death, and be reachable from `mission`/`campaign` CLI without raw state plumbing.
- **Effort**: S–M
- **Source**: phase-2 foreman escalation + depth-0 operator action, 2026-08-30.
- **Status**: shipped in U1 (branch `u1-terminalize-withdraw-20260831`) — `node bin/autopilot.js mission withdraw --state <file> --out <file> --claim-id <id> --campaign-ledger <file>`, refuses `mission_withdraw_campaign_not_terminal` until the bound campaign is terminal.

### A managed campaign whose wall expires leaves no terminal summary and no journal disposition
- **Trigger**: already fired twice 2026-08-30 (campaigns attempt-3 `d240ef14…` and `…a3` D5): the leaf committed, `max_wall_seconds` (3600, schema max) elapsed before the review round, the `engine implement-review` process ended with a 0-byte stdout, and the campaign sits at `phase=IMPLEMENTING, activity=dead, wall_seconds_remaining=0` with a held lease and a live Mission claim.
- **Context**: wall expiry must journal a wall-expiry disposition (MUTATION_FAILED-class with the live lease identity, or a resumable-wait phase if repair generations remain) and always write the summary JSON; a foreman reading an empty file cannot tell a kill from a crash. Pair with a `campaign resume`/`terminalize` verb for an `activity=dead` campaign with repair generations remaining — the artifact was complete and reviewable, only the controller was stuck.
- **Effort**: S–M
- **Source**: phase-2 foremen (D4, D5) 2026-08-30.

### 3600 s wall cap is the schema maximum and too small for an implement+review campaign on a real deliverable — SHIPPED in U3 (branch `u3-wallcap-20260831`), ceiling 14400 by CEO decision 2026-08-31
- **Trigger**: any deliverable whose implementer alone needs > ~40 min (D1–D3, D4, D5 all did: 42–55 min grok-4.5 runs), leaving no wall for the review round.
- **Context**: `schemas/mission-execution-graph.schema.json` caps `campaign.max_wall_seconds` at 3600 and `max_engine_attempts` at 3. Either raise the schema ceiling (with governance `max_wall_seconds` still the aggregate bound) or make the wall cover implementation only and give review rounds their own budget. Until then every real campaign closes through the depth-0 salvage path.
- **Effort**: S (schema + one test) — but a governance decision.
- **Source**: phases 1–2, 2026-08-29/30.

### Qualification recipes seed staged credentials only when the staged file is absent — rotating OAuth runners reuse stale material
- **Status**: shipped in U2 (branch `u2-staging-20260831`) — `scripts/lib/qualify-stage-credentials.sh` reseeds credential files by sha256 stamp (mismatch => reseed) and `plan` mode refuses on drift; all 14 `docs/plans/evidence/*/administration/*/run.sh` recipes migrated identically; covered by `hooks/tests/qualify-recipe-credential-staging.test.sh`.
- **Trigger**: already fired 2026-08-30 (D7): kimi and grok seats returned 240/240 `provider_process_failed` each (480 case attempts, ~1600 s) because the `if [ ! -f <staged> ]` guard kept 2026-08-29 credentials while the live ones had rotated; codex/cc-shim/agy were spared only because they do not rotate.
- **Context**: every `run.sh` under `docs/plans/evidence/*/administration/*/` copies this block. Seed unconditionally (or stamp the staging dir with the source file's sha256 and reseed on mismatch), and make `plan` mode compare staged vs live hashes and refuse when they differ. The harness rule correctly refused a verdict, so no capability row was polluted.
- **Effort**: S
- **Source**: D7 administration ledger 2026-08-30.

### `engine-scorecard.js current/seat-status --require-evidence` cannot be run standalone
- **Trigger**: next time an operator wants the strict admission projection for a live seat (it exits 2: `--require-evidence or --identity-file requires --scope-file`).
- **Context**: the strict path needs a caller-supplied applicability scope file; there is no helper that derives the canonical scope for a role, so foremen fall back to the non-strict `seat-status`. Add a `--role-default-scope` (or print the expected scope JSON) so the strict path is one command.
- **Effort**: S
- **Source**: D7 foreman 2026-08-30.

### `mission withdraw` cannot bind a `mission-subject-v2` claim to its ICC campaign — the intake journals no mission binding
- **Trigger**: any operator calling `mission withdraw --campaign-ledger <real ICC ledger>` on a claim minted by `grantMissionCampaign` (`identity_scheme: 'mission-subject-v2'`) whose campaign DID run; or the next time `campaign-intake.js`'s intake artifact schema is touched.
- **Context**: the claim id is `campaign-v2-<domain sha of the subject>` (`src/engine/mission-campaign-identity.js`); the ICC intake row is keyed `campaign-v1-<sha of repo, ticket, raw contract bytes>` (`src/engine/campaign-intake.js` ~1664) and `createCampaignState` keeps only ticket/profile/limits — no claim id, no `mission_grant_ref`, no subject digest reaches the ledger. **v2.36.6** did NOT close this (a contract-digest bridge was tried and reviewed as inert: subject digest ≠ raw byte digest); it added the never-started exit (`--never-started true`, refused when the ledger holds any intake root for the claim's own ticket — `mission_withdraw_campaign_ticket_present`). Fix shape: journal `mission_claim_id` + `mission_campaign_id` on the intake artifact (`INTAKE_ARTIFACT_KEYS` is exact-keys in both `campaign-intake.js` and `campaign/cli.js`, so this is a schema bump with a compat read for old rows), then resolve by that exact fact and apply the terminal rule.
- **Effort**: S–M (schema bump + two validators + compat + e2e with a real v2 grant fixture)
- **Source**: U4 foreman 2026-08-31; cuda revival.3d QUIET-a 2026-09-06; v2.36.6 pre-merge review (opus) 🔴 C1.

### v2.35.5 qc-panel 🔵 follow-ups (managed-campaign rail debt, 2026-08-31)
- **Trigger**: next touch of the named files.
- **Context**: four Suggestion-tier items from the three-seat panels, all excluded from the ship with rationale: (1) whitespace re-indent churn in `src/campaign/cli.js` ~412-437/598 pollutes blame in the projection path — revert cosmetically; (2) the staging lib's plan-mode refusal (`scripts/lib/qualify-stage-credentials.sh`) is unit-tested but no e2e asserts a recipe `run.sh` exits non-zero under `set -e` when it fires — add one drift e2e; (3) `src/mission/cli.js` mixes module-local `emit()` (cmdWithdraw) and injectable `emitTo()` (cmdGrantV2) — the withdraw-interplay fixture had to monkey-patch `process.stdout.write`; funnel every cmdX through one emission helper; (4) `scripts/run-ledger.sh` non-init subcommands' `--help` prints the whole script source instead of usage (U2 foreman, 2026-08-31).
- **Effort**: XS–S each.
- **Source**: v2.35.5 qc panels + foremen, 2026-08-31.

### `peer-addressing.md` says message rows live forever; a spec says 7 days
- **Trigger**: hangar-bridge implements message-row retention. Today it has not — `packages/relay/src/purge.ts` deletes only `token` and `human` rows, `message` has no trigger or CASCADE, and a repo-wide search finds no `DELETE FROM message` — so the doc's "durably means indefinitely" is currently accurate.
- **Context**: `hangar-bridge/SUBJECT_ROUTING_SPEC.md:516,614` records an accepted 7-day retention/replay bound for subjected `@team` chat that was never built. If it ships, `references/peer-addressing.md`'s persistence paragraph goes stale in the direction that matters — it would be promising permanence that no longer exists.
- **Effort**: XS (one clause), but only correct after the code lands.
- **Source**: `autopilot:reviewer` round 4 on `0d3554e3`, 2026-09-01.


### Plan-loop freeze: dispatcher and checker disagree on disposition shape; terminal artifact carries no dispositions
- **Trigger**: the next plan loop that reaches the generation cap, or any change to `loadDispositionFile` / plan-artifact mode.
- **Context**: `check-phase-review-receipt.js --plan-artifact` requires `disposition` on every artifact finding and `candidate_blocker` on every disposition entry; `dispatch-plan-review.js` writes neither into the terminal artifact and its disposition file has no `candidate_blocker`. Depth-0 bridged with an `adjudicate.js` (applyDispositions + reshaped file) on 2026-09-05. Fix shape: the driver emits `gN.adjudicated.json` when a generation-N disposition file is supplied at the cap, and the checker accepts the driver's disposition shape. Also: post-terminal accept-and-fold always breaks the plan sha; the checker should accept a `--reviewed-plan` copy plus a recorded delta, or the driver should snapshot the reviewed bytes into state.
- **Effort**: Fix
- **Source**: `docs/projects/2026-09-05-statusline-live-context-feed/ledger/plan-review/README.md`

### Live-state base on world-writable tmpfs — ownership/mode check on the reader side
- **Trigger**: autopilot runs on a multi-user host, or a second local user is observed on any fleet host; or the first report of a foreign `/dev/shm/autopilot-<uid>` directory.
- **Context**: v2.36.1 moved `context-budget`/`depth0-gate` state and the codeforge live files under `$XDG_RUNTIME_DIR/autopilot` (0700, safe) or `/dev/shm/autopilot-<uid>` / `/tmp/autopilot-<uid>` (parent `drwxrwxrwt`, name predictable, no pre-existing dir). A hostile local user could pre-create the dir and plant a fresh `context/<sid>.tasks.json` to deny a foreman's Bash (`foreman-guard.js`) or a depth-0 read (`depth0-delegate-gate.js` block mode). Readers check schema/freshness but not owner or mode. Fix shape: create the base with `mkdirSync(..., {mode: 0o700})`; reject a candidate whose `lstat` is a symlink, has a foreign uid, or `mode & 0o077`; same in codeforge `live.rs`. Cut from v2.36.1 (pre-merge review 🟡): shipped target is single-user dev hosts.
- **Effort**: S (both repos)
- **Source**: `docs/projects/_archive/2026-09-05-statusline-live-context-feed/` pre-merge review (opus), 2026-09-05

### live-state-dir 🔵 leftovers — multi-row findmnt, `\040`-only unescape, per-process SSD warning, sub-200k window scaling untested
- **Trigger**: a candidate that `findmnt -T` reports as more than one row; a mountpoint with an escaped character other than space; a host with neither findmnt nor /proc/mounts (macOS, unverified) where the SSD warning is observed once per hook fire; or the next edit to `tiersForKnownWindow`.
- **Context**: the 🟡 items of the v2.36.1 pre-merge review shipped in v2.36.2; these 🔵 items did not. `fstypeViaFindmnt` reads only the first output row; `fstypeViaProcMounts` unescapes only `\040` (not `\011`/`\012`/`\134`); the "falling back to ~/.autopilot" warning is once per PROCESS, i.e. once per hook fire on a host with no probe; a live window below 200k scales tiers DOWN with no test pinning it.
- **Effort**: S each
- **Source**: v2.36.1 pre-merge review (opus), 2026-09-05; carried out of the v2.36.2 row

### context-budget falls back to inference after a long foreground tool call — live tick starves under the 120 s freshness cap
- **Trigger**: the next observed T2/T1 message without "(statusline)" on a host that has the live writer; or before shortening/lengthening `DEFAULT_MAX_AGE_MS`.
- **Context**: observed 2026-09-05 in the v2.36.2 session: a 600 s foreground `hooks/tests/run.sh --parallel` was followed by a `context-budget` T2 at 155k with no "(statusline)" clause, while the live file 3 s later was fresh with `context_window_size` 1000000 (16% used). Hypothesis (unverified — no tick log): the status line does not re-render during a long tool call, so `written_at` exceeded 120 s at hook time and `readLive` returned null ⇒ inference path ⇒ false T2 on a 1M window. Options: (a) the reader keeps the last-accepted window in its state file and reuses it when the live file is stale-but-schema-valid (window size does not change mid-session; only the total does), still taking `contextTokens` from the transcript; (b) a longer freshness cap for the `context_window_size` field only; (c) codeforge writes on a timer independent of the render. Second data point, same session: T2 at hook call 50 right after an `Agent` spawn, no long command before it, live file mtime 3 s AFTER the hook fired (189k of 1M) — the tick looks event-driven and the file can be >120 s old at hook time in ordinary interactive flow, not only after long tool calls. v2.36.2 records `lastLive {at, ageMs, used}` in the `context-budget` state file on every call; read `<live-base>/context-budget/<sid>.json` after the next occurrence before touching the cap. Also from the same review, cut: both `withLock` copies (foreman-guard, depth0-delegate-gate) busy-spin the CPU for up to 2 s under contention — replace with `Atomics.wait` backoff when either hook is next touched.
- **Effort**: S (reader-side option a) / S (codeforge)
- **Source**: v2.36.2 session live observation, 2026-09-05

### Stale `closed_findings` stamps on chain entries written by pre-v2.36.3 finalize have no repair path short of a new generation
- **Trigger**: a second field report of a receipt refused with "attributes … to generation N, which is aborted", or a request to re-finalize without re-collecting.
- **Context**: v2.36.3 made `review-chain-derive` evidence-only (chain-entry `closed_findings` stamps are output, ignored as input) and the checker refuses a receipt whose `closed_findings` names an aborted generation. The stamps the old derive wrote onto chain.json entries stay on disk (deep-equal with the receipt keeps them consistent) and are now inert, but the only way to get a fresh receipt is `collect` + `finalize` of one more generation — `finalize` refuses a generation that is not pending. Fix shape if wanted: `hetero-review-loop.js refinalize --generation <n>` that re-derives from the existing findings/dispositions of a finalized generation and rewrites receipt + stamps, refusing when any finding/disposition sha no longer matches.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066 ledger, 2026-09-05

### `hetero-review-loop --exclude` allowlist is autopilot's own tree — consumer repos cannot shrink a review payload
- **Trigger**: the next consumer-repo report of `Exclude pathspec '…' is not permitted by allowlist` for a data/generated directory, or the next agy-seat payload overflow where `--exclude` was the only lever.
- **Context**: `EXCLUDE_ALLOWLIST` (hetero-review-loop.js:29-47) hardcodes `platforms/**`, `docs/projects/**`, lockfiles… llm-playground plan 066 needed to exclude `benchmarks/matrix` (139 regenerated shard JSONs, most of the diff) to get the agy prompt under `MAX_ARG_STRLEN` and could not — generation 7 never started. Fix shape: a consumer-declared allowlist via project DI (`.claude/review-loop-config.md` `exclude_allowlist:` rows), constrained to non-code paths (no source extensions, must be a directory or data glob) and recorded in `range.json.excluded` + `full_range_sha256` as today so the exclusion stays visible to the checker. Never a free-form pathspec.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066, 2026-09-06

### agy seat payload overflow is discovered per seat at dispatch time — the loop could pre-compute it and fail before spending the other seats
- **Trigger**: the next generation where an agy seat returns no_verdict with `agy_argv_ceiling` in raw_log while the other seats completed.
- **Context**: `dispatch-review.sh` refuses an agy payload above `MAX_ARG_STRLEN` by design (named reason, no execve failure). The loop only learns this after dispatching every seat, so the whole generation's other seats are spent for nothing when the floor then aborts the generation (v2.36.5). Fix shape: in collect, after the prompt is assembled, compare its byte size against `lib/agy-argv-ceiling.sh` for every agy seat and exit before dispatch with the same named reason and the `--exclude` / prompt-file-runner remedies. Option c from the report (auto-reroute to a prompt-file runner) changes seat identity and is NOT the fix — a seat is a frozen (engine, effort, runner) triple.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066, 2026-09-06

### CEO/dev-flow guidance proportionality — peer request to soften "Boil the Lake" / near-zero completion cost, TaskCreate-missing semantics, reversible-candidate release gates
- **Trigger**: owner decides to open this; AND eval ON/OFF evidence exists for the affected skills (scorecard-first rule — an unevidenced rewrite of ceo-agent/dev-flow prose is an unevidenced trust change).
- **Context**: cuda (revival.3d, Codex session, 2026-09-06) after an Astra prompt audit asks upstream to: (1) stop "Boil the Lake"/completeness-principle prose from over-prescribing exhaustive checks — use proportional validation; (2) make a missing TaskCreate adapter read as "bookkeeping unavailable", distinct from a genuinely missing required capability (dev-flow already treats the missing TODO tools as advisory-never-blocker — verify the wording lands that way in ceo-agent too); (3) autonomous reversible candidates should not inherit release-approval gates. Reference cited: OpenAI gpt-6-astra prompting best practices. These are skill-prose changes across ceo-agent / dev-flow / finish-flow; per CLAUDE.md they need the orchestration eval harness ON/OFF before rewriting, and (3) touches the DOA table (owner policy). Not accepted on peer say-so; filed for the owner.
- **Effort**: M (evals + three skills + codex mirror)
- **Ready to run (2026-09-08)**: the eval half is built and pre-registered — `evals/orchestration/EXPERIMENT-completeness-proportionality.md` carries the decision rule (waste −50% AND zero increase in escapes, else keep the current prose), two length-matched arms, and two discriminating tasks. The runner gained `--pack`/`--contract` so both arms differ in exactly one block. What remains is owner approval and the runs; the design no longer needs to be invented first.
- **Source**: cuda revival.3d peer message, 2026-09-06; ASTRA-SKILL-AUDIT report on cuda (/data/rw3d-evidence/2026-09-06/ASTRA-SKILL-AUDIT/report.md, not shared)

### depth0-delegate-gate `Bash` matcher is an expansion over the frozen plan matcher
- **Trigger**: a measured depth-0 Bash latency complaint, or the next revision of `depth0-delegate-gate`.
- **Context**: plan §4 P3.1 lists `WebFetch|WebSearch|Read|Grep|Glob|Agent|Skill|Task`; the shipped hook also matches `Bash` and classifies read-shaped commands (`grep|rg|find|cat|sed -n|head|tail`) with a duplicated 35-line shell lexer, adding ~17 ms and two `/bin/sh` spawns per depth-0 Bash call (reviewer measurement). Accepted for v2.36.1 (depth-0's own grep bursts were the incident); recorded here so the delta is explicit. Options: keep and share the lexer with `foreman-guard.js`; or drop `Bash` and accept that grep-via-Bash is uncounted.
- **Effort**: S
- **Source**: v2.36.1 pre-merge review (opus), 2026-09-05; `docs/plans/2026-09-05-statusline-live-context-feed.md` §4 P3.1

### live-state-dir / context-budget test strength — two surviving mutants, one vacuous-off-Linux assertion, injection-test residue
- **Trigger**: the next edit to `scripts/lib/live-state-dir.js` probe error handling or to the `context-budget.js` live/transcript lag guard; or a `/tmp/injection-*` count above 50.
- **Context**: v2.36.1 round-2 pre-merge review (opus) mutation results: (a) `notFound: true` (fall back to `/proc/mounts` on any findmnt failure) survives 21/21 because every fake-findmnt rule set has a `'*'` default — add a rule set without it plus a `/proc/mounts` fixture saying tmpfs and assert `ssd-fallback`; (b) the lag guard's `Math.max` collapsed to "trust transcript" survives 35/35 because the older-row fixture uses transcript > live — add the case row older + transcript 130k + live 160k ⇒ 160k; (c) the newer-row test lacks `/\(statusline\)/` so it passes vacuously where `/dev/shm` is absent; (d) the injection test leaks `/tmp/injection-*` dirs whose names carry a `$(touch …)` payload — wrap in `finally { rmSync }`. Also: document `timeout: 2000` in the module header.
- **Effort**: S
- **Source**: v2.36.1 pre-merge review round 2 (opus), 2026-09-05

## A stale topology tuple derails a plan-review loop, and the failure is unreadable

- **Size**: M
- **Context**: `~/.autopilot/topology.json` recorded the reviewer seat `qwen3.8-max-preview@qoderclicn`. The installed build offers `Qwen3.8-Max`; the invalid name makes the CLI print an error and the wrapper exit 3 with **empty stdout and empty stderr**, so the seat looks like a dead runner rather than a bad tuple. With that seat `required: true`, generation 1 ends `terminal: true` / `policy_reason: required_seat_transport_exhausted`, and the completed seat's real findings land in `unratified_observations` where the receipt checker cannot see them. The escape — correcting the model name — is itself refused: `dispatch-plan-review: durable identity or frozen rubric/manifest drifted`. The seal then refuses the obvious repair. **Correction to this entry's first draft**: that is not a dead end — `dispatch-plan-review.js`'s own header documents the escape (clear the logical plan's sealed state: `grep -rl --include=state.json <logical_plan_id> ~/.autopilot/plan-review/`). The real cost is that nothing in the failure path points at it, and the diagnosis has to start from an exit 3 with no output at all. Observed 2026-09-08 on `fleet-comms-2026-09-08`; depth-0 adjudicated the two findings directly (plan-loop.md permits this) and re-reviewed the repaired plan under a disclosed successor id.
- **Trigger**: the next plan-review loop that ends `required_seat_transport_exhausted`, or the next topology regeneration.
- **Guardrails**:
  - Do **not** relax the seal for semantic drift. The distinction to encode is narrow: a seat that never produced a parseable reviewer artifact has no verdict to dodge, so replacing *only* its tuple is not evasion. A seat that reviewed and dissented must stay frozen.
  - Whatever the fix, the successor artifact must record the predecessor's id and the reason, so an abandoned identity is always readable as lineage rather than a silent reset.
  - Two cheaper mitigations that need no seal change: `resolve-dispatch-topology.js` should validate a recorded model against the runner's own list (`qoderclicn --list-models`) instead of trusting a baseline event, and the wrapper should surface the runner's stderr rather than discarding it — an empty/empty exit 3 cost most of the diagnosis time here.
- **Related**: `scripts/resolve-review-loop.sh` also resolved `plan_review_resolved_from: native-fallback` on a host with three qualified seats, purely because `~/.autopilot/topology.json` did not exist yet. A hetero review that silently becomes single-family is the same class of failure: the panel degraded and only the resolver field said so.

## The plan-loop freeze predicate cannot be satisfied by the plan loop

- **Size**: S
- **Context**: `hetero-review`'s plan-loop protocol says the loop freezes once `node scripts/check-phase-review-receipt.js --plan-artifact <file> --dispositions <file>` exits 0. In Mode B that checker requires **every finding in the plan artifact** to carry a `disposition` string (`check-phase-review-receipt.js:408`), but `dispatch-plan-review.js` never writes dispositions back into an artifact — after both generations of a real loop on 2026-09-08, every finding in `generation-01.json` and `generation-02.json` still had `disposition: null`, including the three whose disposition file had been consumed by the generation-2 dispatch. A second, independent blocker: the checker also verifies the plan's sha256 against the artifact's seal, so any plan repaired in response to a finding fails the check for the generation that produced it — the very act the loop asks for invalidates its own receipt.
- **Consequence**: a plan loop can only ever close by the *other* documented route, depth-0 adjudication after generation 2. That is a legitimate ending, but the skill presents the receipt as the primary freeze predicate, so a session that follows the protocol literally spends its time chasing a check that cannot pass.
- **Trigger**: next plan-review loop, or next edit to either script.
- **Guardrails**: fix the docs or the tooling, not the caller — a caller that hand-writes dispositions into the artifact to make the receipt pass has forged the record the receipt exists to attest. If the intent is that Mode B applies only to code-loop receipts, say so in `plan-loop.md` and drop the receipt from the plan loop's freeze predicate.

## ~~`resolve-dispatch.sh` cannot express a namespaced model alias~~ (CLOSED 2026-09-11: `valid_token` widened to `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$` — one optional slash-separated namespace, e.g. `kimi-code/k3` — `docs/plans/2026-09-11-kimi-implementer-rail.md`)

## `consult_dispatch` has no seat left once the qc panel excludes everything

- **Size**: S
- **Context**: On `cookys-openclaw`, `resolve-review-loop.sh` emits
  `consult_dispatch: auto` with `consult_resolved_from: native-fallback` and the
  warning *"no qualified consult seat on this host after qc_panel exclusion —
  falling back to sonnet/high@claude-native"*. `scripts/dispatch-consult.sh`
  then refuses outright: `consult_dispatch is off — refusing (no transport
  dispatched)`. Measured 2026-09-11 in `~/projects/fleet-comms`.
- **Why it matters**: the consult seat exists so depth-0 can ask a *different
  family* a design question. Falling back to `claude-native` resolves it to the
  same model that is asking — the one configuration that cannot answer the
  question the seat was created for — and the script is right to refuse rather
  than pretend. But the caller is then left with no supported route at all, and
  the natural workaround is to invoke a runner by hand, which is exactly the
  bypass the seat was meant to remove. On this host the qc panel is
  `gpt-5.6-sol` / `GLM-5.3` / `Qwen3.8-Max`, which excludes every hetero engine
  that has a working structured path; the only engine left over is `grok`,
  whose *review* parser is incompatible but whose **prose answers are fine** —
  and prose is all a consult needs.
- **Trigger**: next time a consult is dispatched on a host whose qc panel
  covers its whole roster, or the next edit to the consult resolution in
  `resolve-review-loop.sh`.
- **Guardrails**: do not solve it by letting a qc-panel seat double as the
  consult — the panel's independence is the thing being protected. The shape
  that fits is a **consult-only fallback list** of engines that are
  decorrelated but not panel members, with parse requirements relaxed to
  "returns text" rather than "returns a verdict". And the warning should name
  which engines were excluded and why, so the operator can see that the answer
  is "your panel ate your roster" rather than "nothing is installed".
- **Worked around on 2026-09-11 by** calling `grok --model grok-4.5 -p` directly
  with the question and the relevant files quoted into the prompt. It produced
  the argument that decided the design, so the seat's *value* is not in doubt —
  only its routing.
