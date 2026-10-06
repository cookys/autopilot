The scheduler in this job runner drops a job when it fails, even though the retry policy already
exists. I want that fixed properly, in three stages that build on each other. First, make the
scheduler consult the retry policy and put a failed job back on the queue while it still has attempts
left, counting the attempts. Second, make the delay before a retry grow with each attempt (the
backoff the README and the design doc talk about) and have the queue hold a job that was put back
until its delay has passed. Third, let the attempt limit and the delay of the retry policy be set when the
runner is started, and document the behaviour in `docs/design.md`. Add tests for each stage to `run-tests.sh`.
`bash run-tests.sh` runs the tests. Commit as you go.
