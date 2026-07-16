# Website loop review log (2026-07-16)

Engines: **codex `gpt-5.6-sol`** · **agy `gemini-3-flash`**

## Conditions (user)

1. Taiwan 正體 + Taiwan engineer vocabulary for zh-TW  
2. zh-TW layout not EN clone (`.lp--zh` CSS)  
3. State machine accuracy vs /l3–/l6 SSOT  
4. Real `dispatch-review.sh` multi-round loop  
5. **UX:** no multi-clause wall text; structure HTML (not `\n` as layout)

## Rounds

| Round | Runner | Raw verdict | Action taken |
|-------|--------|-------------|--------------|
| R1 | codex | NEEDS-WORK | diagrams; zh; light theme |
| R2 | codex + agy | NEEDS-WORK / ARG_MAX | light hero; DIVERGE?; VERDICT-blocking; 調研 |
| R3 | codex + agy compact | NEEDS-WORK | /onboard honesty; H1 light; table headers |
| R4 | codex | NEEDS-WORK residual | letter-spacing; calques |
| **UX-R1** | codex + agy | FIX-THEN-SHIP on **truncated CSS extract** | Real CSS braces balanced (364/364); shipped lead stacks |

## UX structure shipped

| Page | Before | After |
|------|--------|--------|
| Levels hero | One wall `/l3…/l4…/l5…/l6…` | intro + **list cards** per level + foot |
| Landing | long def/lead | `defLines` / `leadLines` → separate `<p>` |
| Demo / Philosophy / Install / Proof / Recipes | wall leads | `leadLines` / stacks / bullets |
| CSS | — | `.lp-lead-stack`, `.lp-lead-list`, `.lp-bullet-stack` |

**Not used:** raw `\n` → `<br>` for body copy. Commands stay in `<pre><code>`.

## Residual

- Review corpus truncation can false-flag CSS; always validate braces on disk.  
- Dual VERDICT lines confuse JSON parser; raw log is SSOT.

## Light theme contrast (hetero)

| Round | Engines | Findings → fixes |
|-------|---------|------------------|
| L1 | codex + agy | eng-node black bg + dark text; cyan on primary; code pastels; kicker weak |
| L2 | codex | enforce light primary fg/bg; kicker #475569; eng-node code darker |

Shipped: theme-aware nodes, locked code wells (#0f172a + light text), primary ink override, light surface pass.

## Landing dual-day UX (hetero author 2026-07-16)

Engines: **codex `gpt-5.5`** · **agy `gemini-3-flash`** via `dispatch-author.sh`  
(Note: `dispatch-review` wrongly framed this as code review — use **author** for UX design.)

| | Before | After |
|--|--------|--------|
| Pattern | 4 numbered tabs → YOU\|SYSTEM expand | **同一張工單、兩種一天** dual timeline |
| Narrative | Internal step lookup (進場/發想…) | Time burden: always-on vs leave-the-chair |
| Jargon | state machine / /l5 / event trace on landing | Reserved for `/demo`; landing CTA = 看完整控制流 |
| Verdict | — | **REVISE-LANDING** (both engines) |

Plan: [`LANDING-UX-PANEL.md`](./LANDING-UX-PANEL.md). Shipped in `Landing.vue` + `.lp-day` CSS.

## LAN

- Levels: http://192.168.101.4:5173/autopilot/zh-TW/levels  
- Home: http://192.168.101.4:5173/autopilot/zh-TW/  

Hard refresh (Ctrl+Shift+R). Toggle **light** and check primary CTA + dual-day compare + demo tables.
