# Plan — lane interactive menus become PM-panel decision cards (menu cards)

> Status: r2 (after g2; post-cap, PM ruling pending) · Owner: autopilot lane · Branch: docs/menucard · Frame: PM dispatch 01M708ZGN4, fleet 01M7091076 / 01M7095F5H

## 0. Context / thesis

Four lanes sat on menus the operator could not see (read-outside-cwd prompt, AskUserQuestion, hangar needs_human, dev-channel dialog). Ask: wherever a lane (any account/host) waits on the user, show a PM-panel card with context and options; the operator's answer returns to the lane and releases its menu.

Research: `project/plans/evidence/2026-11-12-menucard-scope/research.md`. Facts:

- Claude Code 2.1.319 lets a hook answer three of the menus programmatically, and a hook may block for its timeout (default 600 s for command hooks, overridable per hook):
  - **AskUserQuestion**: `PreToolUse` returns `permissionDecision:"allow"` plus `updatedInput` carrying the original `questions` and an `answers` map (question text → option label); allow alone is not enough (hooks doc). `deny` + `permissionDecisionReason` returns a reason to the model.
  - **ExitPlanMode**: `PreToolUse`, input `plan`/`planFilePath`; output shape in P1, spike-gated (S4).
  - **Permission prompts** (Bash/Edit/MCP, incl. the read-outside-cwd prompt): `PermissionRequest` returns `hookSpecificOutput.decision` = `{behavior:"allow"}` or `{behavior:"deny", message}`.
  - **MCP Elicitation**: `Elicitation` hook returns `action` accept/decline/cancel plus `content`.
- No hook exists for the **dev-channel dialog** and the **folder-trust dialog** (both render before the hook engine starts), nor for login/OAuth screens. `idle_prompt` and `permission_prompt` Notifications are observe-only.
- fleet (01M7095F5H, r0 01M709MPCG): no card-open CLI. A card is a ledger file written by `open-decision.js` under a registered root (`fleet decision ledger add`); the local courier publishes it (`POST /v1/decisions/upsert`) and owns it; nobody opens cards for another host/account. `session-observe.ts` sees only `status`, never menu text. The lane verifies with `fleet decision verify <card_id> <answer_id> --content-sha256 <hex>` (exit 0 valid, 7 unverified incl. publish_pending and local answers, 4 unknown card, 10 card closed, 9 courier unreachable). No `fleet decision wait` yet (proposed in A). Before the F4 hub (11-10T16:24Z) every verify is publish_pending.

Thesis: a blocking hook in the lane is the only point that both has the menu content and can release it. The card lives in the lane host's ledger and reaches the operator via the hub; the answer returns only through the hub answer log, verified by the hook itself (hook = executor, no carddispatch hop).

## 1. Problem

The operator answers, from the PM panel alone, every menu an unattended lane is blocked on; the lane continues with exactly that answer; no model or peer can substitute one.

## 2. OKR / KRs

- KR4: no card text contains a credential; one red-green test per field.

## 2.5 Global Constraints (copy unchanged into every implementer and reviewer brief)

Superseded by card routing; see project/plans/evidence/2026-11-12-menucard-scope/scope.md (PM 2026-11-12).

4. `fleet approve` stays human-tty only; this work never calls it, wraps it, or reads its queue.
5. Card text never carries credentials: every variable string (tool_input fields, plan text, transcript tail, question and option text, cwd, free-text) goes through `hooks/_shared/secret-patterns.js` `redact()` over the full field first, then is truncated; the serialized card is scanned again before writing; a hit aborts the open.
7. No hosted CI; suites run locally. No new trust machinery (ADR-0001): verification is re-derivation from the hub answer log, never a signature or hash chain.
8. Node built-ins only.

## 2.6 Change-policy decisions

- Implementers are non-Claude (grok or codex); Claude leads and accepts (PM 01M70B8A2J).
- Dependency: fleet decision-card A (publish live, answer log, verify codes, `console_only`, same-id-one-card) and F4 hub; `fleet decision wait` optional (P3a polls). No new npm dependency.

## 3. File-structure map

autopilot repo:
- `scripts/lib/menu-card-content.js` (new): pure functions: payload → card, redact-then-truncate, answer → hook output JSON. No fleet needed.
- PM panel (`mods/live/…`): hub cards from other couriers beside local cards; answers via the console path (Q2).

fleet repo (fleet lane owns; confirmed 01M709MPCG):
- decision-card A: `verify` and publish need no tty; `answer_via: console_only` with courier refusal `console_only` for a local claim (stops a model `claim` answering first; console answer would get exit 3); same card id written twice yields one hub card; `fleet decision wait <card_id> --timeout <dur>` (exit 0 + answer JSON, new exit code on timeout, e.g. 11).
- Console answer: PM host runs `fleet decision answer <card_id> --origin-courier <owner> … --operator-file <file>` as the operator (decision.rs:150-175); hub gate needs the `_access` operator (answers.ts:85); owner marks `via: console` (Q2).


## 4. Phases

| Phase | Size / est. | Depends on | Starts before F4 |
|---|---|---|---|
| P0 spikes | S, 0.5 d | none | yes |
| P1 content library | S, 0.5 d | none | yes |
| P2 open-decision | S, 0.5 d | none (P1 for the card shape) | yes |
| P3a hook, deny branches | M, 1 d | P1, P2 | yes (stub fleet) |
| P5 end-to-end + rollout | S, 0.5 d | F4 hub, A publish (`/v1/decisions/upsert`) live | no |
| P6 skill layer | M, 1 d | none | yes |

### P0 — spikes (S, CPU only, throwaway config dir seeded only with `.credentials.json`, never the real `~/.claude`)
tmux session on 2.1.319, stub hook waiting on a file:
- S1: `PreToolUse(AskUserQuestion)` blocking 30 s, 120 s, 700 s, then allow + `updatedInput.answers`: menu drawn? model gets the answer? tool_result? timeout behaviour (menu shown / denied; does empty output return the menu)? does a per-hook `timeout` above 600 s take effect (largest accepted)?
Acceptance: `project/plans/evidence/2026-11-12-menucard-scope/spikes.md` records each answer (raw payload, screen text); amend only rows a spike contradicts.

### P1 — content and output library (S, no fleet)
`scripts/lib/menu-card-content.js`:
- `cardFromPayload(event, payload)` → **one card per tool call**:
  - AskUserQuestion: one card holding all questions (max 4, Claude Code's limit) as numbered sections; options = labels plus fixed `其他（自由輸入）`; `multiSelect` = comma-joined labels. Answer text: one line per question (`<n>. <question text>: <label>`); a missing question or unknown label is unverified (hand back), never a guess.
  - ExitPlanMode: options `核准計畫` / `退回並附意見` (free text); context = first 1500 chars of redacted `plan` plus `planFilePath`.
  - PermissionRequest: options `允許這一次` / `拒絕（附理由）`; context = tool_name, cwd, tool_input fields (Bash `command`, `file_path`, MCP server + tool) ≤ 600 chars each.
  - Every card: lane address (`fleet whoami`), host, session id prefix, cwd, last assistant text (≤ 400 chars).
- `redact(text)` per §2.5 #5. A hit replaces the field with `［內容疑似含憑證，已隱藏；請到 pane 查看］`.
- `outputFor(kind, answer, payload)`, exact hook JSON (each wrapped in `hookSpecificOutput`):
  - AskUserQuestion allow: `{hookEventName:"PreToolUse", permissionDecision:"allow", updatedInput:{...payload.tool_input, answers}}`; deny: `{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason}`.
  - ExitPlanMode (separate; shape per S4, branch not merged until S4 passes): approve `{hookEventName:"PreToolUse", permissionDecision:"allow"}` with `updatedInput` = original `tool_input` if S4 requires it; reject `{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:<operator feedback>}`.
  - PermissionRequest: `{hookEventName:"PermissionRequest", decision:{behavior:"allow"}}` or `{... decision:{behavior:"deny", message}}`. Any answer that is not exactly `允許這一次` maps to deny with the operator's text as `message`.
Acceptance: unit tests per kind, multi-question, multiSelect, free text; redaction red-green with one planted credential per field (tool_input value, plan, transcript tail, question, option, cwd, free-text answer) plus one straddling each truncation boundary; removing `redact()` turns each red.


### P5 — end-to-end and rollout, after F4 and A publish (S, + fleet)
On the F4 hub a team-account lane opens a real AskUserQuestion, Bash permission prompt and read-outside-cwd prompt; the operator answers from the PM panel; record card ids, answer ids, verify outputs and the lane transcript. Live negatives: a local `fleet decision` answer or claim by the lane's own model does not release the menu; a late answer after timeout is shown 「已逾時」.

### P6 — skill layer: `operator_channel=pm` (M, autopilot; PM 01M709KFWF; independent of F4)

Skill layer keeps a lane from asking in its pane; hook layer (P3) cards any ask that still happens.

Pane gates today (develop da5ef519e):
`skills/research-to-ship/SKILL.md:31` (every phase gate uses AskUserQuestion), `skills/onboard/SKILL.md:94`, `skills/dev-flow/SKILL.md:337`, `skills/learn/SKILL.md:64,88`, `skills/ceo-agent/references/level-front-door.md:53`, `skills/ceo-agent/SKILL.md:305`, `skills/distill/SKILL.md:104,170,189,235-236`.


Dependency map: P0 ∥ P1 ∥ P6; P1 → P2 → P3a; P5 needs F4 hub (11-10T16:24Z onward) + **A-case publish (`/v1/decisions/upsert`) live** + the S5 result (no allow on hook death). Startable now (CPU, stub fleet): P0, P1, P2, P3a, P6.

## 5. Test / validation

Script-gated: P1 unit, P3a stub-fleet suite with negative controls, P6 tests, affected-suites. Human-gated: P5 live operator answers. Every check ships a red broken case first.

## 6. Risks + inversion

What guarantees failure:
- **Pane shows "running hook" while the card is open** (local answer may be impossible, S1/S2).
- **Hook timeout shorter than operator response.** S1 measures the largest accepted `timeout`; timeout denies with the PM-card message, panel shows 「已逾時」, late answer (exit 10) never acted on. Q1.
- **Answer forged by the lane's own model** (same account can run `fleet`). Mitigation: fleet `console_only`.
- **Duplicate cards.** PreToolUse and PermissionRequest both fire for AskUserQuestion (research §1).
- **Hook killed without a handler.**
- **Credential on a card.** §2.5 #5, per-field tests.
- **Hub down / F4 slip.** Every unverified path denies (permission) or hands back (ask/plan).

## 7. Out of scope (batch 1)

- Folder-trust dialog: no hook in this change. The Q3 answer is superseded by PM 01M70D7FH9 (2026-11-12).
- dev-channel dialog: `scripts/accept-dev-channel-prompt.sh`; failure shows as a failed unit, not a card.
- MCP Elicitation: recommend batch 2. Has a hook and would reuse P1–P3, but output shape and timeout are unproven; wait for S1–S5.
- Subagent menus (recommend later batch), `idle_prompt` (never, observe-only), login/OAuth screens (never), non-Claude harnesses (later batch).
- Any change to `fleet approve` (never).

## 8. Open questions (with recommendation)

- Q1 — **answered** (PM 01M70B8A2J): on timeout the hook denies (not pane) with the PM-card message; no pane-key fallback.
- Q2 (fleet) — **answered**: the PM panel answers a hub card as a console answer (`fleet decision answer … --operator-file`, `_access` operator, `via: console`); `verify` accepts a console answer only with a matching `--content-sha256` and a local answer never (core/src/decisions.rs:669-680), so the hook always passes the hash and local answers exit 7. Hash = rendered answer text (F4 plan :67). fleet adds `answer_via: console_only` as the second gate.
- Q3 — **answered** (PM 01M70B8A2J, as recommended): folder-trust dialog. Recommendation: the operator pre-trusts each unattended lane's working directory once by hand; no automation. Superseded by PM 01M70D7FH9 (2026-11-12).
- Q4 (PM) — **answered**: the card is written on the lane's host and reaches the PM panel through the hub; the PM host never writes cards for other lanes (fleet agrees: owner = the courier that scanned the file).
- Q5 — **answered** (PM 01M70B8A2J, as recommended): P6 default. Recommendation: `operator_channel=pm` on program hosts after P6 merges and the eval passes; `local` elsewhere.

## Review log

- R0 (author, 2026-11-09): first draft; plan id `autopilot-menu-cards`.
- G1 (2026-11-09): verdict CONDITIONAL. Seats: sol_chair CONDITIONAL, argon_deep CONDITIONAL, grok_skeptic STOP. 14 findings: 7 accepted_blocker, 7 accepted_nonblocking. R1 changes (fingerprint → section):
  - 412cb78b14 (blocker) permission fail-closed → §2.5 #3, P3a step 6 table.
  - e92e45fc68 (blocker) via=local, FLEET_BIN → §2.5 #1–#2, P3a steps 2 and 4, Q2.
  - 730d48fee7 (blocker) hashless verify → §2.5 #1, P3a step 4, §3 fleet repo, Q2.
  - b4c6101983 (blocker) no redaction → §2.5 #5, P1 `redact` and per-field tests.
  - 6559771391 (blocker) dedupe, late answer, duplicates → §2.6, P1, P2, P3a, §6.
  - b04590aaa9 (blocker) cleanup, late answer → P3a steps 3/5/6/7.
  - 158c3b5922 (blocker) merge order, knob → §4 table, P3a/P3b, P5, dependency map.
  - nonblocking (f01f8841b3, a3e70bf7a7, 549ec998b3, 79539f16d5, ec77ff7002, 025061cad2, 2fef9efaf6) → P1, P2, P3a steps 3/4/7, P0 S4/S5, P3b, §2.5 #5, §7, Q2.
- R1 (author, 2026-11-09): this revision; adds P6 (PM 01M709KFWF), adopts fleet review r0 (01M709MPCG); answers Q2, Q4.
- G2 (2026-11-09): verdict CONDITIONAL at cap (sol_chair, argon_deep CONDITIONAL; grok_skeptic STOP). 7 findings: 2 accepted_blocker, 5 accepted_nonblocking. R2 changes (fingerprint prefix → section):
  - 7f66863b0c (blocker) death never allows → P3a step 7, P0 S5, P3b, P5.
  - 3f30a8cd15 (blocker) expiry and sweep → P3a step 7, P4 via step 7, tests.
  - nonblocking (f2252196e2, f0b0b6a080, 53795fc96e, b50bfeeea1, 95a3bad48b) → P3a steps 1/7 and acceptance, P2, §3, §2.5 #5, §7.
- fleet hook-side review 01M70B86SY: no blockers; five points folded (r2a).
- PM ruling 01M70B8A2J: r2 accepted as the implementation base; Q1 changed to deny on timeout; Q3, Q5 as recommended.
- R2 (author, 2026-11-09): r2 edits are post-cap and go to the PM for a ruling; receipt binds to the as-reviewed g2 bytes (sha256 efc2f92759a9…).
