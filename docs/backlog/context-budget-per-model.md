# context-budget per-model T1/T2 (BL-0205)

Peer request (c4140 llm-playground lead, fleet 01M53QFATXC3KKEBJ0EAMTBM9H): cache-read price differs by model, so one absolute T1/T2 costs different amounts per turn.

Chosen shape: `context_budget.per_model = { "<model glob>": { t1, t2 } }`; model id from the statusline live file `model.id`; most specific glob wins; no match or no id uses the top-level tiers; env T1/T2 still win; only t1/t2 as positive integers.
