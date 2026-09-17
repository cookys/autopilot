# Blind review redesign — cut 1c: a configurable packet deny-list (additive, hash-bound)

> Status: DRAFT (written while the 1b-B campaign ran; base and line anchors to be re-verified at the
> 1b-B merge) · Size: M · Base: `<1b-B merge>` (v2.36.63; 1b-B merged as `bc4ea99e` — pin the release commit at the plan loop) · Parent: `docs/plans/2026-09-16-blind-review-packet.md`
> §3 (line 259: "revisit when the deny-list becomes configurable (1b)") and §7 item 3 (line 312:
> "configurable deny-list"). Siblings: 1b-A launcher (v2.36.62), 1b-B intake probe (v2.36.63).
> Evidence dir: `docs/plans/evidence/2026-09-17-blind-review-packet-deny-config/`.

## 0. What is actually true today (verified 2026-09-17 at `130b97a8`; re-verify at base)

- `src/runners/review-packet.js:8-17` `DEFAULT_PACKET_DENY_LIST` is a frozen array of eight patterns
  (`.autopilot/**`, `.qc/**`, `docs/plans/evidence/**`, `docs/plans/**/*.review.md`,
  `docs/plans/**/*.review.json`, `docs/plans/**/*disposition*.json`, `**/*.receipt.json`,
  `**/*.raw.log`). `normalizeDenyList` (`:106-114`) accepts `null` (→ the default) or an array of
  strings, rejects absolute/`.`/`..`/empty/other-glob patterns with `invalid deny-list pattern`, and
  returns a deduped sorted array; `packetPathDenied` (`:142-156`) is ancestor-prefix (a path is denied
  when it or any ancestor matches); `buildReviewPacket({ …, denyList })` (`:311-320`) normalizes the
  option and writes the normalized list into `MANIFEST.json` `deny_list` and into the `packet_hash`
  preimage (`:549-562`) — so a different deny list already yields a different hash.
- Nothing above the builder passes a deny list: `src/runners/review.js` `dispatchReview` forwards only
  `packet.repo/baseSha/candidateSha` (`:232-239`); `autopilot-engine.js` `reviewPacketIdentity`
  (`:61-69`) extracts exactly those three keys and drops anything else; the two packet call sites
  (`:4914-4917`, `:9845-9848`) read no config. No config field, env var or schema entry mentions the
  deny list (grep `deny_list|denyList|PACKET_DENY|review_packet` across `src scripts schemas .claude
  hooks`: hits only in the builder, its test and `references/blind-dispatch.md:335-348`).
- Config mechanism: `schemas/review-loop-contract.schema.json` `x-field-order` fixes the always-on
  field set; the JS resolver (`src/engine/resolve-review-loop.js`) derives its field list from the
  schema; `scripts/check-contract-schema.js` proves the shell resolver agrees (field set + every
  `x-shell-validated` enum). Array-shaped conditional fields follow the `qc_panel_endpoints`
  pattern (`resolve-review-loop.sh:626,746-776`: `read_field`, per-element validation, fail closed),
  outside `x-field-order`.
- `hooks/tests/review-packet.test.sh:669` pins `DEFAULT_PACKET_DENY_LIST.length === 8`; cases (e)/(f)/(g)
  (`:247-306`) cover order-insensitivity, the empty list, and the grammar.

## 1. Ruling and shape

1. **Additive only.** A consumer can widen the deny list, never narrow it: the effective list is
   `normalizeDenyList([...DEFAULT_PACKET_DENY_LIST, ...extra])`. The eight defaults are the floor
   (they name the verdict/receipt/evidence surfaces whose leak defeats blind review); "remove a
   default" is not a knob (would need its own ruling; out of scope).
2. **One field, one grammar.** `.claude/review-loop-config.md` gains `review_packet_deny_extra`
   (conditional, array of patterns, default empty; omitted ⇒ `[]`). Grammar is exactly
   `normalizeDenyList`'s: relative, `/`-joined, `**` whole-segment, `*` within a segment, nothing
   else; the shell resolver validates each element with the same rule set as a regex and fails
   closed with `review_packet_deny_extra[i] invalid pattern: <p>` (same fail-closed posture as
   `qc_panel_endpoints`); the JS resolver validates by calling `normalizeDenyList` (one grammar
   owner — the builder's; the shell regex is proven equal by a parity case over the (g) table).
3. **Plumbing, no new shape.** The resolver emits `review_packet_deny_extra` (array, possibly
   empty) in its JSON; `reviewPacketIdentity` accepts an optional `denyExtra` (array of strings,
   else `prepare_review` block "packet deny extra malformed"); both engine packet call sites pass
   `denyExtra: roster.review_packet_deny_extra || []`; `dispatchReview` forwards
   `denyList: normalizeDenyList([...DEFAULT_PACKET_DENY_LIST, ...denyExtra])` to `buildReviewPacket`.
   `MANIFEST.json` `deny_list` and `packet_hash` already carry the effective list, so a widened
   list is visible and hash-bound with zero new fields; `packet_hash` mixed/mismatch rules
   (v2.36.61) are unchanged.
4. **Not a leak channel.** The extra patterns come from the trusted dispatcher config, never from
   the diff, the spec, or a seat; the runner rail (`dispatch-review.sh`) reads nothing new.
5. **Codex mirror in lockstep**; `check-contract-schema.js` green; `x-field-order` unchanged (the
   field is conditional like `qc_panel_endpoints`, so the always-on set does not move).

## 2. Changes by file (+ codex mirrors)

- `schemas/review-loop-contract.schema.json`: `review_packet_deny_extra` — `type: array`, `items:
  string` with the grammar as `pattern`, `default: []`, documented conditional (not in `x-field-order`).
- `scripts/resolve-review-loop.sh`: `read_field … review_packet_deny_extra`, per-element regex
  validation fail-closed, emitted as a JSON array in both printf templates' conditional block.
- `src/engine/resolve-review-loop.js`: validate via `normalizeDenyList` (import from the builder);
  emit the array.
- `src/engine/autopilot-engine.js`: `reviewPacketIdentity` optional `denyExtra`; both call sites.
- `src/runners/review.js`: compose the effective list; pass `denyList`.
- `src/runners/review-packet.js`: NONE (export already sufficient) — byte-identical unless a
  `composeDenyList(extra)` helper is preferred (decide at G1; default: no change).
- Tests (RED-first, `# RED at base <1b-B merge>: <observed>`): `resolve-review-loop.test.sh`
  (field absent ⇒ `[]`; valid list echoed sorted/deduped; invalid element fails closed with the
  message; shell/JS grammar parity over the (g) table), `review-runner.test.sh` (stub builder sees
  the composed list; defaults always present; extra pattern denies a planted path and changes
  `packet_hash`), `autopilot-engine.test.sh` (malformed `denyExtra` → `prepare_review` block; roster
  field threaded to both call sites), `contract-parity.test.sh` / `check-contract-schema.js` green,
  `review-packet.test.sh:669` length pin untouched.
- Docs: `references/blind-dispatch.md` "Deny-list" paragraph (`:337-347`) gains "Widening it
  (`review_packet_deny_extra`)"; `.claude/review-loop-config.md` field doc + template
  `project-config-template/review-loop-config.md`; `docs/BACKLOG.md` redesign row Context →
  `… 1b-B v2.36.63, 1c deny-list v2.36.64. Open: cut 2. …` (≤240 B, Status `open`).

### 2.5 Sealed `output_paths` (draft; re-check mirrors at base)

```
schemas/review-loop-contract.schema.json
platforms/codex/plugin/schemas/review-loop-contract.schema.json
scripts/resolve-review-loop.sh
platforms/codex/plugin/scripts/resolve-review-loop.sh
src/engine/resolve-review-loop.js
platforms/codex/plugin/src/engine/resolve-review-loop.js
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/runners/review.js
platforms/codex/plugin/src/runners/review.js
hooks/tests/resolve-review-loop.test.sh
hooks/tests/review-runner.test.sh
hooks/tests/autopilot-engine.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
.claude/review-loop-config.md
project-config-template/review-loop-config.md
docs/BACKLOG.md
```

### 2.6 Global constraints

- Defaults are a floor: no code path can produce an effective list missing a default pattern.
- One grammar owner (`normalizeDenyList`); the shell regex is parity-tested against it, never a
  second definition of the language.
- `review-packet.js`, `dispatch-review.sh`, `cleanroom-launch.sh`, `campaign-intake.js` byte-identical.
- No new receipt/attestation: the manifest's existing `deny_list` + `packet_hash` are the record.

## 3. Out of scope
Removing defaults; per-seat deny lists; deny-list for the cleanroom tree mount (the packet tree IS
the mount, so this cut covers it by construction); cut 2.

## 4. Acceptance
| id | criterion | evidence |
|----|-----------|----------|
| `additive` | effective list ⊇ defaults for every config; extra pattern denies a planted path; `packet_hash` changes | review-runner suite |
| `grammar` | invalid element fails closed in shell and JS with the same message class; parity over the (g) table | resolve-review-loop suite |
| `plumbing` | roster field reaches both engine call sites; malformed → `prepare_review` block; absent ⇒ `[]` | autopilot-engine suite |
| `contract` | `check-contract-schema.js` green; `x-field-order` unchanged | command output |
| `no-regression` | §4.1 all exit 0 at candidate; base recorded | evidence |
| `scope-integrity` | diff ⊆ §2.5; builder/rail/launcher/intake byte-identical | command output |

### 4.1 No-regression commands (draft)
```
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/review-packet.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/contract-parity.test.sh
node scripts/check-contract-schema.js
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
```

## 5. Dogfood proof (depth-0)
On this repo: add `review_packet_deny_extra: docs/projects/ongoing-maintenance/HANDOFF.md` to a
scratch config, build a packet through the candidate engine's `reviewDiff` against MiniMax, and
show `MANIFEST.json` `deny_list` carries it, the tree lacks the file, and `packet_hash` differs from
the default-list build of the same range; then the same run with an invalid pattern is refused
before any seat is spent.

## 6. Risks + inversion
- **Silent narrowing** — impossible by construction (§1.1); the engine suite asserts defaults present.
- **Grammar drift** shell vs JS — parity case over the (g) table, both directions.
- **Field-order gate** — conditional field, so `x-field-order` and `required` do not move.

## 7. Where this sits
1a-A ✓ → 1a-B ✓ → 1b-A ✓ → 1b-B (running) → **1c (this)** → 2.

## Review log
- (pending)
