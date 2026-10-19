# CLI Constraints
1. Output format MUST ALWAYS be TSV (tab-separated values), never CSV or any other format. This applies to all commands and subcommands.
2. All timestamps MUST be in UTC ISO-8601 format (e.g., `YYYY-MM-DDTHH:MM:SSZ` or `+00:00`), never local time.
3. Exit code 3 is STRICTLY reserved for validation errors (e.g. invalid arguments or bad input data). Never use exit code 3 for any other failure condition, and always use it when validation fails.
