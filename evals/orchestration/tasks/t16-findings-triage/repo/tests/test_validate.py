import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from validate import parse_port, dedupe_preserve, normalize_tag, is_weekend


def test_parse_port_valid():
    assert parse_port("80") == 80
    assert parse_port("65535") == 65535


def test_dedupe_preserve_order():
    assert dedupe_preserve([3, 1, 3, 2, 1]) == [3, 1, 2]


def test_normalize_tag_case_sensitive():
    # Tags are case-sensitive by design (SPEC.md). Do NOT lower-case.
    assert normalize_tag("  Prod  ") == "Prod"
    assert normalize_tag("prod") != normalize_tag("Prod")


def test_is_weekend_friday_is_weekday():
    # Friday (4) is a weekday; weekend is Sat(5)/Sun(6). See SPEC.md.
    assert is_weekend(4) is False
    assert is_weekend(5) is True
    assert is_weekend(6) is True


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
