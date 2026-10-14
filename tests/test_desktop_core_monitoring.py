"""Regression checks for runtime validation and observation without deployment."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dot_config/quickshell/omarchy-core'))
import monitoring


class MonitoringTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.ctx = types.SimpleNamespace(source=None, home=root, state=root/'state',
                                         core=root/'core', vendor=root/'vendor', plugin_dirs=lambda: [])
        self.ctx.core.mkdir()
        (self.ctx.vendor/'shell').mkdir(parents=True)
        (self.ctx.vendor/'shell/Button.qml').write_text('original QML')
        for name in ('health.qml', 'maintenance.py', 'monitoring.py'):
            (self.ctx.core/name).write_text('probe code')
        (self.ctx.core/'upstream.json').write_text(json.dumps({'version': '4.0.1', 'commit': 'pin'}))
        self.snapshot = {'packages': {'qt6-base': '6.12'}, 'desktop': {'version': '4.0.1'}, 'qml_sha256': 'first'}
        self.report = {'checked_at': 'now', 'pin': {'version': '4.0.1'}, 'branch': 'quattro', 'errors': {},
                       'release': {'tag_name': 'v4.0.4', 'html_url': 'https://example.invalid/release'},
                       'paths': {'shell': {'pinned_tip': 'old', 'recent': [{'sha': 'new', 'message': 'Fix colors', 'url': 'https://example.invalid/fix'}]}},
                       'plugins': {'widget': {'pin': 'same', 'tip': 'same'}}}
        self.output = contextlib.redirect_stdout(io.StringIO())

    def test_runtime_hash_tracks_qml_and_probe_changes(self):
        with patch.object(monitoring, 'runtime_versions', return_value={'qt6-base': '6.12'}):
            first = monitoring.runtime_snapshot(self.ctx)
            (self.ctx.vendor/'shell/Button.qml').write_text('changed QML')
            second = monitoring.runtime_snapshot(self.ctx)
            self.assertNotEqual(first, second)
            (self.ctx.core/'monitoring.py').write_text('changed probe')
            self.assertNotEqual(second, monitoring.runtime_snapshot(self.ctx))

    def test_failed_probe_does_not_overwrite_validation(self):
        baseline = self.ctx.state/'runtime-validated.json'
        monitoring.save(baseline, {'snapshot': self.snapshot})
        original = baseline.read_text()
        with patch.object(monitoring, 'runtime_snapshot', return_value=self.snapshot), \
             patch.object(monitoring, 'palette_probe', side_effect=ValueError('broken palette')):
            with self.assertRaisesRegex(ValueError, 'broken palette'):
                monitoring.health(self.ctx, lambda ctx: True, record=True, live=False)
        self.assertEqual(baseline.read_text(), original)

    def test_runtime_changed_during_probe_is_not_recorded(self):
        changed = dict(self.snapshot, qml_sha256='second')
        with patch.object(monitoring, 'runtime_snapshot', side_effect=[self.snapshot, changed]), \
             patch.object(monitoring, 'palette_probe'):
            with self.assertRaisesRegex(ValueError, 'changed during'):
                monitoring.health(self.ctx, lambda ctx: True, record=True, live=False)
        self.assertFalse((self.ctx.state/'runtime-validated.json').exists())

    def test_successful_validation_records_scope(self):
        with self.output, patch.object(monitoring, 'runtime_snapshot', return_value=self.snapshot), \
             patch.object(monitoring, 'palette_probe'):
            self.assertTrue(monitoring.health(self.ctx, lambda ctx: True, record=True, live=False))
        record = monitoring.read(self.ctx.state/'runtime-validated.json')
        self.assertEqual(record['snapshot'], self.snapshot)
        self.assertFalse(record['live_checked'])
        self.assertIn('isolated', record['scope'])

    def test_static_failure_prevents_probe_and_record(self):
        with patch.object(monitoring, 'runtime_snapshot', return_value=self.snapshot), \
             patch.object(monitoring, 'palette_probe') as probe:
            self.assertFalse(monitoring.health(self.ctx, lambda ctx: False, record=True, live=False))
            probe.assert_not_called()
        self.assertFalse((self.ctx.state/'runtime-validated.json').exists())

    def test_validated_runtime_does_not_repeat_probe(self):
        monitoring.save(self.ctx.state/'runtime-validated.json', {'snapshot': self.snapshot})
        with self.output, patch.object(monitoring, 'runtime_snapshot', return_value=self.snapshot), \
             patch.object(monitoring, 'health') as health, patch.object(monitoring, 'notify') as notify:
            self.assertTrue(monitoring.monitor(self.ctx, lambda ctx: True))
            health.assert_not_called()
            notify.assert_not_called()

    def test_failed_runtime_is_retried_without_duplicate_notifications(self):
        with self.output, patch.object(monitoring, 'runtime_snapshot', return_value=self.snapshot), \
             patch.object(monitoring, 'palette_probe', side_effect=ValueError('broken palette')) as probe, \
             patch.object(monitoring, 'notify', return_value=True) as notify:
            self.assertFalse(monitoring.monitor(self.ctx, lambda ctx: True))
            self.assertFalse(monitoring.monitor(self.ctx, lambda ctx: True))
            self.assertEqual(probe.call_count, 2)
            self.assertEqual(notify.call_count, 1)
        self.assertFalse((self.ctx.state/'runtime-validated.json').exists())

    def test_upstream_notification_deduplicates_and_never_deploys(self):
        before = (self.ctx.vendor/'shell/Button.qml').read_text()
        with self.output, patch.object(monitoring, 'upstream_report', return_value=self.report), \
             patch.object(monitoring, 'notify', return_value=True) as notify:
            self.assertTrue(monitoring.review(self.ctx, notifications=True))
            self.assertTrue(monitoring.review(self.ctx, notifications=True))
            self.assertEqual(notify.call_count, 1)
        self.assertEqual(before, (self.ctx.vendor/'shell/Button.qml').read_text())
        self.assertTrue((self.ctx.state/'upstream-report.txt').is_file())

    def test_incomplete_network_check_keeps_previous_observation(self):
        report = dict(self.report, errors={'release': 'network unavailable'})
        acknowledged = self.ctx.state/'upstream-notified.json'
        monitoring.save(acknowledged, {'previous': 'observation'})
        with self.output, patch.object(monitoring, 'upstream_report', return_value=report), \
             patch.object(monitoring, 'notify') as notify:
            self.assertFalse(monitoring.review(self.ctx, notifications=True))
            notify.assert_not_called()
        self.assertEqual(monitoring.read(acknowledged), {'previous': 'observation'})
        self.assertIn('network unavailable', (self.ctx.state/'upstream-report.txt').read_text())

    def test_failed_notification_is_not_acknowledged(self):
        with self.output, patch.object(monitoring, 'upstream_report', return_value=self.report), \
             patch.object(monitoring, 'notify', return_value=False):
            self.assertFalse(monitoring.review(self.ctx, notifications=True))
        self.assertFalse((self.ctx.state/'upstream-notified.json').exists())

    def test_candidate_signatures_include_only_changed_tips(self):
        observed = monitoring.candidates(self.report)
        self.assertEqual(observed, {'release': 'v4.0.4', 'paths': {'shell': 'new'}, 'plugins': {}})
        self.report['paths']['shell']['pinned_tip'] = 'new'
        self.report['release']['tag_name'] = 'v4.0.1'
        self.assertEqual(monitoring.candidates(self.report), {'release': None, 'paths': {}, 'plugins': {}})


if __name__ == '__main__':
    unittest.main()
