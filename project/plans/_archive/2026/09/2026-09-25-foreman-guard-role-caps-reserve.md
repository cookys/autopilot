# Plan — foreman-guard: role-aware caps, a close-out reserve, and advisories the model can see

> Status: proposed · Owner: depth-0 (cookys) · Frame: L, per `references/plan-template.md` · Version target: next PATCH
> Source: BACKLOG row "PEER-REPORTED (openclaw): foreman-guard needs role-aware Bash caps and a close-out reserve"
> (`docs/backlog/foreman-guard-role-aware-caps.md`), narrowed by the operator on 2026-09-25 (the "縮小版" decision below).

## 0. Context / thesis
`hooks/foreman-guard.js` (v2.35.15) caps every l4–l6 subagent at 40 Bash calls. The cap was sized for resident foremen,
but it also hits depth-2 workers and reviewers. The hangar session on openclaw reported about 15 mid-item cutoffs:
- some workers were cut off right before `git commit`;
- some reviewers were cut off mid-e2e and left sandboxes that held test credentials.

The operator accepted a narrowed version of the peer plan:
- role-aware caps;
- a close-out reserve;
- **no hard cap when no l4–l6 marker is active — an advisory only**;
- a cost-shaped gate deferred to its own BACKLOG row.

A 2026-09-25 documentation check (code.claude.com/docs/en/hooks) found a defect that this plan has to fix first:
"Stderr from a hook that exits 0 goes to the debug log only, … and Claude never sees it." So every `mode=warn`
line foreman-guard has printed so far never reached the model. Text in `hookSpecificOutput.additionalContext` does reach it, on any decision.

## 1. Problem
Subagents that do legitimate multi-step work are killed at an arbitrary call count, before they can commit or clean up. The only
"soft" channel the guard has is invisible to the model, and an agent that is not running under a marker gets no signal at all.

## 2. OKR / KRs
- **KR1**: a subagent whose prompt declares `Role: worker` or `Role: reviewer` is allowed up to its role cap (default 120) and is denied at cap+1.
  A subagent that declares nothing, or declares `Role: foreman`, keeps 40. This is proven by hook tests with the role read from a fixture transcript.
- **KR2**: in the last 8 calls before any cap, only the reserve allowlist is admitted. The test shows `cargo build` denied and `git commit -m x` allowed,
  and the call that enters the reserve carries a model-visible `additionalContext` directive.
- **KR3**: with no l4–l6 marker, an autopilot-dispatched subagent (first line `Engine:`) is never denied by the count, and it receives one `additionalContext` advisory at calls 40, 80, and 120.
- **KR4**: `mode=warn` and every advisory are delivered through `additionalContext` (tested). The polling, Monitor, and context-ceiling rules keep their deny behavior.
  `hooks/tests/foreman-guard.test.sh` stays green. Two groups of its assertions may change, and no others: (i) those that pin the OLD warn/diagnostic channel
  (an allow with empty stdout plus a stderr line), and (ii) the Bash-cap loop, whose calls inside the reserve now use allowlisted commands or expect the reserve deny. They may change and only to expect the new `additionalContext` JSON on stdout. Each changed assertion is listed in the commit message, and none is deleted.

## 2.5 Global Constraints (copied verbatim into every implementer + reviewer dispatch)
- Node ≥ 20.10, built-ins only; foreman-guard stays fail-open (an internal error ⇒ exit 0, no output).
- Under an ACTIVE l4–l6 marker, an agent without a `Role:` line keeps the SAME cap value (40, still denied at 41). The one intended change is that its last
  effective-reserve calls (P3) admit only the close-out allowlist. This is deliberate: the reported harm is foremen cut off before commit.
- A hook never trusts the child's own later output for its role. The role comes only from the child's FIRST user message
  (the dispatcher-written prompt) or from P0's chosen equivalent.
- New cases go in a NEW suite `hooks/tests/foreman-guard-roles.test.sh` (`chmod +x`). Do not append cases to `foreman-guard.test.sh`.
  The only allowed edits there are KR4's re-expectations (the warn/diagnostic channel and the cap loop).
- Do not edit CHANGELOG, the version, or `.claude-plugin/plugin.json` in the implementation commits; depth-0 lands the release.

## 2.6 Change-policy decisions
- **Compatibility**: additive. The config gains `foreman_guard.role_caps` / `reserve_calls` / `advisory_every` and env equivalents. Existing keys and their defaults are unchanged.
- **Dependency**: none.

## 3. File-structure map
- `hooks/foreman-guard.js`: role resolution, per-role cap, reserve allowlist, no-marker advisory path, additionalContext delivery.
- `hooks/tests/foreman-guard-roles.test.sh` (NEW): KR1–KR4.
- `hooks/README.md` (foreman-guard row); `skills/ceo-agent/references/level-front-door.md` (in-loop enforcement §);
  `skills/l4|l5|l6/SKILL.md` (the 一刀一命 bullet: where the `Role:` line goes), plus the codex mirrors via `scripts/sync-codex-plugin-skills.sh`.
- Checked 2026-09-25: `level-front-door.md` and `skills/l4|l5|l6/SKILL.md` are not hashed in the `profiles/` chain (they are named only in rationale prose), and dev-flow and ceo-agent SKILL.md are untouched.
- `hooks/dispatch-model-guard.js`: read only. Confirm that a `Role:` line on line 2 (after `Engine:`) passes. Edit it only if P0 shows it does not.

## 4. Phases
**P0 (S) spike: confirm route (a′), the child's own transcript. — DONE 2026-09-25: `ROUTE-A-PRIME: HOLDS`** (evidence `docs/plans/evidence/2026-09-25-foreman-guard-roles/p0/RULING.md`):
- the payload's `agent_id` equals the transcript's `agentId` for foreground, background, and nested children;
- `transcript_path` is always the ROOT session file, even for a nested child;
- `<dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl` is flat and exists at the child's first Bash call;
- the first line's content starts verbatim with `Engine: sonnet\nRole: …`;
- `agent_type` is `general-purpose` for all three, and the payload has no parent id;
- depth-0's payload has no `agent_id`.

P2 and P4 therefore stay in scope. Original spike design, kept for the record: Pre-check (depth-0, 2026-09-25, this session): a completed
subagent's transcript lives at `~/.claude/projects/<project-slug>/<session_id>/subagents/agent-<agentId>.jsonl`. Its FIRST line is
`type:"user"` whose `message.content` is the dispatcher's prompt (it began `Engine: sonnet`), and it carries `agentId` and `sessionId`.
Route (a′) is therefore: derive `<dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl` from the hook payload, read only its first line
(bounded, ≤ 64 KiB), and take the role from `message.content`. The child does not rewrite its own first message in normal operation, so the role stays dispatcher-owned (deliberate tampering is a named residual risk in §6).
The spike confirms this with a real hook in a scratch project (`claude -p` spawning one foreground child, one background child, and one depth-2 child; a PreToolUse dump hook):
- (1) the payload's `agent_id` equals the transcript's `agentId`;
- (2) `transcript_path` in the child's payload lets the path be derived: whichever file it names, the `<session>/subagents/` layout must hold;
- (3) the file exists at the child's FIRST Bash call, for foreground spawns and for depth-2 spawns;
- (4) `agent_type` values.

Evidence goes under `docs/plans/evidence/2026-09-25-foreman-guard-roles/p0/`. **Acceptance**: raw payloads plus a one-paragraph ruling.
**Stop condition**: if (a′) fails, then P2 (roles) and P4 (the no-marker advisory, which needs the same read) are DROPPED from this plan, and P1, P3, and P5 ship alone.
Any other route (a PostToolUse registry adds a hook file, hooks.json wiring, a hook-inventory row, and a hook-count bump) requires a plan revision, not an in-flight change.

**P1 (S) advisories reach the model.** First, a live acceptance probe using the same scratch-project method as P0: a PreToolUse hook that ALLOWS a subagent's Bash call and
injects a nonce via `additionalContext`, where the subagent is told to repeat any hook nonce it sees. Record the result under the P0 evidence dir. If the nonce does NOT reach the
subagent, deliver advisories and the reserve-entry directive as the reason of a DENY instead (deny reasons are documented to reach the model), drop P4, and note this in §6.
Then: Replace the stderr-only `mode=warn` line and the ambiguous-rows diagnostic with
`hookSpecificOutput.additionalContext` on an allow (keep the stderr copy for the debug log). **Acceptance**: KR4 test.

**P2 (S) role-aware caps.** Resolve the role through the P0 route (a′).
- **No cache**: the role is re-derived on EVERY call. The per-agent state file holds only counters, never a role.
- **Parse, anchored**: take `message.content` of the first JSONL record, only when that record has `type:"user"` and its `agentId` equals the payload's `agent_id`, and `message.content` is a string (anything else ⇒ foreman).
  Split it on `\n`, look at lines 1–5 only, and match each line against `^Role: (foreman|worker|reviewer)$` (whole line, case-sensitive). The first match wins.
  A bare word `worker` elsewhere never counts.
- **Total fallback**: every failure yields role `foreman` and never an exception or a pass. That covers a missing or non-string `transcript_path`, a missing file, an unreadable file, a first
  line over 64 KiB or not JSON, a record-type or `agentId` mismatch, and no matching line. The resolution runs inside its own try/catch, so the guard's top-level fail-open can never turn
  a role-read failure into "uncapped". Caps come from `foreman_guard.role_caps` (default foreman 40, worker 120, reviewer 120), with `AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS`
as `worker=120,reviewer=120`, which overlays the defaults per key (omitted keys keep their defaults, foreman stays 40 unless named, malformed pairs are ignored).
Role code runs only after the existing inert gate, so a payload without `agent_id` (depth-0) never reaches it; a test pins this.
The deny text names the role and its cap. **Acceptance**: KR1.

**P3 (S) close-out reserve.** Once `n > cap − reserve_calls` (default 8), every executable segment of the command (the existing `executableText`,
split on `;`, `&&`, `||`, `|`, and newline) must match the allowlist:
- `git status|diff|add|commit|log|show|rev-parse|restore --staged`;
- `kill <digits…>`;
- `rm`/`rm -r`/`rm -rf`/`rmdir` where every path operand is absolute under `/tmp/` or `$TMPDIR`;
- `cd <path>`, `mkdir -p`, `ls`, `test`/`[`;
- a file write via `cat >`/`tee`/`printf … >` (the handoff).

Anything else is denied with the reserve directive. The effective reserve is `min(reserve_calls, floor(cap/2))`, so a small `bash_cap` never becomes all-reserve.
The reserve directive, used both for entry and for every reserve denial, is one fixed string that NAMES the allowed verbs:
"Close-out reserve: N call(s) left before the cap. Allowed now: cd; git status/diff/add/commit/log/show/rev-parse/restore --staged; kill <pid>; rm/rmdir under /tmp or $TMPDIR; mkdir -p; ls; test; writing a file (cat >, tee, printf >). Commit, clean up, write your handoff, and end the turn." The reserve counts ATTEMPTS, the same accounting as the cap (a denied call still spends one):
8 denied non-allowlist attempts exhaust it. The first call inside the reserve carries that same directive as `additionalContext`. In P1's deny-reason fallback, the directive is instead delivered on the first
non-allowlisted reserve call (which is denied anyway), so the announcement never spends an extra call.
Matching: a segment matches an entry by its leading argv words (`git` + a listed subcommand; `kill` + digit-only arguments), and further arguments are free.
The rm/rmdir paths must be absolute under `/tmp/` or the hook's own `process.env.TMPDIR`; the literal `$TMPDIR/` and `${TMPDIR}/` are expanded with the same value. **Acceptance**: KR2, plus negative controls: a recursive rm of a path outside `/tmp/` or `$TMPDIR` is denied in the reserve, and 8 denied `cargo build` attempts made AFTER the reserve opens exhaust it, so the next `git commit` hits the cap. An inversion case: a later transcript record containing
`Role: worker` with none in the first record resolves to foreman at 40.

**P4 (S) no-marker advisory (depends on P0).** It applies ONLY to autopilot-dispatched subagents, meaning the first message (read via route a′)
starts with an `Engine:` line. Explore, Plan, claude-code-guide, `/code-review` subagents and every other agent stay fully inert, as they are today.
With `agent_id` present, an `Engine:` first line, and no active l4–l6 marker: count calls in the same state store and never deny on the count.
At every `advisory_every` (default 40) calls, emit one `additionalContext` telling the agent to commit its work and consider handing off.
Polling, Monitor, and ceiling rules stay marker-scoped (unchanged). State GC: at most once per hour per store (a stamp file), bounded to 500 entries per pass, inside its own try/catch; it deletes files with mtime > 7 days.
**Acceptance**: KR3, plus a case where an agent without an `Engine:` line gets no advisory and no state file.

**P5 (S) docs.** Change the `hooks/README.md` row and the level-front-door "In-loop enforcement" section; in `skills/l4|l5|l6` 一刀一命, say that
dispatchers put `Role: worker|reviewer` on line 2 of a worker or reviewer prompt, after the `Engine:` line. Sync the mirrors.
**Acceptance**: `sync-codex-plugin-skills.sh --check`, `validate.sh`, and `doc-drift-gate.js .` with no new FAIL.

## 5. Test / validation
- `hooks/tests/foreman-guard-roles.test.sh` (new, RED at base for KR1–KR4), `hooks/tests/foreman-guard.test.sh`, and `hooks/tests/dispatch-model-guard.test.sh`.
- Every consumer suite that `grep -l foreman-guard hooks/tests/*.sh` finds.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.
- At landing: the full `hooks/tests/run.sh --parallel 8`, with reds rerun solo and compared at base.

## 6. Risks + inversion
- 🟠 **Role laundering**: a foreman spawns a `Role: worker` child to run its polling loop. That is accepted for now, because polling and Monitor rules still apply to every
  role under the marker. The per-subtree budget becomes a follow-up BACKLOG row.
- (P0 resolved: route a′ holds; the earlier fallback risk is retired.)
- 🟡 **The reserve allowlist is too tight** and a legitimate close-out command is denied. `warn` mode still exists as an escape hatch, and the directive names the allowed verbs.
- 🟡 **Transcript tampering**: a child could deliberately edit its own transcript file to claim `Role: worker`. That is accepted. The guard is cost discipline, not a security boundary,
  and a child with Bash could equally flip the mode env or the config.
- Inversion: what guarantees failure? A role read from anything the child writes itself, or an advisory that goes to stderr. Both are excluded by §2.5 and P1.

## 7. Out of scope
- A cost-shaped gate (cumulative cache-read tokens or lifetime), including coverage of clone-based foremen whose marker is INACTIVE. This becomes a new BACKLOG row at landing.
- A foreman lifetime cap, a per-subtree budget, and a signed role header.
- Any hard cap on the no-marker path (operator decision, 2026-09-25).

## 8. Open questions
None for the Board. P0 may create one (see its stop condition).

## Review log
R0 author: depth-0 (opus), 2026-09-25.
G1 (2026-09-25): policy stop `required_seat_transport_exhausted`. The chair seat (gpt-5.6-sol/codex) hit codex usage-limit exhaustion until 2026-09-26 16:35;
grok-4.6 (deep) and MiniMax-M3 (third) returned unratified observations. Depth-0 accepted and folded all of them: R2 (a total no-Role fallback), R3 (an anchored first-record parse),
R4 (the old-suite re-expectation rule and the reserve clamp), R8 (the reserve directive names the verbs), R7 (removed the stale P0-failure CHANGELOG line).
G1 re-run (chair swapped to claude-fable-5-1 for this run only, operator-approved; prior sealed state kept as `<hash>.g1-transport-stop`): CONDITIONAL with 9 findings and 2 blockers.
Dispositions are in `2026-09-25-foreman-guard-role-caps-reserve.g1-dispositions.json`:
- accepted blockers: R2 reserve-vs-default and R4 cap-loop re-expectation, the same root. The reserve applies to foremen by intent, and §2.5 and KR4 are reworded.
- accepted and folded: cd, no role cache, non-string content, GC bounds, and a live additionalContext probe with a deny-reason fallback.
- rejected with rationale: heredoc splitting (executableText drops bodies) and the reserve verbs (already one fixed string for entry and denials).
G2 (terminal at the generation cap): CONDITIONAL with 13 findings and 3 blockers, which are really two leftovers from the G1 fold (a stale role-cache sentence and a stale short reserve text).
Depth-0 adjudicated them in `…g2-dispositions.json`, and the freeze check exited 0 against the G2 artifact. This commit is the bounded repair:
- deleted both stale texts;
- env per-key overlay;
- the TMPDIR matching rule and argv-prefix matching;
- the fallback announcement costs no call;
- the KR2 timing and an inversion test case;
- a tampering residual risk.
Refuted: the R2 wording (decided in G1) and depth-0 capping (the inert gate precedes role code). No G3.
