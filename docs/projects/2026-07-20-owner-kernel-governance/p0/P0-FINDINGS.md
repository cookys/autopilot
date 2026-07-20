# P0 findings — Owner Kernel funding/kill gate

> **Verdict: STOP.** No target host provides the trust roots the plan requires, so P1 is not
> authorized. This is a successful execution of the approved plan, not a failure of it: the plan
> made P0 a kill gate precisely so this result would stop spend before product code exists.
>
> **Run**: `owner-kernel-p0-1784543437001` · **Base**: `366311c` · **Date**: 2026-07-20
> **Plan**: [`docs/plans/2026-07-20-owner-kernel-evolution.md`](../../../plans/2026-07-20-owner-kernel-evolution.md) § P0

## Evidence classes used in this document

Every claim below is tagged so a reviewer can tell proof from inference:

| Tag | Meaning |
|---|---|
| **[LIVE]** | Reproduced by running a probe on this machine during this run |
| **[SRC]** | Read directly out of named repository source at a named line |
| **[INF]** | Inference drawn from [LIVE]/[SRC] facts; labelled as reasoning, never as measurement |

Reproduce the host probes with:

```bash
bash docs/projects/2026-07-20-owner-kernel-governance/p0/probe-host-trust-roots.sh --json
```

## 1. The decisive result — host trust roots

Plan P0 step 7 stops the project when *"no target host achieves `full` or `partial` with the
authenticated user channel, active-owner capability, mediator/pre-action enforcement, and
append-only witness roots."* Step 4 fixes the pass bar: *"A host capability passes only when the
owner handle stays in host memory or a broker/IPC handle inaccessible to model tools and worker
processes; a prose promise is not evidence."*

That bar is adversarial by construction. The probe therefore asks one question per root: **is this
control reachable by the model's own tool?** The probe runs in the same identity a model `Bash`
tool runs in, so what the probe can reach, the model can reach.

### Executing host (Claude Code) — all four roots FAIL

| Root | Verdict | Mechanical evidence |
|---|---|---|
| **R1** authenticated user channel | **fail** | **[LIVE]** `~/.claude/history.jsonl`, `projects/`, `sessions/` are all writable by the model tool. Mode `600` restricts *other* uids; the model runs *as* the owner (`uid=1000 cookys`), so it is unrestrained. No witness key exists outside model-readable space. |
| **R2** active-owner capability | **fail** | **[LIVE]** No broker/IPC endpoint exists (`~/.autopilot/owner-kernel.sock`, `/run/owner-kernel.sock` absent). The nearest analogue, the session-mode marker dir, is a plain model-writable file tree. |
| **R3** pre-action mediation | **fail** | **[LIVE]** Hook sources are mode `664` owner-writable; `hooks/` is directory-writable (so hook files can be replaced by rename); `~/.claude/settings.json` is writable. |
| **R4** append-only witness | **fail** | **[LIVE]** The run ledger carries no append-only attribute (`lsattr` → `--------------e-------`, `e` only) and its directory is writable. A full-chain rewrite succeeded against a copy. |

### R3 deserves a precise statement, not a caricature

A preventive mediator **does exist**, and it would be dishonest to report otherwise:

- **[SRC]** `hooks/orchestrator-edit-gate.js:113` sets `exitCode = 2`, and a `PreToolUse` exit 2
  denies the tool call. This is genuine *prevention*, not post-hoc detection.

It is nevertheless not a trust root, because every control surface that governs it sits inside the
model's write reach:

- **[SRC]** `hooks/opt-in-manifest.json:16` lists it — it is **opt-in, default OFF**.
- **[SRC]** `hooks/orchestrator-edit-gate.js:20` — default mode is `warn`, not `block`.
- **[SRC]** `hooks/orchestrator-edit-gate.js:24` — *"Fail-open: any error ⇒ exit 0."*
- **[LIVE]** Its source file, its enabling config, and the session marker it reads are all writable
  by the governed party.

**[INF]** So the correct finding is not "there is no mediator." It is: *the mediator is not
tamper-proof against the principal it governs, and it fails open.* A gate whose subject can edit,
disable, or crash it is a safety feature against accident, not an authority boundary against intent.

### Witness-head rewrite, demonstrated

**[LIVE]** Against a **copy** of the live ledger, a rewrite of every row succeeded — including
flipping a `leased` stage to a terminal `verified` state with `reason: "forged-by-model"`. With no
append-only attribute and no external witness receipt, full-chain recomputation is locally
undetectable.

Precise scope of that evidence, since a review pass correctly noted the original wording overstated
it: what was demonstrated is that **the rewrite mechanism works** on a byte-identical copy. The real
ledger was left untouched, and `sha256sum` returned `1e8205d8ed74040b` (2 lines) for both the copy
taken beforehand and the live file afterwards. That is adequate evidence the probe was
non-destructive; it is **not** an independent integrity attestation of the live ledger, because no
witness receipt exists to attest against — which is the finding itself.

### The four target hosts

**[SRC]** From the repo's own capability records (`src/harness/capabilities/*.json`), which
`node bin/autopilot.js harness report` treats as the single source of truth:

| Host | Level | Status | `blocking_gate` | Tier |
|---|---|---|---|---|
| Claude Code | H1 | warning | `unavailable` | **none** |
| Codex | H2 | verified | `unverified` (hooks: `warning`) | **none** |
| OpenCode | H2 | warning | `unverified` (session_hooks `unavailable`) | **none** |
| Antigravity (agy) | H2 | verified | `unverified` (hooks: `unverified`) | **none** |

**Not one target host has a verified blocking gate.** The whole fleet report reads
`ready: 0, not_ready: 7`, and six of seven records are past TTL. OpenCode's record carries an
explicit standing instruction: *"Do not promote OpenCode hooks to blocking gates without fresh
probe evidence."*

**[INF]** Observation is not prevention. Even a host with perfect audit fidelity cannot reach
`partial`, because `partial` requires that every reachable red-line action be *preventively*
observable or routed through a model-unwritable executor. None of the four can demonstrate that.

## 2. What would change the verdict

This STOP is a statement about the current hosts, not a claim of impossibility. One probe result
matters here and cuts in the project's favour:

**[LIVE]** `chattr +a` **fails** at uid 1000 (`Operation not permitted` — it needs
`CAP_LINUX_IMMUTABLE`). The model can neither set *nor clear* that attribute. So a **root-installed
append-only witness would be genuinely unforgeable by the model.**

**[INF]** That separates *"architecturally impossible"* from *"not built yet"*. R4 is buildable
today with a root-provisioned witness. R1–R3 need a real boundary the same UID cannot cross —
a separate UID, a sandbox, or a broker process holding the capability in its own memory. This is
the same conclusion the repo already reached under a different name: `CLAUDE.md` records that the
L1 block-mode override was **reverted UNSAFE** because *"no local-only mechanism is malicious-proof
against a same-user worker"*, and that re-enabling needs *"a real isolation boundary (separate UID /
sandbox / no user systemd bus)"*. P0 reproduces that finding independently, in the governance domain.

## 3. Why the spike was not run

Plan P0 step 6 defines a three-task spike; step 7 makes it conditional. The assignment is explicit:
if no host is `full`/`partial`, stop immediately and do not spend on ceremonial tasks whose
acceptance is already impossible.

The spike measures KR9 — mandatory-dispatch reduction, independent adjudication, and a
transcript-free resume from the ledger. **[INF]** Its acceptance is already unreachable: a
transcript-free resume must trust the ledger, and §1 demonstrates the ledger is rewritable by the
party whose decisions it records. Running the spike would produce numbers whose foundation the same
document disproves. Deferring it is the honest call, not a shortcut.

## 4. A correction recorded against this run

An honest log of a false finding I generated and then withdrew, since P0's value depends on its
evidence discipline:

Mid-run I reported that `scripts/load-endpoints-env.sh` silently loaded nothing from a well-formed
mode-600 file, and treated it as a blocking bug that left no independent challenger reachable.
**That was my error, not a defect.** **[SRC]** The script's tail shows sourcing only *defines*
functions; consumers call `autopilot_load_endpoints_env` explicitly
(`scripts/dispatch-review.sh:93`, `scripts/dispatch-hetero.sh:115`). **[LIVE]** Invoked correctly,
both endpoints resolve `ready=true`. The depth-0 precondition evidence was accurate and my
counterexample was wrong. It is recorded here rather than quietly deleted.

## 4b. Independent challenge of this verdict

A STOP that halts a Board-approved project should not rest on the analysis of the party producing
it. Two cross-family read-only reviews were dispatched against the P0 artifact diff.

| Challenger | Transport | Result | Counted? |
|---|---|---|---|
| GLM-5.2 | `anthropic-compatible`, endpoint `glm` | `SHIP-AS-IS`, findings `none` | **No — vacuous** |
| MiniMax-M3 | `anthropic-compatible`, endpoint `minimax` | `FIX-THEN-SHIP`, substantive findings | **Yes** |

**GLM's pass was discarded, not banked.** Its raw log is 143 bytes — the nonce wrapper, `VERDICT:`,
and `FINDINGS: none`, with no reasoning and no reference to any claim in the document. A bare
approval with zero engagement is not evidence a challenge occurred, and counting it would have
manufactured a confirmation. Recorded here because discarding a *favourable* result is exactly the
kind of thing that should be visible.

**MiniMax's findings were adjudicated individually, not accepted wholesale:**

| Finding | Adjudication |
|---|---|
| `gate.any_host_full_or_partial` reflected only the executing host while the prose implied a union across all target hosts | **Valid — fixed.** The field was genuinely misleading. The probe now emits `executing_host_qualifies`, `any_target_host_qualifies`, and the union, plus a `field_semantics` note. Verdict unchanged: all three are `false`. |
| The `[LIVE]` tag overstated the ledger-integrity claim | **Valid — fixed.** Wording narrowed to what was actually demonstrated (§ 1). |
| The mandatory-6 count includes an explicitly non-authoritative pass | **Valid — fixed.** Both readings (6 by omission, 5 by gate authority) are now recorded in `semantic-inventory.md`, with the choice escalated rather than silently made. |
| Recommending "revise KR10" contradicts the document's own laundering warning | **Valid — fixed.** `surface-baseline.md` now presents the three options without a recommendation. |
| `lsattr \| grep -q 'a'` needs anchoring or it matches an `a` anywhere | **Rejected — false positive.** `lsattr`'s flag field is positional: each slot holds its own flag letter or `-`, and `a` is used by exactly one flag (append-only). An unanchored match is precise here. Kept as-is with the reasoning recorded in-script rather than applying a cosmetic "fix" to a non-bug. |
| Probe creates and removes a dotfile inside `hooks/` | **Acknowledged, kept.** Directory writability is the specific claim being tested; a `mktemp` elsewhere would not demonstrate it. The marker is removed immediately and the worktree is verified clean. |
| `spec_review` left unresolved | **Partially valid.** It was already excluded from every count rather than guessed. Resolution path now named in `semantic-inventory.md`. |

**None of the accepted findings disturbed the STOP verdict** — they improved the artifact's
accuracy and honesty. The union-gate fix is the one that mattered: it corrected a field a future
reader could have misread, and the corrected field still reads `false`.

## 5. Deliverables status against plan P0

| P0 step | Status | Where |
|---|---|---|
| 1. Semantic inventory | Complete | [`semantic-inventory.md`](semantic-inventory.md) |
| 2. Load-bearing surface baseline + projected target | Complete | [`surface-baseline.md`](surface-baseline.md); plan § 3 amended |
| 3. Mandatory-dispatch counting rule applied | Complete | [`semantic-inventory.md`](semantic-inventory.md) § counts |
| 4. Host capability probes | Complete — **decisive** | § 1 above; [`host-trust-roots.json`](host-trust-roots.json) |
| 5. Baseline fixtures | **Not built — deliberately** | Fixtures encode an acceptance contract that cannot be honoured on a `none` host; building them would be ceremony |
| 6. Three-task spike | **Not run — gate-blocked** | § 3 above |
| 7. Stop condition | **TRIGGERED** | § 1 above |

## 6. Verdict

**P0 = STOP. P1 is NOT authorized.**

**Exact kill condition met** — plan P0 step 7, second sentence: *"Also stop if no target host
achieves `full` or `partial` with the authenticated user channel, active-owner capability,
mediator/pre-action enforcement, and append-only witness roots."*

All four target hosts are `none`. All four trust roots fail on the executing host.
[`host-trust-roots.json`](host-trust-roots.json) records all three gate fields as `false`:
`executing_host_qualifies`, `any_target_host_qualifies`, and their union
`any_host_full_or_partial`.

**[INF]** Recommended next step, for Board decision rather than foreman action: treat "establish one
host with real trust roots" as its own scoped project — root-provisioned append-only witness (R4,
shown reachable), and a capability broker or separate-UID boundary for R1–R3. Owner Kernel product
code should stay unfunded until that project reports a host at `partial` or better. No amount of
Kernel code can create an authority boundary the host does not have.
