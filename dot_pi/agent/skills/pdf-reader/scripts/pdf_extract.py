#!/usr/bin/env python3
"""Extract selected PDF pages with physical indices and printed labels."""
import argparse
import pymupdf
from page_selection import parse_pages
from pdf_common import page_header, page_text, check_ocr, bounded_print, add_text_options


def extract(path, page_spec=None, ocr=None, sort=False, max_chars=24000):
    tessdata = check_ocr(ocr) if ocr else None
    with pymupdf.open(path) as doc:
        pages = parse_pages(page_spec or f'1-{min(10, len(doc))}', len(doc))
        if len(pages) > (10 if ocr else 100):
            raise ValueError('Select at most 100 text pages or 10 OCR pages per call; read long documents in sections.')
        output = [f'Document: {len(doc)} physical pages; selected: {len(pages)}. Text order may need visual checking.']
        for i in pages:
            text = page_text(doc[i], ocr, sort, tessdata)
            output.extend([page_header(doc[i]), text or '[No extractable text: blank, scanned, or unsupported encoding; render this page or use --ocr LANG.]'])
        bounded_print('\n\n'.join(output), max_chars)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--pages', help='Physical pages: 1-5, 1,3,7, all; default first 10')
    add_text_options(parser)
    args = parser.parse_args()
    try:
        extract(args.path, args.pages, args.ocr, args.sort, args.max_chars)
    except (ValueError, OSError, RuntimeError, pymupdf.mupdf.FzErrorBase) as error:
        parser.exit(1, f'PDF extraction failed: {error}\n')
