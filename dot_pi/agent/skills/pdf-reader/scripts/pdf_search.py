#!/usr/bin/env python3
"""Bounded PDF search with coverage and empty-page reporting."""
import re
import argparse
import pymupdf
from page_selection import parse_pages
from pdf_common import page_header, page_text, check_ocr, bounded_print, add_text_options


def search(path, query, context_lines=3, literal=False, page_spec=None, limit=30, ocr=None, sort=False, max_chars=24000):
    if not 0 <= context_lines <= 20 or not 1 <= limit <= 200:
        raise ValueError('Context lines must be 0–20 and limit 1–200.')
    if not query or len(query) > 500:
        raise ValueError('Query must contain 1–500 characters.')
    try:
        pattern = re.compile(re.escape(query) if literal else query, re.IGNORECASE)
    except re.error as error:
        raise ValueError(f'Invalid regex: {error}') from error
    tessdata = check_ocr(ocr) if ocr else None
    output, empty, scanned, matches = [], [], [], 0
    with pymupdf.open(path) as doc:
        pages = parse_pages(page_spec or f'1-{min(100, len(doc))}', len(doc))
        if len(pages) > (10 if ocr else 100):
            raise ValueError('Search at most 100 text pages or 10 OCR pages per call.')
        stopped = False
        for i in pages:
            text = page_text(doc[i], ocr, sort, tessdata)
            scanned.append(i + 1)
            if not text.strip():
                empty.append(i + 1)
            lines = text.splitlines()
            for line_num, line in enumerate(lines):
                if pattern.search(line):
                    matches += 1
                    output.append(f'{page_header(doc[i])} line {line_num + 1}')
                    output.extend(('>>> ' if j == line_num else '    ') + lines[j] for j in range(max(0, line_num-context_lines), min(len(lines), line_num+context_lines+1)))
                    if matches >= limit:
                        stopped = True
                        break
            if stopped:
                break
        output.append(f'\n--- {matches} match(es); searched physical pages: {", ".join(map(str, scanned))} of {len(doc)} total ---')
        if stopped:
            output.append(f'Match limit reached partway through physical page {scanned[-1]}; narrow the query/pages or raise --limit.')
        if empty:
            output.append(f'No searchable text on pages {empty}: absence of matches is inconclusive; render or OCR these pages.')
        if not matches:
            output.append('No matches in the searched text. Search is line-based; try a shorter phrase if it crosses lines.')
    bounded_print('\n'.join(output), max_chars)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('query', help='Regex, or literal with --literal')
    parser.add_argument('--context', type=int, default=3)
    parser.add_argument('--literal', action='store_true')
    parser.add_argument('--pages', help='Physical pages; default first 100')
    parser.add_argument('--limit', type=int, default=30)
    add_text_options(parser)
    args = parser.parse_args()
    try:
        search(args.path, args.query, args.context, args.literal, args.pages, args.limit, args.ocr, args.sort, args.max_chars)
    except (ValueError, OSError, RuntimeError, pymupdf.mupdf.FzErrorBase) as error:
        parser.exit(1, f'PDF search failed: {error}\n')
