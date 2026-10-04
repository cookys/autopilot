# S9 — band redesign: project, phase, elapsed, progress with a verdict word (mods P1c C3)

Verdict: the `live` band now answers "which project, which phase, how long, how far" for a person who left the computer,
led by one of four verdict words. Cost and context moved to the pane header. Text only; the renderings below are the drawn
trees captured from the `claude plugin test` kit (terminal surface, fixture world of `mods/live/live.test.ts`,
mocked clock 2026-10-04T10:00:30Z, earliest run start 09:50:00Z, so elapsed is `10m`).

Capture command (throwaway wrapper plugin named `autopilot`, copy of `mods/`, plus a capture-only test file that
`console.log`s `bandParts` / `paneParts`; not committed): `claude plugin test .` in the wrapper, isolated HOME and
CLAUDE_CONFIG_DIR. The four captures follow.

## 要你決定

```
▲ 要你決定 repo · — · 10m · 62.5%（5/8）
要合併 plan 還是拆開？
```

progress cell drawn dim: no

Pane, first rows:

```
session $0.42 · host $3.10 · ctx 37%
要你決定
要合併 plan 還是拆開？
1. 合併 — 一次驗收
2. 拆開 — 兩次驗收
```

## 疑似卡住

```
⏸ 疑似卡住 repo · — · 10m · 3 done*
最久的派工 4m 沒有輸出
```

progress cell drawn dim: yes (unfrozen denominator)

Pane, first rows:

```
session $0.42 · host $3.10 · ctx 37%
dispatch · execution status, not progress (執行狀態，不是進度)
r1 · implementer · codex/gpt · started 17:50 · elapsed 600s · phase running · rc — · final — · probe 5s ago
```

## 完成待驗收

```
✓ 完成待驗收 repo · — · 10m · 100%（8/8）
驗收結論尚未出
```

progress cell drawn dim: no

Pane, first rows:

```
session $0.42 · host $3.10 · ctx 37%
dispatch · execution status, not progress (執行狀態，不是進度)
r9 · implementer · codex/gpt · started 17:50 · elapsed 600s · phase exited · rc 0 · final done · probe 5s ago
```

## 進行中

```
● 進行中 repo · — · 10m · 62.5%（5/8）
1 個派工在跑
```

progress cell drawn dim: no

Pane, first rows:

```
session $0.42 · host $3.10 · ctx 37%
dispatch · execution status, not progress (執行狀態，不是進度)
r1 · implementer · codex/gpt · started 17:50 · elapsed 600s · phase running · rc — · final — · probe 5s ago
```

## Fields used (review-job-model/1, from the P1b renderer's `buildJobModel`)

- `needs_decision` (boolean), `decision` = `{ question, options: [{ label, consequence }], not_authorized }`: the awaited decision.
- `progress` = `{ frozen, percent, done, total, remaining, per_deliverable, denominator_digest }`: `percent` and `total` are null unless frozen.
- `axes.acceptance` (`accepted` | `rejected` | `unknown`), `conclusion`, `gates[]`, `scope.repo_identity`.
- No human phase field exists: `gates[].phase` is a review-gate name and run rows carry the process phase, neither is a
  job phase, so the band's phase slot is `—`. Nothing is invented for it.

## What this does not prove

- The drawn trees come from the test kit, not from a real interactive session (no tmux capture of this redesign).
- (Superseded by S9b below) A nothing-live, nothing-awaited scope drew `○ <project> · …` with no word; it now draws `◌ 待命`.
- (Superseded by S9b below) The `phase` slot stayed `—` until the job model published a human phase; it now reads `phase.label`.


# S9b — the idle word 待命 and the job phase (mods P1c C3b-M)

The same `claude plugin test` kit and fixture world as above (terminal surface, mocked clock 2026-10-04T10:00:30Z, earliest
run start 09:50:00Z); a capture-only test (not committed) printed `bandParts`. The job model now carries
`phase: { code, label, source }` (renderer commit C3b-R) and the band slot shows `phase.label`.

Nothing live, nothing awaited, progress not complete, no phase published (the idle word, the fifth; the old `○` variant is gone):

```
◌ 待命 repo · — · 10m · 62.5%（5/8）
沒有派工在跑
```

The same scope with `phase: { code: 'TERMINAL_READY', label: '收尾', source: 'campaign' }`:

```
◌ 待命 repo · 收尾 · 10m · 62.5%（5/8）
沒有派工在跑
```

One run live and `phase: { code: 'c', label: '做 c', source: 'deliverable' }`:

```
● 進行中 repo · 做 c · 10m · 62.5%（5/8）
1 個派工在跑
```

Limits: the renderer can only see a terminal campaign phase (task receipt) or the first open deliverable (progress receipt),
so a run in progress with no frozen progress receipt still shows `—`; the live campaign phase is a follow-up. Text trees from
the test kit, not a real interactive session.
