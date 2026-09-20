#!/usr/bin/env python3
"""Render selected PDF pages into a unique private temporary directory."""
import os
import tempfile
import argparse
import pymupdf
from page_selection import parse_pages


def render(path: str, page_spec: str = '1', dpi: int = 150) -> list[str]:
    if not isinstance(dpi, int) or not 36 <= dpi <= 300:
        raise ValueError('DPI must be an integer from 36 to 300.')
    with pymupdf.open(path) as doc:
        pages = parse_pages(page_spec, len(doc))
        if len(pages) > 10:
            raise ValueError('Render at most 10 pages per call.')
        if sum((doc[i].rect.width * dpi / 72 + 1) * (doc[i].rect.height * dpi / 72 + 1) for i in pages) > 40_000_000:
            raise ValueError('Rendering exceeds 40 megapixels; select fewer pages or lower DPI.')
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
    parser.add_argument('--pages', default='1', help="Page range: 'all', '1-5', '1,3,7', '3'")
    parser.add_argument('--dpi', type=int, default=150, help='Render resolution (default: 150)')
    args = parser.parse_args()
    try:
        render(args.path, args.pages, args.dpi)
    except (ValueError, OSError, RuntimeError, pymupdf.mupdf.FzErrorBase) as error:
        parser.exit(1, f'PDF rendering failed: {error}\n')
