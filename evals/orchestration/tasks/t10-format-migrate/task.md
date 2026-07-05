# Task: Migrate Configuration File to JSON

We are migrating our configuration format from our custom format to JSON.

Your task is to:
1. Migrate the settings currently in `config.conf` into a new file named `config.json` in the root of the repository.
2. Update the reader script `reader.py` to read the configuration from `config.json` instead of `config.conf`.
3. Ensure that `reader.py` continues to print the sorted keys and their values correctly, matching the original behavior.

## Requirements
- The file `config.json` must contain all configuration keys and values from the original `config.conf`.
- Empty values must be preserved as empty strings in the JSON.
- Duplicate keys must follow standard resolution (the last value defined in the file wins).
- Comments (lines starting with `#`) must not be migrated to JSON, but they must not cause parser issues.
- You can run the reader test using `bash run-tests.sh`.

