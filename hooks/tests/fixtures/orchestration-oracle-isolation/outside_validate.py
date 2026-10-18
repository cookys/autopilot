"""Correct t16 validate.py planted outside the candidate directory."""


def parse_port(s):
    try:
        n = int(s)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 65535 else None


def dedupe_preserve(items):
    seen = set()
    out = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def normalize_tag(tag):
    return tag.strip()


def is_weekend(day_index):
    return day_index >= 5
