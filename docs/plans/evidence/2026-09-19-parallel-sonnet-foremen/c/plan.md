# Plan C — the park names the repair-round cost; a resume that cannot fit is refused honestly
1. RED: parked state exposes no estimate; a repair-authorising resume with remaining < round-1 cost is accepted.
2. Pure estimate function from the ledger (implement wall_secs + verify duration + review duration); null when rows are missing.
3. Park payload + summary + inspect carry wall_seconds_remaining / repair_round_estimate_seconds / repair_round_fits; old journals replay unchanged.
4. Resume preflight: repair-authorising disposition with remaining < estimate → campaign_wall_budget_insufficient_for_repair naming the shortfall; campaign stays parked. Non-repair dispositions unaffected.
5. Pins; sync mirrors; verify; ONE commit. No schema, no budget helpers, no terminalization code.
Acceptance: the 2-C shape (5435/7200, must-fix findings) parks with repair_round_fits=false and a --resume is refused with the numbers instead of burning the round.
