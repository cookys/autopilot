# Task: Fix Stale Permission Cache

Users report a security-relevant bug: after an account is **promoted** (e.g. from
`viewer` to `admin`), `get_permissions` in `service.py` keeps returning the user's
**old** permissions. A demoted admin still appears to have `delete` rights.

`service.py` looks correct on its own -- it just calls into a small memoizing
store. The stale result comes from somewhere in the caching layer
(`service.py` -> `store.py` -> `keys.py`).

Your task:
1. Find the root cause and fix it so `get_permissions` always reflects the user
   record's **current** `role`.
2. **Keep the memoization.** The store exists because the real `compute_fn` is
   expensive. Repeated lookups for an unchanged user must NOT recompute -- do
   not "fix" the bug by disabling caching, clearing the whole cache on every
   call, or always recomputing.
3. Ensure `run-tests.sh` runs successfully.

## Requirements
- Do not change the public signatures of `get_permissions`, `MemoStore.get_or_compute`,
  or `make_key`.
- A correct fix must satisfy BOTH: (a) a role change returns fresh permissions,
  and (b) two identical lookups of the same unchanged user recompute at most once.
