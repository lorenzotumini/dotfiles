"""Run the production adapter once, recording coverage, runtime, and peak memory."""

import ctypes
import importlib.util
import io
import json
import os
import sys
from contextlib import redirect_stderr
from importlib.metadata import version
from pathlib import Path
from time import monotonic


def peak_mib():
    if os.name == "nt":
        from ctypes import wintypes

        class MemoryCounters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                    "PagefileUsage", "PeakPagefileUsage",
                )
            ]

        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        get_process = ctypes.windll.kernel32.GetCurrentProcess
        get_process.restype = wintypes.HANDLE
        get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
        if not get_memory(get_process(), ctypes.byref(counters), counters.cb):
            raise ctypes.WinError()
        return counters.PeakWorkingSetSize / 2**20
    import resource
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value / (2**20 if sys.platform == "darwin" else 1024)


adapter_path, root, output, options_json = sys.argv[1:]
if version("scb-check") != "0.2.0" or version("tree-sitter-c") != "0.24.2":
    raise RuntimeError("This experiment requires scb-check 0.2.0 and tree-sitter-c 0.24.2")
spec = importlib.util.spec_from_file_location("production_adapter", adapter_path)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
diagnostics = io.StringIO()
started = monotonic()
with redirect_stderr(diagnostics):
    adapter.configure_logging(0)
    report = adapter.scan(Path(root).resolve(), json.loads(options_json))
analysis_seconds = monotonic() - started
report["diagnostics"] = diagnostics.getvalue()
selected = report["selection"]["selected"]
physical = {file: len(Path(file).read_bytes().splitlines()) for file in selected}
parsed_lines = sum(physical[file] for file in report["files"])
selected_lines = sum(physical.values())
parsed_set = set(report["files"])
source_coverage = {}
for suffix in (".c", ".h"):
    group = [file for file in selected if Path(file).suffix == suffix]
    total = sum(physical[file] for file in group)
    parsed = sum(physical[file] for file in group if file in parsed_set)
    source_coverage[suffix] = {
        "selectedFiles": len(group), "parsedFiles": sum(file in parsed_set for file in group),
        "selectedPhysicalLines": total, "parsedPhysicalLines": parsed,
        "lineCoverage": parsed / total if total else None,
        "recoveredFiles": sum(file in report["selection"]["recovered"] for file in group),
    }
report["experiment"] = {
    "analysisSeconds": analysis_seconds, "peakWorkingSetMiB": peak_mib(),
    "selectedPhysicalLines": selected_lines, "parsedPhysicalLines": parsed_lines,
    "parsedLineCoverage": parsed_lines / selected_lines if selected_lines else None,
    "pythonVersion": sys.version,
    "sourceCoverage": source_coverage,
}
Path(output).write_text(json.dumps(report, indent=2), encoding="utf-8")
m = report["metrics"]
summary = {
    "selected": len(selected), "parsed": m["files_scanned"],
    "failed": len(report["selection"]["failed"]),
    "recovered": len(report["selection"]["recovered"]),
    "sloc": m["total_loc"], "functions": m["total_functions"],
    "verbosity": m["verbosity"], "erosion": m["erosion"] if m["total_mass"] else None,
    "highComplexityFunctions": m["high_cc_functions"],
    "cloneLines": m["clone_loc"], "totalMass": m["total_mass"],
    **report["experiment"], "reportPath": output,
    "hotspots": [finding for finding in report["findings"] if finding["kind"] == "complexity"][:8],
}
print(json.dumps(summary))
