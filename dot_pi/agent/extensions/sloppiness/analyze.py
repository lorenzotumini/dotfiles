"""Single-pass adapter for the pinned scb-check API; never executes scanned code."""

import importlib.util
import io
import json
import sys
from collections import Counter
from contextlib import redirect_stderr
from importlib.metadata import version
from pathlib import Path
from time import monotonic

from scb_check.logging import configure_logging
from scb_check.models import Flags
from scb_check.pipeline import analyze_files
from scb_check.reporting.score import compute_report

# Python runs in isolated mode. Load only our adjacent adapter module explicitly.
_spec = importlib.util.spec_from_file_location("pi_quality_c", Path(__file__).with_name("c_parser.py"))
_c_frontend = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_c_frontend)
_spec = importlib.util.spec_from_file_location("pi_quality_discovery", Path(__file__).with_name("discovery.py"))
_discovery = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_discovery)


def location(item):
    return {
        "file": str(item.file),
        "line": item.start_line,
        "endLine": item.end_line,
    }


def scan(target, options=None):
    options = options or {}
    started = monotonic()
    config = _discovery.project_config(target if target.is_dir() else target.parent)
    parsed_languages, syntax, recovered = _c_frontend.install_c_frontend(recover=options.get("recover", False))
    selected, selection = _discovery.discover(target, config, options)
    selected_at = monotonic()
    flags = analyze_files(selected).flags if selected and not options.get("listOnly") else Flags()
    files = [str(path) for path, _ in flags.lines.total_loc_by_file]
    selection["failed"] = [] if options.get("listOnly") else [str(path) for path in selected if path not in parsed_languages]
    selection["recovered"] = recovered

    findings = []
    # Rank complexity hotspots by their contribution to erosion.
    for symbol in sorted(flags.findings.high_cc_functions, key=lambda f: -f.cc_mass()):
        findings.append({
            "kind": "complexity", **location(symbol), "name": symbol.qualified_name,
            "complexity": symbol.cyc_complexity, "sloc": symbol.sloc,
            "mass": symbol.cc_mass(),
        })
    for clone in flags.findings.clones:
        findings.append({
            "kind": "clone", **location(clone), "group": clone.group_hash,
            "otherInstances": [
                {"file": str(path), "line": line} for path, line in clone.other_instances
            ],
        })
    for hit in flags.findings.ast_grep_hits:
        findings.append({
            "kind": "pattern", "file": str(hit.file), "line": hit.line,
            "endLine": hit.end_line, "rule": hit.rule_id, "message": hit.message,
        })
    for finding in flags.findings.structural_findings:
        findings.append({
            "kind": "structural", **location(finding), "rule": finding.rule_id,
            "message": finding.message,
        })

    languages = Counter(parsed_languages[Path(path)] for path in files)
    metrics = compute_report(flags).to_dict()
    # The upstream IR groups C under CPP; expose actual grammar coverage instead.
    metrics["syntax_by_language"] = dict(sorted(syntax.items()))
    metrics["syntax_tree_count"] = sum(item["tree_count"] for item in syntax.values())
    metrics["syntax_node_count"] = sum(item["node_count"] for item in syntax.values())
    return {
        "schemaVersion": 1, "analyzer": "scb-check", "version": version("scb-check"),
        "adapterVersion": 4, "cGrammarVersion": version("tree-sitter-c"),
        "target": str(target), "metrics": metrics,
        "languages": dict(sorted(languages.items())), "files": files,
        "fileLanguages": {path: parsed_languages[Path(path)] for path in files},
        "excludes": list(config.exclude), "configBase": str(config.base_dir),
        "findings": findings, "selection": selection, "listOnly": options.get("listOnly", False),
        "timing": {"discoverySeconds": selected_at - started, "analysisSeconds": monotonic() - selected_at},
    }


def main():
    if version("scb-check") != "0.2.0":
        raise RuntimeError("This adapter requires scb-check==0.2.0")
    if version("tree-sitter-c") != _c_frontend.C_GRAMMAR_VERSION:
        raise RuntimeError(f"This adapter requires tree-sitter-c=={_c_frontend.C_GRAMMAR_VERSION}")
    diagnostics = io.StringIO()
    with redirect_stderr(diagnostics):
        configure_logging(0)
        report = scan(Path(sys.argv[1]).resolve(), json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    report["diagnostics"] = diagnostics.getvalue()
    json.dump(report, sys.stdout, ensure_ascii=True, allow_nan=False)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
