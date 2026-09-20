---
name: pdf-reader
description: Read and analyze PDFs, including math papers, lecture notes, scanned pages, equations and diagrams, using local text extraction and page images.
---

# PDF reader

Run helpers with `SKILL_DIR/.venv/bin/python SKILL_DIR/scripts/<script>.py`.
Use an existing local path, including the original PDF saved by `web_fetch`,
to avoid downloading it again. If dependencies or OCR languages are missing,
read [references/setup.md](references/setup.md).

| Helper | Usage and defaults |
|---|---|
| `pdf_info.py PATH` | Metadata, first 20 page statistics and TOC entries. `--pages SPEC`, `--toc-offset N`, `--limit N` for more. |
| `pdf_extract.py PATH` | First 10 pages; select with `--pages SPEC` (maximum 100). |
| `pdf_search.py PATH QUERY` | First 100 pages, at most 30 matches. Prefer `--literal` for ordinary terms; supports regex, `--pages SPEC`, `--limit N`, `--context N`. Searches within lines. |
| `pdf_render.py PATH` | First page at 150 DPI. `--pages SPEC`, `--dpi 36..300`; maximum 10 pages / 40 megapixels per call. Returns private PNG paths for `read`. |

Page selections are **physical 1-based indices**, e.g. `3`, `1-5`, `2,7-9`, or
`all` within the helper's per-call limit. Printed labels can differ; text and
metadata report them when available. Cite physical indices and printed labels
when they differ.

For a targeted question, locate the relevant pages using the TOC or search,
then extract those pages and nearby context. For a full reading, cover the
whole document in sections and keep track of coverage. Output limits and
selected-page limits are separate: extraction/search save full selected-page
text to a private file if console output is truncated. Read relevant ranges
from that file; delete helper artifacts when finished.

Render relevant equations, tables, diagrams and ambiguous layouts, then inspect
the images with `read`. Check a representative multi-column page against its
text before trusting reading order. `--sort` offers spatial text sorting but can
interleave columns. Raster image counts miss vector diagrams; low math density
can miss equations. Neither proves text alone is sufficient. If the selected
model cannot see images, report that limitation for visual claims.

Extraction and search support optional `--ocr eng` (or `eng+ita`) on up to 10
selected pages, using local Tesseract. Missing text can mean scans, blank pages,
or unsupported encoding; a search miss is inconclusive on those pages. OCR
helps locate ordinary words but equations and layout still need visual checks.
Use `--max-chars N` (default 24000) to control extraction/search output.
