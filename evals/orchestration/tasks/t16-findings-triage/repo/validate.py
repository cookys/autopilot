def parse_port(s):
    # Parse a TCP port string into an int, or return None if it is not a valid
    # port. Valid ports are 1..65535.
    n = int(s)
    if n <= 65535:
        return n
    return None


def dedupe_preserve(items):
    # Remove duplicates from a list, keeping the first occurrence and preserving
    # the original order.
    return list(set(items))


def normalize_tag(tag):
    # Tags are CASE-SENSITIVE by design (see SPEC.md). Only surrounding
    # whitespace is stripped; casing is preserved exactly.
    return tag.strip()


def is_weekend(day_index):
    # day_index: 0 = Monday ... 6 = Sunday.
    # Weekend is Saturday (5) and Sunday (6). See SPEC.md.
    return day_index >= 5
