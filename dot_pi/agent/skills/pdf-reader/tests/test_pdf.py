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
        doc.__iter__.return_value = iter([page])
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

    def test_cli_errors(self):
        for script,args in [('pdf_extract.py',['--pages','0']),('pdf_render.py',['--dpi','-1']),('pdf_search.py',['['])]:
            r = subprocess.run([sys.executable,'-B',str(SCRIPTS/script),str(self.pdf),*args],capture_output=True,text=True)
            self.assertNotEqual(r.returncode,0)
            self.assertNotIn('Traceback',r.stderr)

if __name__ == '__main__':
    unittest.main()
