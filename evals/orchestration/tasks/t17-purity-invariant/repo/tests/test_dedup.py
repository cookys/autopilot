import sys, os, copy
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dedup import dedup


def test_basic_dedup_order():
    recs = [{"id": 1}, {"id": 2}, {"id": 1}, {"id": 3}]
    out = dedup(recs)
    assert [r["id"] for r in out] == [1, 2, 3]


def test_does_not_mutate_input():
    recs = [{"id": 1, "tags": ["a"]}, {"id": 1, "tags": ["b"]}]
    snapshot = copy.deepcopy(recs)
    dedup(recs)
    assert recs == snapshot, "dedup must not mutate its input records"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except AssertionError as e:
                failures += 1
                print("FAIL " + name + ": " + str(e))
            else:
                print("PASS " + name)
    if failures:
        sys.exit(1)
    print("all tests passed")
