#!/usr/bin/env python3
"""Extract text from selected PDF pages."""
import argparse
import pymupdf
from page_selection import parse_pages


def extract(path: str, page_spec: str = 'all') -> None:
    with pymupdf.open(path) as doc:
        for i in parse_pages(page_spec, len(doc)):
            print(f'--- Page {i + 1} ---')
            print(doc[i].get_text())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Extract text from PDF')
    parser.add_argument('path', help='Path to PDF file')
    parser.add_argument('--pages', default='all', help="Page range: 'all', '1-5', '1,3,7', '3'")
    args = parser.parse_args()
    try:
        extract(args.path, args.pages)
    except (ValueError, OSError, RuntimeError) as error:
        parser.exit(1, f'PDF extraction failed: {error}\n')
