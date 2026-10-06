The scheduler in this job runner drops a job when it fails, even though we already have a retry
policy. I want that fixed properly, in three stages that build on each other. First, make the
scheduler consult the existing retry policy and put a failed job back on the queue while it still has
attempts left, counting the attempts. Second, make the delay before a retry grow with each attempt
(doubling, with a configurable cap) and have the queue hold a requeued job back until its delay has
passed. Third, let the CLI override the policy (`--max-attempts`, `--delay-ms`, `--delay-cap-ms`) and
document the behaviour in `docs/design.md`. Add tests for each stage to `run-tests.sh`.
`bash run-tests.sh` runs the tests. Commit as you go.
