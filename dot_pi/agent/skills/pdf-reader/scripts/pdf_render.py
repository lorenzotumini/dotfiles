#!/usr/bin/env python3
"""Render selected PDF pages into a unique private temporary directory."""
import os
import tempfile
import argparse
import pymupdf
from page_selection import parse_pages


def render(path: str, page_spec: str = 'all', dpi: int = 150) -> list[str]:
    if not isinstance(dpi, int) or dpi <= 0:
        raise ValueError('DPI must be a positive integer.')
    with pymupdf.open(path) as doc:
        pages = parse_pages(page_spec, len(doc))
        out_dir = tempfile.mkdtemp(prefix='pi-pdf-')
        mat = pymupdf.Matrix(dpi / 72.0, dpi / 72.0)
        output_paths = []
        for i in pages:
            pix = doc[i].get_pixmap(matrix=mat)
            out_path = os.path.join(out_dir, f'page_{i + 1:04d}.png')
            pix.save(out_path)
            output_paths.append(out_path)
            print(f'Page {i + 1} -> {out_path}')
        return output_paths


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Render PDF pages to PNG')
    parser.add_argument('path', help='Path to PDF file')
    parser.add_argument('--pages', default='all', help="Page range: 'all', '1-5', '1,3,7', '3'")
    parser.add_argument('--dpi', type=int, default=150, help='Render resolution (default: 150)')
    args = parser.parse_args()
    try:
        render(args.path, args.pages, args.dpi)
    except (ValueError, OSError, RuntimeError) as error:
        parser.exit(1, f'PDF rendering failed: {error}\n')
