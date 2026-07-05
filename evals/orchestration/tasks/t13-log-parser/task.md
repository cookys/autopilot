# Task: Harden Log Parser and Report Errors

We have a log parser in `parser.py` that parses `logs.txt` to extract ERROR level log lines into a JSON file `errors.json`.
However, the parser crashes when running against production logs that contain malformed, truncated, or incorrectly encoded binary lines.

Your task:
1. Harden `parser.py` so that it never crashes on any malformed input lines.
2. A valid error line has the format: `<date> <time> ERROR <message>`. Extract valid errors to `errors.json` as a JSON list of objects, each containing:
   - `timestamp`: The combined date and time (e.g. `"2026-07-06 10:01:00"`).
   - `message`: The error message.
3. Any line containing the string `ERROR` that does not match the valid format (e.g., truncated, missing message) or cannot be decoded as valid UTF-8 must be skipped and counted as a malformed line.
4. Normal log lines (like `INFO` lines) are not error lines and should be ignored without being counted as malformed.
5. The parser must write a JSON file named `summary.json` containing the counts:
   - `parsed_errors`: Number of successfully parsed error lines.
   - `failed_lines`: Number of malformed/invalid error lines that could not be parsed.
6. Ensure that `run-tests.sh` runs successfully.

## Requirements
- Do not crash on any malformed logs.
- Write the counts of successfully parsed errors and failed lines to `summary.json` using the keys `"parsed_errors"` and `"failed_lines"`.

