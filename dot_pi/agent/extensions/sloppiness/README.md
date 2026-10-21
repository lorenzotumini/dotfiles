# On-demand code sloppiness

`/sloppiness [path-or-glob] [options]` analyzes a local repository, folder, or source file. Omit the
path to scan Pi's working directory. Relative paths resolve from that directory;
paths containing spaces can be quoted, and `~` expands to the home directory.

```text
/sloppiness
/sloppiness C:/projects/my-app
/sloppiness "C:/projects/my app/src"
/sloppiness ./src/parser.ts
/sloppiness ./src/parser.c
/sloppiness "./src/**/*.c"
/sloppiness ./repo --include "*.c" --include "*.h"
/sloppiness ./repo --regex "^src/.*\.(c|h)$" --exclude "**/generated/**"
/sloppiness ./repo --list
/sloppiness ./repo --all --list
/sloppiness ./repo --recover
/sloppiness --help
/sloppiness:cancel
```

Use `/sloppiness` and `/sloppiness:cancel` manually, or ask Pi to call the
`code_sloppiness` tool and interpret its findings. The tool accepts `path`,
`include`, `exclude`, `regex`, `all`, `listOnly`, and `recover`. Tool results enter
model context; manual command reports appear in the transcript without calling a
model or entering its context. There are no automatic background scans or prompt
instructions requiring the model to scan. The tool schema makes it discoverable.
The previous `/quality` command and `code_quality` tool names are replaced by these
names. The extension now lives in `extensions/sloppiness`; remove a stale
`extensions/quality` directory when upgrading because Pi/chezmoi do not delete the
old directory as part of this rename. Historical reports still render.

## Selecting files

`--include` and `--exclude` accept globs; repeat either option for multiple patterns.
A pattern without `/`, such as `*.c`, matches filenames at any depth. Patterns with
`/` are relative to the selected root; `**` matches zero or more directories. Multiple
includes are combined with OR; exclusions remove matches. A positional glob chooses
the directory before its first wildcard as the root. Globs do not require shell
expansion; quote them when entering the Pi command.

`--regex` searches relative paths using Python regex syntax and `/` separators on
all platforms. For example, `\.(c|h)$` selects C files and headers; `(?i)\.c$` is
case-insensitive. A regex and include globs must both match when used together.
Invalid regexes produce an error. Patterns select among supported languages;
they do not add parsers for unsupported extensions.

`--list` previews selection without parsing or computing scores. The full report
lists selected and skipped files with reasons. `--all` also considers ignored files
and default-excluded directories; explicit exclusions and analyzer configuration
exclusions still apply. Git metadata is never scanned.

## Dependencies

Requires `uv` on PATH and Pi with `registerEntryRenderer` support (verified with
Pi 0.87.1). No npm dependencies or build step. The first scan uses uv's isolated
tool environment to download `scb-check==0.2.0`, `tree-sitter-c==0.24.2`, their
dependencies, and a compatible Python interpreter if needed. Later scans reuse
uv's cache. Analyzer installation may access the package index; scanning does not send source code to an LLM or
remote analysis service and does not execute the scanned project.

Optional prewarming:

```text
uv --no-config tool run --from scb-check==0.2.0 --with tree-sitter-c==0.24.2 scb-check --version
```

The Python adapter uses the pinned package API to collect scores and findings in
one pass. It checks the package version before scanning. Test the adapter before
updating that pin; upstream rules and scores can change between releases.
The C frontend extends discovery and parsing inside the adapter subprocess only;
it does not patch the installed package on disk. Reports record adapter version 4,
the C grammar version, and the actual parser language for each file.

## Reports and scope

The session shows a compact summary: file count, source LOC, languages, verbosity,
cyclomatic erosion, complex-function count, and up to 3 findings. Coverage warnings
remain visible; rule explanations, diagnostics, and all findings stay in the full
report. Complexity hotspots are ordered by complexity mass (`CC * sqrt(SLOC)`).
Full findings and structured JSON are written to a
unique `pi-sloppiness-*` directory in the system temporary directory. Reports remain
there until temporary-file cleanup. They contain local paths and finding metadata,
not source snippets. Session entries contain the summary, metrics, and report paths.

In a Git repository, discovery uses Git's tracked and untracked file lists, respecting
Git ignore rules for untracked files. A tracked file remains eligible even when a
later ignore rule matches it. Outside Git (or if Git is unavailable), discovery uses
the filesystem and the analyzer's `.gitignore` matcher. Default directory exclusions
(such as `node_modules`, `.venv`, `build`, and `dist`) apply unless `--all` is used.
Tests are included unless excluded. `scb-check.toml` / supported `pyproject.toml`
settings are discovered upward from the target, stopping at a Git repository or
worktree boundary. Explicit file paths bypass directory-discovery exclusions.
Symlinks are skipped during folder discovery. Submodules and nested Git repositories
can be scanned explicitly as separate roots.

Supported extensions: `.c`, `.h`, `.py`, `.pyw`, `.js`, `.mjs`, `.cjs`, `.ts`, `.rs`, `.zig`,
`.hs`, `.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`. Unsupported extensions,
including `.jsx`, `.tsx`, `.go`, `.java`, and shell files, are not scored.
Python has additional ast-grep and structural verbosity rules. Other supported
languages have clone-based verbosity; all have complexity analysis. Scores from
different language mixes should not be treated as equivalent quality ratings.

### C and headers

`.c` files use the C grammar. `.h` files try C first and fall back to C++ when
the C grammar rejects their syntax. A header valid in both languages is labeled C;
`.hpp`, `.hh`, and `.hxx` always use C++. Header function declarations do not add
function mass; inline function definitions do. Folder scans count each source file
once, without expanding includes.

C cyclomatic complexity is one plus `if`, loops, ternary expressions, non-default
`case` labels, and `&&`/`||` operators. The `switch` statement and its `default`
label add no additional decisions. C verbosity measures syntax duplication.

This is source analysis, without a compiler or build configuration. Macros are not
expanded, and all `#if`/`#ifdef` branches are analyzed as written; preprocessor
directives themselves do not add complexity. Some valid macro-heavy code or
compiler extensions may fail parsing. Strict mode skips these files and records
them as parse failures. `--recover` allows C syntax recovery when the parser can
identify functions; recovered files and the resulting scores are explicitly marked
approximate. Headers still try strict C and C++ before attempting recovery. Recovery
does not expand macros and may miss or misinterpret code. Results can differ from
metrics on a particular preprocessed build.

Only outermost C function definitions contribute separate function mass. Nested
function candidates can be macro dispatch artifacts; their decisions remain in
the enclosing function without counting its region twice. This policy also folds
genuine GNU nested functions into their parent. Macros that introduce decisions
can still be missed without expansion.

Reports contain measurements and hotspots without published human-code baseline
comparisons. Scores do not establish authorship or an overall quality grade.

Verbosity counts the union of flagged source lines, rather than adding overlapping
counts. Erosion is the fraction of function mass held by functions with `CC > 10`.
No before/after LOC delta is calculated in this version. Parser or analyzer warnings
appear as diagnostics so partial coverage is visible. A failure to parse every file
does not necessarily fail the whole scan. A scan with no parsed files returns the
selection report and no scores, rather than reporting zero verbosity/erosion.
Full reports distinguish visible candidates, selected files, unsupported extensions,
filters/exclusions, parse failures, and recovered files. Git-ignored files are not
enumerated in the default selection; use `--all --list` to inspect them.

The adapter removes repeated traversal in the pinned analyzer's cognitive-complexity
calculation, preserving scores while avoiding exponential work on deeply nested code.

Scans have a 3-minute timeout and a 16 MiB subprocess-output limit. Cancellation,
timeout, and session shutdown terminate the analyzer process tree. Source files are
never edited. There are no background scans, automatic fixes, or quality gates.

## Verification

```text
node --test tests/smoke.mjs
```

Run from this directory. Requires uv and downloads/reuses the pinned analyzer.
Set `PI_CODING_AGENT_PACKAGE` to the installed `@earendil-works/pi-coding-agent`
directory to also exercise extension loading, command rendering, the restored
`code_sloppiness` tool.
The suite includes C-specific syntax, exact decision counts, macros, conditional
compilation, C/C++ headers, cross-file clones, and malformed-source diagnostics.
It also covers macro dispatch artifacts, deep nesting, syntax recovery, Git-tracked ignored files, globs,
regexes, ignored-file inclusion, and selection-only previews.

References: [scb-check](https://github.com/gabeorlanski/scb-check),
[Measuring the Sloppiness of Code](https://earendil.com/posts/measuring-code-sloppiness/).
