#!/usr/bin/env python3
"""Bounded metadata, TOC, and selected page analysis."""
import argparse
import json
import pymupdf
from page_selection import parse_pages


def analyze(path, page_spec=None, toc_offset=0, limit=20):
    if not 1 <= limit <= 100 or toc_offset < 0:
        raise ValueError('limit must be 1–100 and toc-offset non-negative.')
    with pymupdf.open(path) as doc:
        meta = doc.metadata or {}
        indices = parse_pages(page_spec or f'1-{min(limit, len(doc))}', len(doc))
        if len(indices) > 100:
            raise ValueError('Select at most 100 pages for detailed metadata.')
        pages = []
        for i in indices:
            page = doc[i]
            text = page.get_text()
            math = sum(1 for c in text if '\u2200' <= c <= '\u22ff' or '\u2100' <= c <= '\u214f' or '\u2190' <= c <= '\u21ff' or '\u27c0' <= c <= '\u27ef' or '\u2980' <= c <= '\u2aff' or '\u0370' <= c <= '\u03ff' or '\U0001d400' <= c <= '\U0001d7ff')
            pages.append({'page': i + 1, 'label': page.get_label(), 'text_length': len(text), 'image_count': len(page.get_images()), 'math_density': round(math/max(len(text), 1), 4)})
        toc = doc.get_toc()
        return {'file': path, 'page_count': len(doc), 'title': meta.get('title', '')[:500], 'author': meta.get('author', '')[:500],
                'toc': [{'level': level, 'title': title[:300], 'page': number} for level, title, number in toc[toc_offset:toc_offset + limit]],
                'toc_count': len(toc), 'toc_next_offset': toc_offset + limit if toc_offset + limit < len(toc) else None,
                'pages': pages, 'uninspected_pages': len(doc) - len(indices),
                'note': 'Physical page indices are 1-based. Math/image counts are hints, not proof that visual inspection can be skipped.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--pages', help='Physical pages to analyze; default first 20')
    parser.add_argument('--toc-offset', type=int, default=0)
    parser.add_argument('--limit', type=int, default=20, help='TOC entries and default page sample, 1–100')
    args = parser.parse_args()
    try:
        print(json.dumps(analyze(args.path, args.pages, args.toc_offset, args.limit), indent=2))
    except (ValueError, OSError, RuntimeError, pymupdf.mupdf.FzErrorBase) as error:
        parser.exit(1, f'PDF metadata failed: {error}\n')
