# Plan — hook advisories reach the model: additionalContext for tool events, a deferred relay for Stop

> Status: proposed · Owner: depth-0 (cookys) · Frame: L, per `references/plan-template.md` · Version target: next PATCH
> Source: BACKLOG row "Hook advisories written to stderr with exit 0 never reach the model" (`docs/backlog/hook-stderr-advisories-invisible.md`), operator "開工" 2026-09-26.

## 0. Context / thesis
The docs rule (code.claude.com/docs/en/hooks): "Stderr from a hook that exits 0 goes to the debug log only … Claude never sees it." v2.36.97 fixed foreman-guard.
A read-only inventory (2026-09-25, spot-checked by depth-0) found 14 more hooks, 6 of them default-on, whose model-facing advisories go to stderr with exit 0.
Channel probes proved which outputs reach the model (`docs/plans/evidence/2026-09-25-foreman-guard-roles/p1-probe-nodecision/`,
`docs/plans/evidence/2026-09-26-hook-channel-probe/RULING.md`):
- PreToolUse, PostToolUse, and PostToolUseFailure `hookSpecificOutput.additionalContext`, with no `permissionDecision`: **visible**, and the tool runs normally.
- Stop `systemMessage`: **not visible** to the model (it is a human UI channel).
- Stop `additionalContext`: accepted, but it makes Claude Code re-fire Stop repeatedly (9× per turn) and derails the model's answer. **Unusable.**
- Stop exit 2: visible, but it **forces another model turn**. That is wrong for a pure advisory.

So Stop has no clean same-turn channel. Stop advisories are relayed on the NEXT user prompt instead.
This is a **mechanism** change (CLAUDE.md): every advisory text stays byte-identical, and only its delivery channel changes. No eval is needed.

## 1. Problem
Default-on nudges that exist to change the agent's behavior never reach the agent:
- cost-fuse's "dispatch to hands";
- context-budget T1;
- depth0-delegate-gate's "delegate";
- reload-watch's "/reload-plugins";
- cost-tracker's "handoff and /clear".

Opt-in hooks share the defect.

## 2. OKR / KRs
- **KR1**: for every hook in §3 group T, the advisory is emitted on stdout as `{"hookSpecificOutput":{"hookEventName":<event>,"additionalContext":<same text>}}`, the stderr copy is kept (debug log), the exit code is unchanged, and no `permissionDecision` is emitted on that path.
  A test per hook asserts the stdout JSON, the byte-identical text, and the absence of `permissionDecision`.
- **KR2**: a Stop-group advisory (§3 group S) is queued and delivered AT MOST once, verbatim, on the next UserPromptSubmit of the SAME `session_id`, as model-visible context.
  A second prompt delivers nothing, and a different session never receives it. Entries evicted by the cap (oldest first) or older than 24 h are dropped with a debug-log line and never delivered.
  This is proven by hook tests and by a live probe (P0).
- **KR3**: deny and block paths (exit 2, `permissionDecision:"deny"`/`"ask"`) are byte-for-byte unchanged, and every existing hook suite stays green. Only the listed stderr-pinning assertions (§5) are re-expected, and each re-expectation is named in its commit.
- **KR4**: `dirty-protected-paths` keeps `systemMessage` as a deliberate human-facing reminder. It is documented as such and not relayed.

## 2.5 Global Constraints (copied verbatim into every implementer + reviewer dispatch)
- Node ≥ 20.10, built-ins only. Every hook stays fail-open (an internal error ⇒ exit 0, no stdout).
- Advisory text is BYTE-IDENTICAL to today's stderr text. Never add or remove wording.
- An advisory path never emits `permissionDecision` (an `"allow"` auto-approves the tool call, which was the v2.36.97 lesson). Deny/ask/exit-2 paths are untouched.
- Each hook gets its own small inline emitter, and there is NO shared runtime module between hooks, including for the Stop queue. This keeps single-crash isolation, per the foreman-guard/context-budget header notes.
  Group-S hooks each inline their own atomic append to the documented queue file format, and only advisory-relay.js reads it.
- Stop hooks never emit `hookSpecificOutput.additionalContext` and never exit 2 for an advisory (the probe showed a re-fire loop and a forced extra turn). A test asserts that group-S stdout carries no additionalContext.
- Implementation commits never run `sync-version.js`. The hook-count sync and `check-hook-inventory.js` belong to the depth-0 landing step.
- New cases go in NEW suites. Existing suites change only on the §5 list.
- Do not edit CHANGELOG, the version, or `.claude-plugin/plugin.json` in implementation commits; depth-0 lands the release.

## 2.6 Change-policy decisions
- **Compatibility**: additive. The one new hook (`advisory-relay`, UserPromptSubmit) is inert when nothing is queued. Existing config keys and modes are unchanged.
- **Dependency**: none.

## 3. File-structure map
**Group T (tool events → additionalContext):**
- default-on:
  - `hooks/cost-fuse.js` (warn line, ~:358);
  - `hooks/context-budget.js` (T1, ~:191,:234; T2's exit 2 unchanged);
  - `hooks/depth0-delegate-gate.js` (nudge, ~:250);
  - `hooks/reload-watch.js` (~:95);
  - `hooks/dispatch-model-guard.js` (mode=warn lines, ~:161,:184).
- opt-in:
  - `hooks/orchestrator-edit-gate.js` (~:115);
  - `hooks/branch-protection.js` (merge/rebase/reset warning, ~:92);
  - `hooks/large-file-warner.js` (~:57);
  - `hooks/design-quality.js` (~:45);
  - `hooks/test-runner.js` (~:84);
  - `hooks/mcp-health.js` (PostToolUseFailure, ~:87).

  **Multiplexer (hard requirement)**: `hooks/opt-in-multiplexer.js` must parse each child's stdout JSON and merge every `hookSpecificOutput.additionalContext` into ONE object joined by newlines.
  It preserves any deny/ask decision (deny wins over ask), STRIPS any child's `permissionDecision:"allow"` (it never forwards an allow), and writes exactly one JSON object.
  **If ANY child exits 2, the multiplexer behaves exactly as today**: exit 2, stderr passthrough, no stdout JSON, and advisories dropped for that invocation.
  Tests: two advising children; an advising sibling next to an exit-2 sibling; a child that emits allow.

**Group S (Stop → deferred relay):** `hooks/cost-tracker.js` (~:134, default-on), `hooks/check-console.js` (~:53), and `hooks/batch-format.js` (~:57,:71), all opt-in.

**New:**
- `hooks/advisory-relay.js` (UserPromptSubmit, **default-on**; inert when the session's queue is absent or empty; opt-out with `AUTOPILOT_ADVISORY_RELAY=off`): drains this session's queue and emits it as context.
- The queue FILE FORMAT, with no shared module: `<live-state base>/advisory-queue/<sanitized session_id>.jsonl`, one JSON line per entry `{ts, source, text}`. The base is the tmpfs
  live-state dir that `scripts/lib/live-state-dir.js` resolves. Each writer inlines an O_APPEND write of one line. `ts` is an ISO-8601 UTC string. A missing or empty `session_id` means the entry is not enqueued (debug-log line only).
  The cap trims oldest-first to 20 entries, then oldest-first again until the file is ≤ 8 KiB; a single entry over 8 KiB is truncated to 8 KiB. Keys come strictly from the payload's `session_id`.
- `hooks/hooks.json` wiring, the `hooks/README.md` row, and the hook-classes entry if the repo keeps one. The hook-count sync and inventory check happen at landing (depth-0).

**Unchanged by design:** `hooks/dirty-protected-paths.js` (a human-facing systemMessage; its README row says so).

## 4. Phases
**P0 (S) probe: does UserPromptSubmit output reach the model? — DONE 2026-09-26** (`docs/plans/evidence/2026-09-26-hook-channel-probe/ups/RULING.md`):
both plain stdout (U1) and `hookSpecificOutput.additionalContext` (U2) are MODEL-VISIBLE on a resumed session's next prompt, with the current turn's nonce quoted verbatim.
**Chosen for P2: U2 `additionalContext`.** It uses the same channel as group T and stays out of the human-facing `-p` stdout. P2 stays in scope. Original design, kept for the record: Use the same method as `2026-09-26-hook-channel-probe`, with two variants: (a) plain stdout text, and (b)
`{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":…}}`, each with a nonce, on the SECOND prompt of a resumed session. Record which is visible and pick
it for P2. **Stop condition**: if neither is visible, P2 is dropped. Group S then keeps stderr but the README documents it as debug-only, and a BACKLOG row records the gap.
Group T still ships.

**P1 (S–M) group T.** Convert each listed hook's advisory path to stdout `additionalContext` (the event name matches the hook's event), keep the stderr copy, and emit no permissionDecision.
Where one invocation has several advisories, join them with `\n` into ONE JSON object. For the multiplexer, verify forwarding and add merging if needed.
**Acceptance**: KR1 and KR3. The new suite is `hooks/tests/hook-advisory-channel.test.sh`, with one case per hook plus a negative control asserting that no advisory path contains `permissionDecision`.

**P2 (S–M) group S relay (depends on P0).** Group-S hooks append to the queue file per §3's format (inline, no shared module) in addition to their existing stderr (and keep any systemMessage). `advisory-relay.js`
drains ONLY `payload.session_id`'s queue, emits the entries' `text` VERBATIM (joined by a single newline, with no prefix or framing) as UserPromptSubmit `additionalContext`, and deletes the queue atomically (rename, then read). The queue is capped (oldest dropped),
and entries older than 24 h are discarded unread. **Acceptance**: KR2, with cases for delivery once, no double delivery, session isolation, cap/age, and fail-open on a corrupt queue.

**P3 (S) docs.** Update the `hooks/README.md` rows for every touched hook (which channel reaches the model) and add the advisory-relay row. Note that dirty-protected-paths is human-facing.
Add a short "hook output channels" paragraph with the probe table to the hooks reference that documents authoring conventions. Sync the mirrors.
**Acceptance**: `sync-codex-plugin-skills.sh --check`, `validate.sh`, and `doc-drift-gate.js .` with no new FAIL. `check-hook-inventory.js` runs at landing, after the hook-count sync.

## 5. Test / validation
- New: `hooks/tests/hook-advisory-channel.test.sh` (P1) and `hooks/tests/advisory-relay.test.sh` (P2).
- Re-expectations allowed ONLY here (from the inventory; each one named in its commit):
  - `hooks/tests/cost-fuse.test.sh` cases 4, 4b, 5d;
  - `hooks/orchestrator-edit-gate.test.js:460-465`;
  - `hooks/context-budget.test.js:157-161, 552-558`;
  - `hooks/tests/dispatch-model-guard.test.sh` cases 6d, 12, 21 (case 6e is the acknowledged silent allow and must stay unchanged);
  - `hooks/tests/reload-watch-detects-mtime-change.test.sh:31`.
- Every suite that `grep -l` finds for each touched hook name. At landing: the full `hooks/tests/run.sh --parallel 8`, with reds rerun solo and compared at base.

## 6. Risks + inversion
- 🟠 **Advisory volume in context**. Each group-T hook's cadence:
  - rate-limited: cost-fuse (per spend multiple), context-budget (per tier/interval), depth0-delegate-gate (periodic), reload-watch (on change);
  - event-driven, one advisory per triggering event: dispatch-model-guard and orchestrator-edit-gate (per warn-mode breach), branch-protection (per protected-branch mutation), large-file-warner (per large read),
    design-quality (per checked write), test-runner (per failing run), mcp-health (per MCP failure).
  That cadence is accepted. No limiter is added, because that would be a guidance change; P1 confirms each cadence in code.
- 🟠 **Multiplexer merging**: several opt-in children emitting JSON could clobber each other. P1 verifies and merges.
- 🟡 **The relay is new default-on surface**: it is inert with an empty queue, and fail-open on corruption.
- Inversion: what guarantees failure? Emitting `permissionDecision:"allow"` to carry text, using Stop `additionalContext`, or changing advisory wording. All three are forbidden in §2.5.

## 7. Out of scope
- Changing any advisory's wording, thresholds, or modes (that would be a guidance change needing eval).
- Converting warn modes into blocks.
- `dirty-protected-paths` delivery.
- A general hook-output framework.

## 8. Open questions
None for the Board. P0 may drop P2 by its stop condition.

## Review log
R0 author: depth-0 (opus), 2026-09-26.
G1 (sol chair / grok deep / MiniMax third, all transported): 11 findings, 4 blockers. Dispositions are in `2026-09-26-hook-advisories-reach-model.g1-dispositions.json`:
- accepted blockers (all folded): no relay prefix; no shared queue module (inline writers, documented format); hook-count sync moved to landing; KR2 reworded to at-most-once with cap/age drops;
- accepted and folded: the cadence table, strict `session_id` keying, merging in the multiplexer, the inventory check at landing, and dropping case 6e.
G2 (terminal at the cap; sol READY, grok STOP, MiniMax CONDITIONAL): 6 findings, 2 blockers. Dispositions are in `…g2-dispositions.json`, and the freeze check exited 0 against the G2 artifact.
This commit is the bounded repair:
- an explicit ban on Stop additionalContext and exit 2;
- the multiplexer keeps any exit-2 invocation exactly as today and strips allow;
- the leftover enqueue wording is fixed;
- the queue format is pinned (ts, empty session, cap order);
- the relay is stated as default-on with an opt-out.
No G3.
