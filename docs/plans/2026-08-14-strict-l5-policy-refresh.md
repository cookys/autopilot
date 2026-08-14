# strict /l5 正典 roster 更新規格（2026-08-14）

/ l5 的信任根是 `src/readiness/provider-bootstrap.js` 裡編譯進去的
`STRICT_L5_PROVIDER_POLICY`（6 條 tuple）＋ `STRICT_L5_CLAIM_IDS`。
`deriveStrictL5InvocationPolicy()` 要求 roster **逐位元覆蓋**這 6 條，
否則 `strict_l5_provider_roster_drift`。

本文件是「模型出新版時怎麼正確更新它」的完整步驟，含本輪已驗到的事實。

## 為什麼現在該更新（兩個獨立理由）

1. **使用者裁定**：qc 席的 `gpt-5.5 / xhigh` → `gpt-5.6-sol / max`。
   已實測可用：`codex exec --model gpt-5.6-sol -c model_reasoning_effort=max`
   回 `OK`（codex-cli **0.147.0**）。
2. **現有 claim 已經對不上安裝的 CLI**：archived claim 的
   `target_identity.cli_version` 是 **0.146.0**、`binary_realpath` 指向
   `.../0.146.0-x86_64-unknown-linux-musl/bin/codex`，但機器上現在是
   **0.147.0**（`/home/cookys/.codex/packages/standalone/releases/0.147.0-.../bin/codex`）。
   即使不換模型，這條也該重簽。

另外 `freshness.expires_at` 是 **2026-08-17**——整組 D4 claim 三天後到期。

## claim 的真實結構（不是可以手寫的常數）

`scripts/platform-capability-claims.js`：

```
claim_id = cap-v1-<sha256( canonicalJson( claim body 去掉
                            claim_id / status / revalidation.validated_at ) )>
```

body 含：`capability_id`、`target_identity`（tuple ＋ **binary_realpath** ＋
**cli_version**）、`official_contract`（locator ＋ **document_sha256** ＋ assertion）、
`live_evidence`（cli_version、**probe_command_sha256**、**probe_output_sha256**、
behavior_class、observed_at、ttl_seconds、result、transport_binding）、
`agreement`、`freshness`、`revalidation`。

**官方契約綁的是 autopilot 自己的 config**——已驗證：archived claim 的
`document_sha256 = 4467825f9d…` 等於本 repo `.claude/review-loop-config.md`
在 commit `6c007ee7`（2026-08-03）的 sha256。不是消費端 repo 的。

⚠ **所以改契約文件會讓六條 claim id 全部重算**，不是只有動到的那條。

## 步驟

1. 改 **autopilot 自己的** `.claude/review-loop-config.md` 的 review roster：
   qc 席 `gpt-5.5 / xhigh` → `gpt-5.6-sol / max`。
   （implementer 維持 **grok-4.5**——使用者指定，理由是它快。
   VA 維持 **GLM-5.2**——2026-08 曾拿掉 agy Gemini 3.6 Flash，因為幻覺太多。）
2. 對 6 條 tuple 逐一取現場證據：binary realpath、cli_version、
   probe 指令與輸出的 sha256。六條是：

   | role | runner | model | effort | endpoint | family |
   |---|---|---|---|---|---|
   | implementer | grok | grok-4.5 | high | — | xai |
   | reviewer | cc-shim | MiniMax-M3 | high | minimax | minimax |
   | verification_author | cc-shim | GLM-5.2 | high | glm | zhipu |
   | qc | cc-shim | GLM-5.2 | high | glm | zhipu |
   | qc | codex | **gpt-5.6-sol** | **max** | — | openai |
   | qc | cc-shim | MiniMax-M3 | high | minimax | minimax |

   ⚠ 正典用的是 **cc-shim**，不是 revival.3d 目前用的 `anthropic-compatible`。
   兩者是不同 runner，要各自驗。
3. `node scripts/platform-capability-claims.js generate --input <probe-input.json>
   --output <claims.json>` → 拿到六個新 `claim_id`。
4. 更新 `STRICT_L5_CLAIM_IDS` ＋ `STRICT_L5_PROVIDER_POLICY`
   （`STRICT_L5_PROVIDER_POLICY_DIGEST` 會自動重算），**兩棵樹都要**：
   `src/readiness/provider-bootstrap.js` 與
   `platforms/codex/plugin/src/readiness/provider-bootstrap.js`。
5. 消費端 roster 對齊：revival.3d 的 `.claude/review-loop-config.md` 改成
   **正好那 6 席**（7→6：沒有 kimi、沒有 fable-5、沒有 gemini VA）。
6. 驗收：
   - `node -e "deriveStrictL5InvocationPolicy(resolve-review-loop --check-scorecard)"`
     不再丟 `roster_drift`
   - `hooks/tests/provider-readiness.test.sh`、`dispatch-author*.test.sh`
   - `status readiness --json --probe` 七席（現為六席）live 全綠
   - 真正跑一次 `engine implement-review` 的 bootstrap

## 本輪已完成的前置（都與本更新獨立有效）

- agy 的 bwrap 沒有可寫 state dir → 30 KB stdout 噪音（`4ea96150`）
- readiness probe 把 `script(1)` transcript chrome 當回應（同上）
- kimi 從未接上 author path（`2a2cf33e`）
- live probe 的 `max_output_tokens: 4` 對會先推理的模型太緊 → 32（`7aa955a3`）
