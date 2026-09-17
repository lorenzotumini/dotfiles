"""Regression checks for migrations and the review-only update boundary."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("maintenance", ROOT / "dot_config/quickshell/omarchy-core/maintenance.py")
maintenance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(maintenance)


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = {
            "version": 1, "bar": {"position": "bottom", "centerAnchor": "old.clock",
            "layout": {"left": [{"id": "custom.command", "type": "command", "exec": "echo hi"}],
                       "center": [{"id": "old.clock", "format": "HH:mm"},
                                  {"id": "omarchy.indicators", "items": ["Dnd"]}], "right": []}},
            "disabledPlugins": ["old.clock"], "plugins": [], "userSetting": {"keep": True}}
        self.migrations = [{"version": 1, "operations": []}, {"version": 2, "operations": [
            {"op": "rename-plugin", "from": "old.clock", "to": "new.clock"},
            {"op": "add-widget", "section": "right", "widget": {"id": "extra.widget"}},
            {"op": "add-indicator", "item": "Dictation"}]}]

    def test_baseline_does_not_reintroduce_removed_widgets(self):
        self.assertEqual(maintenance.migrate_config(self.config, self.migrations[:1], 0), self.config)

    def test_migrations_preserve_choices_and_are_retry_safe(self):
        result = maintenance.migrate_config(self.config, self.migrations, 0)
        self.assertEqual(result["bar"]["position"], "bottom")
        self.assertEqual(result["bar"]["layout"]["center"][0], {"id": "new.clock", "format": "HH:mm"})
        self.assertEqual(result["bar"]["centerAnchor"], "new.clock")
        self.assertEqual(result["disabledPlugins"], ["new.clock"])
        self.assertEqual(result["userSetting"], self.config["userSetting"])
        self.assertEqual(result, maintenance.migrate_config(result, self.migrations, 0))
        self.assertEqual(result, maintenance.migrate_config(result, self.migrations, 2))
        self.assertEqual(self.config["bar"]["layout"]["center"][0]["id"], "old.clock")

    def test_all_indicator_setting_is_preserved(self):
        self.config["bar"]["layout"]["center"][1]["items"] = []
        result = maintenance.migrate_config(self.config, self.migrations, 0)
        self.assertEqual(result["bar"]["layout"]["center"][1]["items"], [])

    def test_invalid_layout_or_newer_ledger_refused(self):
        for config, version in (({"version": 2}, 0), (self.config, 3)):
            with self.assertRaises(ValueError):
                maintenance.migrate_config(config, self.migrations, version)

    def test_disk_migration_backup_and_dry_run(self):
        core = self.root / "core"
        core.mkdir()
        (core / "layout-migrations.json").write_text(json.dumps(self.migrations))
        config = self.root / "shell.json"
        original = json.dumps(self.config)
        config.write_text(original)
        ctx = types.SimpleNamespace(source=None, core=core, config=config, state=self.root / "state")
        with contextlib.redirect_stdout(io.StringIO()):
            maintenance.migrate(ctx, dry_run=True)
            self.assertFalse(ctx.state.exists())
            self.assertEqual(config.read_text(), original)
            maintenance.migrate(ctx)
            self.assertEqual(next((ctx.state / "layout-backups").glob("*.json")).read_text(), original)
            modified = config.stat().st_mtime_ns
            maintenance.migrate(ctx)
            self.assertEqual(config.stat().st_mtime_ns, modified)

    def test_broken_qml_import_blocks_preflight(self):
        plugin = self.root / "plugin"
        plugin.mkdir()
        (plugin / "Broken.qml").write_text('import "missing/Helpers" as Helpers\n')
        ctx = maintenance.Context(ROOT)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertFalse(maintenance.check(ctx, plugin_override=plugin))
        self.assertIn("missing QML import", output.getvalue())

    def test_vendor_encoding_preserves_executable_content_and_links(self):
        original, encoded, decoded = [self.root / p for p in ("original", "encoded", "decoded")]
        original.mkdir()
        (original / "script").write_text("#!/bin/bash\necho hello\n")
        (original / "script").chmod(0o755)
        (original / "link").symlink_to("script")
        (original / "directory").mkdir()
        (original / "directory/file").write_text("content")
        (original / "directory-link").symlink_to("directory")
        maintenance.copy_vendor(original, encoded, encode=True)
        self.assertTrue((encoded / "executable_script").exists())
        self.assertEqual((encoded / "symlink_link").read_text(), "script\n")
        maintenance.copy_vendor(encoded, decoded, decode=True)
        self.assertEqual(maintenance.inventory(original), maintenance.inventory(decoded))

    def test_stage_refuses_existing_output_before_fetch(self):
        with patch.object(maintenance, "fetch_checkout") as fetch:
            with self.assertRaises(FileExistsError):
                maintenance.stage(maintenance.Context(ROOT), "v4.0.4", self.root)
            fetch.assert_not_called()

    def test_patch_replay_detects_conflicts_and_preserves_installed_files(self):
        repo = self.root / "plugin"
        repo.mkdir()
        maintenance.run("git", "init", "-q", str(repo))
        (repo / "Widget.qml").write_text("one\ntwo\n")
        maintenance.run("git", "add", ".", cwd=repo)
        maintenance.run("git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                        "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture", cwd=repo)
        commit = maintenance.run("git", "rev-parse", "HEAD", cwd=repo)
        delta = self.root / "widget.patch"
        delta.write_text("--- a/Widget.qml\n+++ b/Widget.qml\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n")
        pin = {"name": "plugin", "commit": commit, "patches": [delta]}
        ctx = types.SimpleNamespace(plugins=self.root)
        (repo / "Widget.qml").write_text("one\nthree\n")
        before = maintenance.inventory(repo)
        self.assertIn("matches recorded patches", maintenance.patch_status(ctx, pin))
        self.assertEqual(before, maintenance.inventory(repo))
        (repo / "Widget.qml").write_text("one\nextra edit\n")
        self.assertIn("unrecorded differences", maintenance.patch_status(ctx, pin))
        delta.write_text(delta.read_text().replace("-two", "-does not exist"))
        self.assertIn("patches conflict", maintenance.patch_status(ctx, pin))


if __name__ == "__main__":
    unittest.main()
