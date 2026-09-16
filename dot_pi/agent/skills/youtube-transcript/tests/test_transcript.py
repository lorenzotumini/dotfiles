import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('transcript', Path(__file__).resolve().parents[1] / 'fetch_transcript.py')
T = importlib.util.module_from_spec(spec)
spec.loader.exec_module(T)

class TranscriptTests(unittest.TestCase):
    def test_language_selection(self):
        self.assertEqual(T.pick_english_lang({'subtitles': {'en-GB': []}, 'automatic_captions': {'en': []}}), ('en-GB', False))
        self.assertEqual(T.pick_english_lang({'automatic_captions': {'en': []}}), ('en', True))
        self.assertIsNone(T.pick_english_lang({'subtitles': {'it': []}}))

    def test_text_extraction(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'test.json3'
            p.write_text(json.dumps({'events': [{'segs': [{'utf8': 'hello '}, {'utf8': '\n'}, {'utf8': 'world'}]}, {'segs': None}]}))
            self.assertEqual(T.extract_text_from_json3(p), 'hello world')

    def test_metadata_safeguards(self):
        with patch.object(T.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '{"title":"fixture"}')) as run:
            self.assertEqual(T.get_metadata('https://youtube.com/watch?v=fixture&list=example')['title'], 'fixture')
            args, kwargs = run.call_args
            self.assertIn('--no-playlist', args[0])
            self.assertIn('--ignore-config', args[0])
            self.assertEqual(args[0][-2], '--')
            self.assertEqual(kwargs['timeout'], 60)

    def test_subtitle_safeguards(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'fixture.en.json3'
            p.write_text('{}')
            with patch.object(T.subprocess, 'run') as run:
                self.assertEqual(T.download_subtitle('https://youtube.com/watch?v=fixture', 'en', False, d), str(p))
                args, kwargs = run.call_args
                self.assertIn('--write-subs', args[0])
                self.assertIn('--no-playlist', args[0])
                self.assertIn('--ignore-config', args[0])
                self.assertEqual(kwargs['timeout'], 60)

    def test_timeout_is_clean_failure(self):
        for fn, args in [(T.get_metadata, ('https://youtube.com/watch?v=fixture',)), (T.download_subtitle, ('https://youtube.com/watch?v=fixture', 'en', True, '/tmp'))]:
            with patch.object(T.subprocess, 'run', side_effect=subprocess.TimeoutExpired('yt-dlp', 60)), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    fn(*args)
                self.assertEqual(error.exception.code, 1)

if __name__ == '__main__':
    unittest.main()
