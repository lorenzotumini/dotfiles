"""Shared strict, 1-indexed page selection for extraction and rendering."""
import re


def parse_pages(spec: str, total: int) -> list[int]:
    if spec.strip().lower() == 'all':
        return list(range(total))
    pages = set()
    for part in spec.split(','):
        match = re.fullmatch(r'\s*(\d+)\s*(?:-\s*(\d+)\s*)?', part)
        if not match:
            raise ValueError("Invalid page selection; use all, 1-5, or 1,3,7.")
        start = int(match[1])
        end = int(match[2]) if match[2] else start
        if not 1 <= start <= end <= total:
            raise ValueError(f"Page range {part.strip()!r} is invalid for a {total}-page document.")
        pages.update(range(start - 1, end))
    return sorted(pages)
