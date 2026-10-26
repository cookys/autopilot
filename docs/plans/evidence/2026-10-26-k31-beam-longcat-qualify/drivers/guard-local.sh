#!/bin/bash
# Run every guard.yml step locally over origin/master..HEAD.
cd ~/projects/llm-playground
export RUNNER_TEMP=/tmp/claude-1000/-home-cookys-projects-llm-playground/ed053e45-2dc4-4c58-b697-94598c39635c/scratchpad/rt; mkdir -p $RUNNER_TEMP
B=$(git rev-parse origin/master); H=$(git rev-parse HEAD); fail=0
while IFS= read -r c; do out=$(timeout 600 bash -c "$c" 2>&1); rc=$?; [ $rc -ne 0 ] && { fail=1; echo "FAIL rc=$rc: $c"; echo "$out" | tail -5; }; done <<EOF
python3 scripts/eval/guard-derived-artifacts.py --check-range $B..$H
python3 scripts/eval/validate-task-origin.py
python3 scripts/eval/validate-eval-tags.py --budget-only --strict
python3 scripts/eval/guard-scorer-logic.py
python3 scripts/eval/test_guard_scorer_logic.py
python3 scripts/eval/test_infra_predicate_inventory.py
python3 scripts/release/check-private-integration-pins.py --range $B..$H
python3 scripts/eval/check-plan-status-sync.py
python3 scripts/eval/check-qualification-registry.py
python3 scripts/eval/check-qualification-registry.py --negative-controls
python3 scripts/eval/test_check_qualification_feed.py
python3 scripts/eval/test_qualification_registry_p1.py
python3 scripts/eval/test_qualification_registry_p1_r2.py
python3 scripts/eval/test_qualification_registry_p1_r3.py
python3 scripts/eval/test_qualification_registry_p1_r4.py
python3 scripts/eval/test_qualification_registry_p4a.py
python3 scripts/eval/test_qualification_carry_forward.py
python3 scripts/eval/test_intake_qualify.py
python3 scripts/eval/build-qualification-feed.py --out $RUNNER_TEMP/qualification-feed.json --emit-metrics $RUNNER_TEMP/qualification-metrics.json
python3 scripts/eval/check-qualification-registry.py --metrics $RUNNER_TEMP/qualification-metrics.json
python3 scripts/eval/verify-published-qualification-feed.py file://$RUNNER_TEMP/qualification-feed.json --compare $RUNNER_TEMP/qualification-feed.json
python3 scripts/eval/test_model_prices.py
python3 scripts/eval/build-model-prices.py --out $RUNNER_TEMP/model-prices/model-prices.json
python3 scripts/eval/guard-public-feed.py $RUNNER_TEMP/model-prices
python3 scripts/eval/test_price_evidence.py
python3 scripts/eval/test_qoder_stream.py
python3 scripts/eval/check_price_evidence.py
EOF
echo "guard-local fail=$fail"; exit $fail
