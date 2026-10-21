"""Select source paths with Git-aware discovery and explicit, auditable filters."""

import fnmatch
import os
import re
import subprocess
from collections import Counter
from functools import lru_cache
from pathlib import Path

from scb_check import walker
from scb_check.config import Config, _has_config, load_config


def project_config(root):
    # Stop at .git files as well as directories (worktrees use .git files).
    for current in (root, *root.parents):
        direct, project = current / "scb-check.toml", current / "pyproject.toml"
        if direct.is_file():
            return load_config(direct, root)
        if project.is_file() and _has_config(project):
            return load_config(project, root)
        if (current / ".git").exists():
            break
    return Config(exclude=(), base_dir=root)


def glob_match(path, pattern):
    pattern = pattern.replace("\\", "/").removeprefix("./").lstrip("/")
    if "/" not in pattern:
        return fnmatch.fnmatchcase(path.rsplit("/", 1)[-1], pattern)
    parts, patterns = tuple(path.split("/")), tuple(pattern.split("/"))

    @lru_cache(None)
    def match(i, j):
        if j == len(patterns):
            return i == len(parts)
        if patterns[j] == "**":
            return match(i, j + 1) or (i < len(parts) and match(i + 1, j))
        return i < len(parts) and fnmatch.fnmatchcase(parts[i], patterns[j]) and match(i + 1, j + 1)

    return match(0, 0)


def git_files(root, include_ignored):
    env = {**os.environ, "GIT_LITERAL_PATHSPECS": "1"}
    try:
        probe = subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"], capture_output=True, timeout=10, env=env)
        if probe.returncode:
            return None
        repo = Path(os.fsdecode(probe.stdout).strip()).resolve()
        args = ["git", "-C", str(repo), "ls-files", "--cached", "--others", "-z"]
        if not include_ignored:
            args.append("--exclude-standard")
        args.extend(["--", root.relative_to(repo).as_posix()])
        result = subprocess.run(args, capture_output=True, timeout=30, env=env)
        if result.returncode:
            raise ValueError(f"Git file discovery failed: {os.fsdecode(result.stderr).strip()}")
        return sorted({repo / os.fsdecode(name) for name in result.stdout.split(b"\0") if name})
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def filesystem_files(root, config, include_ignored):
    rules = () if include_ignored else walker._ancestor_gitignore_rules(root, config)

    def visit(directory, active_rules):
        if not include_ignored:
            active_rules = (*active_rules, *walker._read_gitignore(directory))
        for child in sorted(directory.iterdir()):
            if child.name == ".git":
                continue
            if child.is_symlink() or not child.is_dir():
                yield child
            elif not include_ignored and child.name in walker.DEFAULT_EXCLUDED_DIRS:
                continue
            elif include_ignored or not walker._is_gitignored(child, is_dir=True, rules=active_rules):
                yield from visit(child, active_rules)

    return list(visit(root, rules))


def discover(target, config, options):
    includes, excludes = options.get("include", []), options.get("exclude", [])
    if len(includes) > 20 or len(excludes) > 20:
        raise ValueError("Use at most 20 include and 20 exclude patterns.")
    pattern = options.get("regex")
    if pattern and len(pattern) > 512:
        raise ValueError("Regex is limited to 512 characters.")
    try:
        regex = re.compile(pattern) if pattern else None
    except re.error as error:
        raise ValueError(f"Invalid file regex: {error}") from error
    root = target if target.is_dir() else target.parent
    include_ignored = options.get("all", False)
    candidates = [target] if target.is_file() else git_files(root, include_ignored)
    method = "explicit file" if target.is_file() else "git"
    if candidates is None:
        method = "filesystem"
        candidates = filesystem_files(root, config, include_ignored)
    selected, skipped = [], []
    for path in candidates:
        rel = path.relative_to(root).as_posix()
        reason = None
        if path.is_symlink():
            reason = "symlink"
        elif not path.is_file():
            reason = "missing file or submodule directory"
        elif not target.is_file() and not include_ignored and any(part in walker.DEFAULT_EXCLUDED_DIRS for part in path.relative_to(root).parts[:-1]):
            reason = "default directory exclusion"
        elif options.get("pathGlob") and not glob_match(rel, options["pathGlob"]):
            reason = "path glob filter"
        elif includes and not any(glob_match(rel, item) for item in includes):
            reason = "include filter"
        elif regex and not regex.search(rel):
            reason = "regex filter"
        elif any(glob_match(rel, item) for item in excludes):
            reason = "exclude filter"
        elif path.suffix.lower() not in walker.SUPPORTED_SOURCE_SUFFIXES:
            reason = "unsupported extension"
        elif not target.is_file() and walker._is_user_excluded(path, config):
            reason = "analyzer configuration exclusion"
        elif method == "filesystem" and not include_ignored and not target.is_file():
            rules = (*walker._ancestor_gitignore_rules(path.parent, config), *walker._read_gitignore(path.parent))
            if walker._is_gitignored(path, is_dir=False, rules=rules):
                reason = "gitignore"
        if reason:
            skipped.append({"file": str(path), "reason": reason})
        else:
            selected.append(path.resolve())
    return tuple(sorted(set(selected))), {
        "method": method, "root": str(root), "options": options,
        "discovered": len(candidates), "selected": [str(path) for path in sorted(set(selected))],
        "skipped": skipped, "skipCounts": dict(Counter(item["reason"] for item in skipped)),
        "ignorePolicy": "Git-ignored files are not enumerated unless --all is used; tracked files remain visible. Analyzer configuration exclusions still apply. Filesystem fallback also omits default-excluded directories unless --all is used.",
    }
