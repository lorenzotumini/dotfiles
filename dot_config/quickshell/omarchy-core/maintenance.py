#!/usr/bin/env python3
"""Maintenance for the locally integrated desktop. Never runs upstream installers."""

import argparse
import copy
import difflib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request


def run(*args, cwd=None):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError(f"{' '.join(map(str, args[:3]))}: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def read_json(path):
    return json.loads(path.read_text())


def json_text(value):
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def atomic_write(path, text, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def command_file(folder, name):
    ordinary = folder / name
    return ordinary if ordinary.exists() else folder / ("executable_" + name)


def command_names(path):
    return [line.split("#", 1)[0].strip() for line in path.read_text().splitlines()
            if line.split("#", 1)[0].strip()]


class Context:
    def __init__(self, source=None):
        self.home = Path.home()
        self.core = Path(__file__).resolve().parent
        self.local_bin = self.home / ".local/bin"
        self.plugins = self.home / ".config/omarchy/plugins"
        self.config = self.home / ".config/omarchy/shell.json"
        self.state = self.home / ".local/state/desktop-core"
        self.source = Path(source).resolve() if source else None
        if self.source:
            self.core = self.source / "dot_config/quickshell/omarchy-core"
            self.local_bin = self.source / "dot_local/bin"
        self.vendor = self.core.parent / "omarchy-stock"

    def plugin_dirs(self):
        dirs = {p.name: p for p in self.plugins.iterdir() if p.is_dir()} if self.plugins.exists() else {}
        if self.source:
            managed = self.source / "dot_config/omarchy/plugins"
            dirs.update({p.name: p for p in managed.iterdir() if p.is_dir()})
        return list(dirs.values())

    def pins(self):
        pins = []
        for line in (self.core / "optional-plugins.txt").read_text().splitlines():
            if line.startswith("# local patch:"):
                pins[-1]["patches"].append(self.core / line.split(":", 1)[1].strip())
            elif line.strip() and not line.startswith("#"):
                name, url, commit = line.split()
                pins.append(dict(name=name, url=url, commit=commit, patches=[]))
        return pins


def layout_entries(config):
    if not isinstance(config, dict) or type(config.get("version")) is not int or config["version"] != 1:
        raise ValueError("shell.json must have numeric version: 1")
    bar = config.get("bar")
    if not isinstance(bar, dict) or not isinstance(bar.get("layout"), dict):
        raise ValueError("shell.json must contain bar.layout")
    entries = []
    for section, values in bar["layout"].items():
        if section not in ("left", "center", "right") or not isinstance(values, list):
            raise ValueError(f"invalid bar section: {section}")
        for entry in values:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                raise ValueError(f"invalid widget in {section}")
            entries.append(entry)
    if not isinstance(config.get("plugins", []), list):
        raise ValueError("shell.json plugins must be an array")
    return entries


def check(ctx, vendor=None, plugin_override=None):
    """Static checks only: no QML loading, authentication, or plugin execution."""
    vendor = vendor or ctx.vendor
    errors = []
    names = []
    for filename, folder in (("commands.txt", vendor / "bin"), ("local-commands.txt", ctx.local_bin)):
        for name in command_names(ctx.core / filename):
            if not re.fullmatch(r"omarchy(?:-[a-z0-9]+)*", name):
                errors.append(f"invalid command name: {name}")
            if name in names:
                errors.append(f"duplicate command: {name}")
            names.append(name)
            path = command_file(folder, name)
            if not path.is_file():
                errors.append(f"missing command: {path}")
            elif not path.name.startswith("executable_") and not os.access(path, os.X_OK):
                errors.append(f"command is not executable: {path}")
    plugins = {p.name: p for p in ctx.plugin_dirs()}
    if plugin_override:
        plugins[plugin_override.name] = plugin_override
    roots = [vendor / "shell", *plugins.values()]
    manifests = {}
    for root in roots:
        for path in root.rglob("*manifest.json"):
            if ".git" in path.parts:
                continue
            try:
                manifest = read_json(path)
                if "id" not in manifest:
                    continue
                manifests[manifest["id"]] = manifest
                for entry in manifest.get("entryPoints", {}).values():
                    if not isinstance(entry, str) or Path(entry).is_absolute() or ".." in Path(entry).parts:
                        raise ValueError(f"unsafe entry point: {entry}")
                    if not (path.parent / entry).is_file():
                        errors.append(f"missing entry point: {path.parent / entry}")
            except (ValueError, TypeError, AttributeError) as error:
                errors.append(f"{path}: {error}")
        for path in root.rglob("*.qml"):
            text = path.read_text()
            for relative, module in re.findall(r'^import\s+(?:"([^"\n]+)"|(qs\.[\w.]+))', text, re.M):
                if module:
                    target = vendor / "shell" / module[3:].replace(".", "/")
                elif "quickshell/omarchy-core/shell" in relative:
                    target = vendor / "shell" / relative.split("quickshell/omarchy-core/shell", 1)[1].lstrip("/")
                else:
                    target = path.parent / relative
                if not target.exists():
                    errors.append(f"missing QML import in {path.name}: {relative or module}")
    configs = [ctx.core / "config/omarchy/shell.json"]
    if ctx.config.exists():
        configs.append(ctx.config)
    if ctx.source:
        configs.append(ctx.source / "dot_config/omarchy/create_shell.json")
    for path in configs:
        try:
            config = read_json(path)
            entries = layout_entries(config)
            if config["bar"].get("id", "omarchy.bar") not in manifests:
                errors.append(f"{path}: unknown bar id")
            for entry in entries + config.get("plugins", []):
                if not isinstance(entry, dict):
                    raise ValueError("plugin entries must be objects")
                name = entry.get("id")
                if entry.get("type") != "command" and name not in manifests:
                    errors.append(f"{path}: unknown widget/plugin {name}")
                for item in entry.get("items", []) if name == "omarchy.indicators" else []:
                    if not (vendor / "shell/plugins/bar/indicators" / (item + ".qml")).is_file():
                        errors.append(f"unknown indicator: {item}")
        except (ValueError, TypeError) as error:
            errors.append(f"{path}: {error}")
    tray = vendor / "shell/plugins/bar/widgets/Tray.qml"
    if "desktop.stable-tray" in manifests:
        text = tray.read_text() if tray.exists() else ""
        for prop in ("expanded", "trayMenuOpen", "managePopupOpen"):
            if not re.search(r"property\s+\w+\s+" + prop + r"\s*:", text):
                errors.append(f"tray wrapper requires upstream property: {prop}")
    for pin in ctx.pins():
        if plugin_override and plugin_override.name == pin["name"]:
            continue  # stage-plugin already replayed this candidate's patches.
        try:
            state = patch_status(ctx, pin)
            if "patches conflict" in state:
                errors.append(f"{pin['name']}: {state}")
            elif any(marker in state for marker in ("DRIFT", "unrecorded", "cannot verify")):
                print(f"WARN {pin['name']}: {state}")
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            errors.append(f"cannot check {pin['name']} patches: {error}")
    for error in errors:
        print(f"FAIL {error}")
    if not errors:
        print(f"PASS {len(names)} commands, manifests, configured widgets, local QML imports, tray contract and installed plugin patch replay")
    print("Static check only; Qt/Quickshell API, IPC and visual behavior require a running-session test.")
    return not errors


def archive_checkout(repo, commit, destination):
    data = subprocess.run(["git", "-C", str(repo), "archive", commit], capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(destination, filter="data")


def apply_patches(path, patches):
    for patch in patches:
        run("git", "apply", "--check", str(patch), cwd=path)
        run("git", "apply", str(patch), cwd=path)


def inventory(root):
    result = {}
    for path in root.rglob("*"):
        if ".git" in path.relative_to(root).parts or (path.is_dir() and not path.is_symlink()):
            continue
        key = str(path.relative_to(root))
        result[key] = ("link", os.readlink(path)) if path.is_symlink() else (
            "file", hashlib.sha256(path.read_bytes()).hexdigest(), bool(path.stat().st_mode & 0o111))
    return result


def patch_status(ctx, pin):
    installed = ctx.plugins / pin["name"]
    if not installed.exists():
        return "not installed"
    if not (installed / ".git").exists():
        return "not a git checkout; cannot verify pin/patches"
    head = run("git", "rev-parse", "HEAD", cwd=installed)
    with tempfile.TemporaryDirectory(prefix="desktop-plugin-check-") as directory:
        clean = Path(directory)
        archive_checkout(installed, head, clean)
        try:
            apply_patches(clean, pin["patches"])
        except ValueError as error:
            return f"{head[:12]}: recorded patches conflict ({error})"
        expected, actual = inventory(clean), inventory(installed)
        changes = sorted(p for p in expected.keys() | actual.keys() if expected.get(p) != actual.get(p))
    state = "pinned" if head == pin["commit"] else f"DRIFT from {pin['commit'][:12]}"
    return f"{head[:12]} ({state}); patches apply; " + (
        "matches recorded patches" if not changes else "unrecorded differences: " + ", ".join(changes))


def latest_release():
    request = urllib.request.Request("https://api.github.com/repos/omacom/omarchy/releases/latest",
                                     headers={"User-Agent": "desktop-core-maintenance", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def status(ctx, online):
    pin = read_json(ctx.core / "upstream.json")
    print(f"Desktop: {pin['version']}-local ({pin['commit'][:12]})")
    for package in ("hyprland", "quickshell", "uwsm"):
        try:
            print(run("pacman", "-Q", package))
        except (OSError, ValueError) as error:
            print(f"{package}: unavailable ({error})")
    ledger = ctx.state / "layout-migrations.json"
    version = read_json(ledger).get("version", 0) if ledger.exists() else 0
    target = max(item["version"] for item in read_json(ctx.core / "layout-migrations.json"))
    print(f"Layout migrations: {version}/{target}")
    if online:
        try:
            release = latest_release()
            print(f"Latest release: {release['tag_name']} ({release['published_at']}) {release['html_url']}")
        except (OSError, ValueError) as error:
            print(f"Latest release: unavailable ({error})")
    else:
        print("Upstream release/remote plugin tips: not queried (use --online)")
    for plugin in ctx.pins():
        try:
            print(f"{plugin['name']}: {patch_status(ctx, plugin)}")
            if online:
                tip = run("git", "ls-remote", plugin["url"], "HEAD").split()[0]
                print(f"  Remote default branch: {tip[:12]}" + (" (matches pin)" if tip == plugin["commit"] else " (differs from pin)"))
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            print(f"{plugin['name']}: check unavailable ({error})")


def migrate_config(config, migrations, current):
    result = copy.deepcopy(config)
    layout_entries(result)
    versions = [m["version"] for m in migrations]
    if versions != list(range(1, len(versions) + 1)) or type(current) is not int or not 0 <= current <= len(versions):
        raise ValueError("invalid migration sequence or ledger newer than this desktop")
    for migration in migrations[current:]:
        for op in migration["operations"]:
            entries = layout_entries(result)
            if op["op"] == "rename-plugin":
                for entry in entries + result.get("plugins", []):
                    if entry.get("id") == op["from"]:
                        entry["id"] = op["to"]
                result["disabledPlugins"] = [op["to"] if p == op["from"] else p for p in result.get("disabledPlugins", [])]
                for field in ("id", "centerAnchor"):
                    if result["bar"].get(field) == op["from"]:
                        result["bar"][field] = op["to"]
            elif op["op"] == "add-widget":
                if not any(e["id"] == op["widget"]["id"] for e in entries):
                    result["bar"]["layout"].setdefault(op["section"], []).append(copy.deepcopy(op["widget"]))
            elif op["op"] == "add-indicator":
                groups = [e for e in entries if e["id"] == "omarchy.indicators"]
                if groups:
                    items = groups[0].get("items", [])
                    # Empty or omitted means all indicators, already including new ones.
                    if items and op["item"] not in items:
                        items.append(op["item"])
            else:
                raise ValueError(f"unknown migration operation: {op['op']}")
    layout_entries(result)
    return result


def migrate(ctx, dry_run=False):
    if ctx.source:
        raise ValueError("migrate runs on deployed files; omit --source")
    if not ctx.config.exists():
        raise ValueError("shell.json is missing; apply the create-once seed first")
    migrations = read_json(ctx.core / "layout-migrations.json")
    ledger = ctx.state / "layout-migrations.json"

    def prepare():
        original = ctx.config.read_text()
        current = read_json(ledger)["version"] if ledger.exists() else 0
        config = read_json(ctx.config)
        return original, current, config, migrate_config(config, migrations, current)

    if dry_run:
        original, current, config, migrated = prepare()
        print(f"Layout migrations: {current} -> {len(migrations)}; layout {'changes' if config != migrated else 'unchanged'}")
        if config != migrated:
            print("".join(difflib.unified_diff(original.splitlines(True), json_text(migrated).splitlines(True))))
        return
    ctx.state.mkdir(parents=True, exist_ok=True)
    with (ctx.state / "layout-migrations.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original, current, config, migrated = prepare()
        if current == len(migrations):
            print(f"Layout migrations: current ({current})")
            return
        if config != migrated:
            backup = ctx.state / "layout-backups" / f"v{current}-{hashlib.sha256(original.encode()).hexdigest()[:12]}.json"
            atomic_write(backup, original)
            if ctx.config.read_text() != original:
                raise ValueError("shell.json changed during migration; retry when bar settings are idle")
            atomic_write(ctx.config, json_text(migrated), ctx.config.stat().st_mode & 0o777)
            print(f"Layout backup: {backup}")
        atomic_write(ledger, json_text({"version": len(migrations)}))
        print(f"Layout migrations: {current} -> {len(migrations)}; layout {'updated' if config != migrated else 'unchanged'}")


def fetch_checkout(url, ref, path):
    if not url.startswith("https://github.com/") or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", ref):
        raise ValueError("expected a GitHub HTTPS URL and an explicit tag, branch or commit")
    run("git", "init", "-q", str(path))
    run("git", "-c", "core.hooksPath=/dev/null", "fetch", "--depth=1", url, ref, cwd=path)
    commit = run("git", "rev-parse", "FETCH_HEAD", cwd=path)
    run("git", "-c", "core.hooksPath=/dev/null", "checkout", "--detach", commit, cwd=path)
    return commit


def copy_vendor(source, destination, encode=False, decode=False):
    """Convert executable_/symlink_ chezmoi names without changing stock bytes."""
    for path in source.rglob("*"):
        if ".git" in path.relative_to(source).parts or (path.is_dir() and not path.is_symlink()):
            continue
        rel = path.relative_to(source)
        name = rel.name
        executable = bool(path.lstat().st_mode & 0o111)
        link = path.is_symlink()
        if decode:
            executable = name.startswith("executable_")
            link = name.startswith("symlink_") or link
            name = re.sub(r"^(executable_|symlink_)", "", name)
        if encode:
            name = ("symlink_" if link else "executable_" if executable else "") + name
        target = destination / rel.parent / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if link:
            value = os.readlink(path) if path.is_symlink() else path.read_text().strip()
            if encode:
                target.write_text(value + "\n")
            else:
                target.symlink_to(value)
        else:
            shutil.copyfile(path, target)
            target.chmod(0o755 if executable and not encode else 0o644)


def write_diff(old, new, destination):
    before, after = inventory(old), inventory(new)
    lines, summary = [], []
    for name in sorted(before.keys() | after.keys()):
        if before.get(name) == after.get(name):
            continue
        summary.append(f"{'A' if name not in before else 'D' if name not in after else 'M'} {name}")
        try:
            a = (old / name).read_text().splitlines(True) if name in before and before[name][0] == "file" else []
            b = (new / name).read_text().splitlines(True) if name in after and after[name][0] == "file" else []
            lines.extend(difflib.unified_diff(a, b, fromfile="a/" + name, tofile="b/" + name))
        except UnicodeError:
            lines.append(f"Binary file changed: {name}\n")
    (destination / "changes.txt").write_text("\n".join(summary) + "\n")
    (destination / "changes.diff").write_text("".join(lines))
    return len(summary)


def compatibility_notes(ctx, old, candidate):
    exposed = set(command_names(ctx.core / "commands.txt"))
    adapters = set(command_names(ctx.core / "local-commands.txt"))
    available = exposed | adapters
    notes = []
    for name in sorted(available):
        a, b = old / "bin" / name, candidate / "bin" / name
        if a.exists() and b.exists() and a.read_bytes() != b.read_bytes():
            notes.append(f"Changed {'locally overridden' if name in adapters else 'exposed'} command: {name}")
            if name in exposed:
                new_mentions = set(re.findall(r"\bomarchy-[a-z0-9-]+\b", b.read_text())) - set(re.findall(r"\bomarchy-[a-z0-9-]+\b", a.read_text()))
                for dependency in sorted(new_mentions - available):
                    if (candidate / "bin" / dependency).is_file():
                        notes.append(f"  Review new command reference outside allowlist: {dependency}")
    a, b = old / "bin/omarchy-dns", candidate / "bin/omarchy-dns"
    if a.read_bytes() != b.read_bytes():
        notes.append("The separately installed /usr/bin/omarchy-dns copy also needs review; chezmoi does not update it.")
    notes.extend([
        "Review lock/Polkit changes against the separately installed PAM policy.",
        "Review upstream migrations for desktop prerequisites; do not execute the full migration chain.",
        "Test third-party plugins, shell IPC, lock/unlock, notifications and the tray in the running session.",
        "Static checks cannot establish Qt/Quickshell API compatibility or plugin behavior.",
    ])
    return notes


def stage(ctx, ref, output, plugin=None):
    destination = Path(output).resolve() if output else Path(tempfile.mkdtemp(prefix="desktop-core-review-"))
    if output:
        destination.mkdir(parents=True, exist_ok=False)
    print(f"Review directory: {destination}", flush=True)
    old = destination / "previous"
    old.mkdir()
    pin = next((p for p in ctx.pins() if p["name"] == plugin), None) if plugin else read_json(ctx.core / "upstream.json")
    if pin is None:
        raise ValueError(f"unrecorded optional plugin: {plugin}")
    checkout = destination / "checkout"
    commit = fetch_checkout(pin["url"] if plugin else pin["repository"], ref, checkout)
    if plugin:
        candidate = destination / "plugins" / plugin
        candidate.mkdir(parents=True)
        archive_checkout(checkout, commit, candidate)
        # Keep an independent checkout so later status checks can reconstruct HEAD.
        shutil.copytree(checkout / ".git", candidate / ".git")
        # Patches are replayed in recorded order against pristine candidate files.
        apply_patches(candidate, pin["patches"])
        installed = ctx.plugins / plugin
        if installed.exists():
            copy_vendor(installed, old)
        valid = check(ctx, plugin_override=candidate)
    else:
        candidate = destination / "vendor"
        candidate.mkdir()
        for name in ("shell", "bin", "config", "default", "applications", "themes", "migrations", "install"):
            if not (checkout / name).is_dir():
                raise ValueError(f"upstream tree missing {name}; review upstream structure")
            shutil.copytree(checkout / name, candidate / name, symlinks=True)
        for name in ("version", "logo.svg", "logo.txt", "icon.png", "icon.txt"):
            shutil.copyfile(checkout / name, candidate / name)
        shutil.copyfile(checkout / "LICENSE", candidate / "LICENSE.omarchy")
        copy_vendor(ctx.vendor, old, decode=bool(ctx.source))
        version = ref.removeprefix("v") if re.fullmatch(r"v?\d+\.\d+\.\d+(?:[.-][\w.-]+)?", ref) else f"snapshot-{commit[:12]}"
        pin.update(version=version, commit=commit)
        provenance = (ctx.vendor / "UPSTREAM.md").read_text()
        provenance = re.sub(r"Omarchy [\w.-]+ shell from upstream commit\n`[a-f0-9]+`", f"Omarchy {version} shell from upstream commit\n`{commit}`", provenance)
        theme_count = sum(p.is_dir() for p in (candidate / "themes").iterdir())
        provenance = re.sub(r"complete set of \d+ themes", f"complete set of {theme_count} themes", provenance)
        (candidate / "UPSTREAM.md").write_text(provenance)
        source = destination / "source"
        copy_vendor(candidate, source / "dot_config/quickshell/omarchy-stock", encode=True)
        pin_path = source / "dot_config/quickshell/omarchy-core/upstream.json"
        pin_path.parent.mkdir(parents=True, exist_ok=True)
        pin_path.write_text(json_text(pin))
        valid = check(ctx, vendor=candidate)
        (destination / "compatibility.txt").write_text("\n".join(compatibility_notes(ctx, old, candidate)) + "\n")
    changed = write_diff(old, candidate, destination)
    (destination / "review.json").write_text(json_text({"ref": ref, "commit": commit, "plugin": plugin,
                                                       "static_checks_passed": valid, "changed_files": changed}))
    print(f"Staged {commit[:12]}; {changed} changed files. Read changes.txt, changes.diff and review.json.")
    print("No live files changed. Review command dependencies, upstream migrations and runtime behavior before importing.")
    return valid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="inspect a chezmoi source tree instead of deployed code (still checks this machine's layout/plugins)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("version")
    status_parser = sub.add_parser("status", help="read local pins, package versions and plugin patch drift")
    status_parser.add_argument("--online", action="store_true", help="also query GitHub latest release and plugin remote tips")
    sub.add_parser("check", help="static preflight, without loading plugins or contacting the network")
    migrate_parser = sub.add_parser("migrate", help="apply pending local layout migrations with backups")
    migrate_parser.add_argument("--dry-run", action="store_true")
    for command in ("stage", "stage-plugin"):
        stage_parser = sub.add_parser(command, help="fetch into a new review directory; never deploy")
        if command == "stage-plugin":
            stage_parser.add_argument("plugin", help="id from optional-plugins.txt")
        stage_parser.add_argument("ref", help="explicit upstream release tag or commit (plugin refs may also be branches)")
        stage_parser.add_argument("--output", help="new, non-existing review directory; default: unique directory under /tmp")
    args = parser.parse_args()
    ctx = Context(args.source)
    if args.command == "version":
        pin = read_json(ctx.core / "upstream.json")
        print(f"{pin['version']}-local ({pin['commit'][:12]})")
    elif args.command == "status":
        status(ctx, args.online)
    elif args.command == "check":
        return 0 if check(ctx) else 1
    elif args.command == "migrate":
        migrate(ctx, args.dry_run)
    else:
        return 0 if stage(ctx, args.ref, args.output, getattr(args, "plugin", None)) else 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f"desktop-core-maintain: {error}", file=sys.stderr)
        sys.exit(1)
