# Task: Make Setup Script Safe to Re-run

Our initialization script `setup.sh` is used to configure environments. However, running it multiple times causes failures and corrupts configurations by duplicating entries.

Your task is to modify `setup.sh` so that it can be executed repeatedly without failing or duplicating operations.

## Requirements
- Re-running `setup.sh` must exit 0 and not produce any errors.
- Configuration lines appended to `.profile_custom` must not be duplicated on subsequent runs.
- All directory and symlink creation operations must be safe and not fail if the files or directories already exist.
- The end state after running the script twice must be identical to the state after running it once.

