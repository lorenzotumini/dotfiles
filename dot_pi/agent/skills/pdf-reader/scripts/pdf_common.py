"""Shared bounded output, physical page labels, and optional local OCR."""
import os
import re
import subprocess
import tempfile
from pathlib import Path


def page_header(page):
    label = page.get_label()
    return f'--- Physical page {page.number + 1}' + (f' (label: {label})' if label else '') + ' ---'


def check_ocr(language):
    if not re.fullmatch(r'[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*', language):
        raise ValueError('Invalid OCR language; use eng or eng+ita, for example.')
    local = Path.home() / '.local/share/pi-pdf/tessdata'
    tessdata = os.environ.get('TESSDATA_PREFIX')
    if not tessdata and all((local / (lang + '.traineddata')).is_file() for lang in language.split('+')):
        tessdata = str(local)
    command = ['tesseract', '--list-langs'] + (['--tessdata-dir', tessdata] if tessdata else [])
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError('Local Tesseract is unavailable; see references/setup.md.') from error
    available = set(result.stdout.splitlines()[1:])
    missing = set(language.split('+')) - available
    if result.returncode or missing:
        raise ValueError(f'OCR language data missing: {", ".join(sorted(missing)) or language}. See references/setup.md; no hosted OCR was used.')
    return tessdata


def page_text(page, ocr=None, sort=False, tessdata=None):
    if ocr:
        if (page.rect.width * 150 / 72 + 1) * (page.rect.height * 150 / 72 + 1) > 12_000_000:
            raise ValueError('OCR page exceeds 12 megapixels at 150 DPI; render a smaller image and inspect it instead.')
        tp = page.get_textpage_ocr(language=ocr, dpi=150, full=True, tessdata=tessdata)
        return page.get_text(textpage=tp, sort=sort)
    return page.get_text(sort=sort)


def bounded_print(text, max_chars=24000):
    if not 1000 <= max_chars <= 100000:
        raise ValueError('max-chars must be 1000–100000.')
    if len(text) <= max_chars:
        print(text)
        return
    # Only spill on truncation; bounded selected-page work keeps artifacts manageable.
    if len(text.encode('utf-8')) > 32 * 1024 * 1024:
        raise ValueError('Selected-page text exceeds 32 MiB; select fewer pages.')
    fd, path = tempfile.mkstemp(prefix='pi-pdf-text-', suffix='.txt')
    with os.fdopen(fd, 'w') as out:
        out.write(text)
    print(text[:max_chars])
    print(f'\n[Output truncated. Full selected-page text: {path}. Use read offset/limit or search that file. Delete it when finished.]')


def add_text_options(parser):
    parser.add_argument('--ocr', metavar='LANG', help='Explicit local OCR, e.g. eng or eng+ita; selected pages only')
    parser.add_argument('--sort', action='store_true', help='Sort spatially; may interleave columns. Verify layout visually.')
    parser.add_argument('--max-chars', type=int, default=24000, help='Console character limit (1000–100000; full text saved if truncated)')
