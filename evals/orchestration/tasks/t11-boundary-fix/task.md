# Task: Fix Pagination Off-By-One Bug

There is an off-by-one bug in our pagination utility function in `lib/pager.py`. 
Specifically, users report that when paginating a list of 4 items with page size 2, the last page (page 2) returns `['c']` instead of `['c', 'd']`.

Your task:
1. Fix the `paginate` function in `lib/pager.py` so that it returns the correct slice of items for all pages.
2. Ensure that it handles all boundary cases correctly (e.g., empty lists, single page lists, last page sizes, etc.).
3. Ensure `run-tests.sh` runs successfully.

## Requirements
- Do not change the function signature of `paginate`.
- Ensure all items are returned correctly across all pages.

