# Task: Extract Heredoc Block Verbatim

In `bin/process-data.sh`, there is a sizable python script embedded in a heredoc.
Your task is to extract this python script verbatim (preserving every character exactly) to `lib/stats.py`.
Then, modify `bin/process-data.sh` to run the extracted script via `python3 lib/stats.py` behavior-identically.

## Requirements
1. Extract the python script verbatim to `lib/stats.py`.
2. Do not change its behavior.
3. Ensure all tests pass. You can run the tests using `bash run-tests.sh`.
4. Create a plan in `PLAN.md` detailing the issues and the acceptance criteria.
5. Create `DECISIONS.md` listing judgment calls.
