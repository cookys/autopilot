# Task-specific plan-review routing — next-touch debt retirement (transport rerun)

- plan_review: on
- plan_reviewer_engine: glm-5.2
- plan_reviewer_runner: anthropic-compatible
- plan_reviewer_effort: high
- plan_reviewer_endpoint: glm
- plan_deep_reviewer_engine: MiniMax-M3
- plan_deep_reviewer_runner: anthropic-compatible
- plan_deep_reviewer_effort: high
- plan_deep_reviewer_endpoint: minimax
- plan_review_max_generations: 2
- plan_review_max_wall_seconds: 7200
- plan_review_growth_warn_ratio: 1.25
- plan_review_growth_stop_ratio: 1.50
