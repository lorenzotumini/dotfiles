import contextlib
import io
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import pymupdf

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from page_selection import parse_pages
import pdf_info
import pdf_extract
import pdf_render
import pdf_search
import pdf_common


class PDFTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pdf = Path(self.tmp.name) / 'fixture.pdf'
        with pymupdf.open() as doc:
            doc.new_page().insert_text((72,72), 'Theorem 1: PDF fixture')
            doc.new_page()  # Blank page must be supported.
            doc.set_metadata({'title':'Fixture'})
            doc.set_toc([[1,'Theorem',1]])
            doc.save(self.pdf)

    def tearDown(self):
        self.tmp.cleanup()

    def test_metadata_blank_page_and_toc(self):
        result = pdf_info.analyze(str(self.pdf))
        self.assertEqual(result['page_count'],2)
        self.assertEqual(result['title'],'Fixture')
        self.assertEqual(result['toc'][0]['page'],1)
        self.assertEqual(result['pages'][1]['math_density'],0)

    def test_supplementary_math_unicode(self):
        doc = MagicMock()
        page = MagicMock()
        page.get_text.return_value = '\U0001D400'
        page.get_images.return_value = []
        doc.__enter__.return_value = doc
        doc.__getitem__.return_value = page
        page.get_label.return_value = ''
        doc.__len__.return_value = 1
        doc.get_toc.return_value = []
        doc.metadata = {}
        with patch.object(pdf_info.pymupdf, 'open', return_value=doc):
            self.assertEqual(pdf_info.analyze('fixture')['pages'][0]['math_density'],1)

    def test_page_selection(self):
        self.assertEqual(parse_pages('all',2),[0,1])
        self.assertEqual(parse_pages('2,1-2,1',2),[0,1])
        for spec in ['0','3','2-1','1-3','-1','','1,','abc']:
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                parse_pages(spec,2)

    def test_extract_and_search(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pdf_extract.extract(str(self.pdf),'1')
            pdf_search.search(str(self.pdf),'Theorem 1',literal=True)
        self.assertIn('Theorem 1',out.getvalue())
        self.assertIn('1 match(es)',out.getvalue())
        with self.assertRaises(ValueError):
            pdf_search.search(str(self.pdf),'x',context_lines=-1)

    def test_render_is_private_and_does_not_overwrite(self):
        dirs = []
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                for _ in range(2):
                    paths = pdf_render.render(str(self.pdf),'1',72)
                    p = Path(paths[0]); dirs.append(p.parent)
                    self.assertEqual(p.read_bytes()[:8],b'\x89PNG\r\n\x1a\n')
                    self.assertEqual(p.parent.stat().st_mode & 0o777,0o700)
            self.assertNotEqual(dirs[0],dirs[1])
            with self.assertRaises(ValueError):
                pdf_render.render(str(self.pdf),dpi=0)
        finally:
            for d in dirs: shutil.rmtree(d)

    def test_long_document_coverage_labels_and_bounds(self):
        path = Path(self.tmp.name) / 'long.pdf'
        with pymupdf.open() as doc:
            for i in range(120):
                doc.new_page().insert_text((72, 72), f'Theorem physical {i + 1}')
            doc.set_page_labels([{'startpage': 0, 'prefix': '', 'style': 'r'}, {'startpage': 3, 'prefix': '', 'style': 'D', 'firstpagenum': 1}])
            doc.set_toc([[1, f'Section {i}', i] for i in range(1, 121)])
            doc.save(path)
        info = pdf_info.analyze(str(path))
        self.assertEqual(len(info['pages']), 20)
        self.assertEqual(info['uninspected_pages'], 100)
        self.assertEqual(info['toc_next_offset'], 20)
        self.assertEqual(pdf_info.analyze(str(path), '4')['pages'][0]['label'], '1')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pdf_extract.extract(str(path), '4')
            pdf_search.search(str(path), 'physical 115', literal=True, page_spec='110-120')
        self.assertIn('Physical page 4 (label: 1)', out.getvalue())
        self.assertIn('Physical page 115', out.getvalue())
        with self.assertRaises(ValueError): pdf_render.render(str(path), '1-11')
        with self.assertRaises(ValueError): pdf_extract.extract(str(path), 'all')
        with self.assertRaises(ValueError): pdf_search.search(str(path), 'x', page_spec='all')

    def test_scan_warning_and_english_ocr(self):
        path = Path(self.tmp.name) / 'scan.pdf'
        with pymupdf.open() as original:
            page = original.new_page()
            page.insert_text((72, 100), 'Theorem 42: local optical recognition', fontsize=22)
            image = page.get_pixmap(matrix=pymupdf.Matrix(2, 2)).tobytes('png')
        with pymupdf.open() as scan:
            page = scan.new_page()
            page.insert_image(page.rect, stream=image)
            scan.save(path)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pdf_search.search(str(path), 'Theorem', literal=True)
            pdf_extract.extract(str(path))
        self.assertIn('inconclusive', out.getvalue())
        self.assertIn('No extractable text', out.getvalue())
        try: pdf_common.check_ocr('eng')
        except ValueError as error: self.skipTest(str(error))
        out = io.StringIO()
        with contextlib.redirect_stdout(out): pdf_extract.extract(str(path), '1', ocr='eng')
        self.assertIn('Theorem 42', out.getvalue())

    def test_missing_ocr_language(self):
        with self.assertRaisesRegex(ValueError, 'language data missing'):
            pdf_common.check_ocr('pi_missing_language')

    def test_multicolumn_and_bounded_search(self):
        path = Path(self.tmp.name) / 'columns.pdf'
        with pymupdf.open() as doc:
            page = doc.new_page()
            # Deliberately insert right column before left: stream order is misleading.
            page.insert_textbox(pymupdf.Rect(320, 72, 560, 500), 'RIGHT column conclusion\n' * 10)
            page.insert_textbox(pymupdf.Rect(40, 72, 280, 500), 'LEFT column theorem\n' * 10)
            doc.save(path)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pdf_extract.extract(str(path), '1')
            pdf_search.search(str(path), 'column', literal=True, limit=2)
        self.assertIn('Text order may need visual checking', out.getvalue())
        self.assertIn('Match limit reached partway', out.getvalue())
        with contextlib.redirect_stdout(io.StringIO()): paths = pdf_render.render(str(path), '1', 100)
        self.assertTrue(Path(paths[0]).is_file())
        shutil.rmtree(Path(paths[0]).parent)

    def test_output_spill_is_private_and_recoverable(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out): pdf_common.bounded_print('x' * 4000, 1000)
        import re
        path = Path(re.search(r'Full selected-page text: (.*?). Use read', out.getvalue())[1])
        try:
            self.assertEqual(path.read_text(), 'x' * 4000)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        finally: path.unlink()

    def test_cli_errors(self):
        for script,args in [('pdf_extract.py',['--pages','0']),('pdf_render.py',['--dpi','-1']),('pdf_search.py',['['])]:
            r = subprocess.run([sys.executable,'-B',str(SCRIPTS/script),str(self.pdf),*args],capture_output=True,text=True)
            self.assertNotEqual(r.returncode,0)
            self.assertNotIn('Traceback',r.stderr)

if __name__ == '__main__':
    unittest.main()
