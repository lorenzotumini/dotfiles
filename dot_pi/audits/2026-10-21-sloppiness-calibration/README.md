# C sloppiness calibration experiment — 2026-10-21

Redis-sized runs are practical on this workstation. The measurements below are
exploratory, not a validated human-C baseline. Macro handling and recovery artifacts
currently limit interpretation more than runtime does. No application baseline or
production analyzer code was changed during this experiment.

Follow-up: adapter version 4 removes the published Python baseline from all report
outputs and prevents nested C function candidates from contributing separate
function mass. The actual Lua `lvm.c` fixture now has no `GET_OPCODE` function
symbol; `luaV_execute` retains CC 61 and 565 SLOC. Small regression fixtures cover
the same artifact both with and without syntax errors. Genuine GNU nested functions
are folded into their enclosing function under this policy. Macro expansion and
build-specific preprocessing remain outside scope. The version-3 measurements
below are preserved as audit evidence; they have not been recalculated and should
not be compared directly with version-4 results.

## Scope and provenance

All snapshots predate ChatGPT. This reduces one authorship confound, but does not
make these selected projects representative of all human C software.

| Project | Tag / commit date | Pinned commit | Scope |
| --- | --- | --- | --- |
| Redis | 7.0.0 / 2022-04-27 | `d375595d5e3ae2e5c29e6c00a2dc3d60578fd9fc` | `src/**/*.c`, `src/**/*.h`; excludes example modules and generated `src/commands.c` |
| Lua | v5.4.4 / 2022-01-13 | `5d708c3f9cae12820e415d4f89c9eacbe2ab964b` | Root `.c`/`.h`; excludes `ltests.c`, `ltests.h` |
| zlib | v1.2.12 / 2022-03-27 | `21767c654d31d2dccdde4330529775c6c5fd5389` | Root `.c`/`.h`; excludes generated `crc32.h`, `inffixed.h`, `trees.h` |
| Linux | v5.18 / 2022-05-22 | `4b0986a3613c92f4ec1bdc7f60ec66fea135991f` | Two separate samples: `lib/math` and `kernel/locking`; not the whole kernel |

Sources: [Redis](https://github.com/redis/redis/tree/7.0.0),
[Lua](https://github.com/lua/lua/tree/v5.4.4),
[zlib](https://github.com/madler/zlib/tree/v1.2.12),
[Linux](https://github.com/torvalds/linux/tree/v5.18).

Runtime uses the production adapter (version 3), `scb-check==0.2.0`,
`tree-sitter-c==0.24.2`, Python 3.14, on Windows with approximately 24 GiB RAM.
The three adapter file SHA-256 hashes are recorded in every row of `results.json`.
Analysis was sequential. Each row is one run, not a statistically stable timing
benchmark. Times include the uv/Python startup but exclude Git downloads and archive
extraction. Peak memory is the analyzer Python process's peak Windows working set;
it excludes Node, Git, and uv. Source trees were not built or executed.

## Recovery-mode results

All of these rows enable syntax recovery and therefore have approximate metrics.
"C coverage" means the fraction of selected `.c` physical lines in files accepted
by the parser; it does not establish that their ASTs or functions were recovered
correctly. Headers are included in the metrics where parseable.

| Scope | Files parsed / selected | C coverage | Recovered files | SLOC | Verbosity | Erosion | Time | Peak memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Redis core | 152 / 155 | 100.0% | 26 | 79,166 | 7.56% | 76.66% | 18.89 s | 196.2 MiB |
| Lua | 38 / 61 | 99.3% | 27 | 14,617 | 2.15% | 44.98% | 3.50 s | 75.0 MiB |
| zlib core | 15 / 23 | 100.0% | 15 | 6,174 | 12.88% | 79.83% | 2.00 s | 58.2 MiB |
| Linux `lib/math` | 11 / 11 | 100.0% | 2 | 783 | 3.70% | 33.10% | 1.17 s | 48.3 MiB |
| Linux `kernel/locking` | 29 / 31 | 100.0% | 24 | 9,235 | 10.17% | 38.84% | 2.49 s | 65.8 MiB |

These numbers must not be averaged into an "average human C score." They are
selected scopes of different sizes, with different coding idioms and incomplete
or approximate parsing. They also use clone-only verbosity, unlike the Python
reference's combined pattern and duplication metric.

## Strict-mode coverage

| Scope | Files parsed / selected | C physical-line coverage | Time |
| --- | ---: | ---: | ---: |
| Redis core | 126 / 155 | 42.6% | 12.93 s |
| Lua | 11 / 61 | 5.0% | 2.57 s |
| zlib core | 0 / 23 | 0.0% | 2.42 s |
| Linux `lib/math` | 9 / 11 | 58.1% | 1.44 s |
| Linux `kernel/locking` | 5 / 31 | 2.5% | 1.74 s |

Strict scores on these incomplete selections are not useful codebase baselines.
In particular, zlib's empty strict result has no score, rather than zero sloppiness.

## Concrete sanity-check findings

1. **Recovery can create phantom functions.** Lua's `lvm.c:1177` contains
   `vmdispatch (GET_OPCODE(i))`, a macro-based dispatch construct. Recovery reports
   a nested function named `luaV_execute.GET_OPCODE` spanning most of the VM loop,
   in addition to the actual `luaV_execute` function at line 1139. That region is
   consequently counted in complexity mass twice. This is a concrete extraction
   defect, not a judgment about Lua's implementation. The nested artifact is the
   second-largest reported Lua hotspot.
2. **Test code affects the reference scope.** Redis's largest hotspot is
   `quicklist.c:1941`, `quicklistTest` (reported CC 169, 995 SLOC). It is embedded
   test code in a product source file. Excluding a top-level tests directory does
   not remove this conditional test body. A production-only baseline needs an
   explicit treatment of preprocessor configurations and embedded tests.
3. **Large functions can be intentional algorithms and dispatchers.** Redis's
   `rdbLoadObject` (reported CC 191) and zlib's `deflate` (CC 85) contribute heavily
   to erosion. The metric measures concentration of branching mass; these values
   alone do not establish poor architecture or unnecessary complexity.
4. **Macros and old-style declarations matter.** zlib's `ZEXPORT` qualifiers and
   K&R-style declarations, and Lua's API and VM macros, defeat strict source parsing.
   Nearly complete file/line coverage after recovery does not solve macro semantics.

The next validity work should check function extraction and decision counts against
a compiler-aware reference on a handful of known functions, define a preprocessing
and test/generated-code policy, then repeat this panel. At minimum, recovery must
distinguish macro syntax from nested function definitions. A production C reference
should be built only after these checks, with coverage and versioned scan scopes.

## Whole-kernel feasibility

The pinned Linux tree contains 75,878 tracked files, including **53,864 `.c`/`.h`
files**. The current Pi command has a 180-second timeout and a 16 MiB subprocess
output limit, and the analyzer holds all parsed trees and cross-file clone data
in memory. Successful small samples do not establish that a whole-tree pass is
feasible. No whole-kernel score or runtime was measured.

A single full-kernel run is not an appropriate next Pi-session test. Measure
subsystems first, with a memory budget, or add an offline batch mode. Subsystem
erosion can be combined by summing high-complexity and total function masses;
ordinary averaging of ratios is incorrect. Duplication/verbosity is harder:
independent batches miss cross-batch clones, so a global clone index or an explicit
change of metric scope is required.

Git for Windows could fetch the Linux commit but rejected its checkout because of
an `aux.c` path elsewhere in the tree. The two samples were safely extracted from
their subtree objects (`HEAD:lib/math`, `HEAD:kernel/locking`) with `git archive`,
then Python's `tarfile` data filter. The full tree was inventoried using
`git ls-tree`; unselected blobs were not checked out. This download/checkout issue
is separate from the analysis runtimes above.

## Artifacts and reproduction

- [results.json](results.json): revisions, options, adapter hashes, coverage,
  timings, peak memory, hotspot samples, and paths to complete raw reports.
- [results.csv](results.csv): compact strict/recovery comparison.
- [run.mjs](run.mjs): sequential, 180-second-bounded experiments using the pinned
  production adapter; skips rows already present in `results.json`.
- [calibrate.py](calibrate.py): coverage and peak-memory recording.
- [summarize.mjs](summarize.mjs): adds `.c`/`.h` coverage and writes the CSV.

Downloaded repositories and complete raw reports are outside chezmoi at
`~/.cache/pi-sloppiness-calibration/2026-10-21/`. The runner defaults to this
workstation's absolute path; set `SLOPPINESS_CALIBRATION_CACHE` to use a different
cache root. Git clones use the tags above with `--depth 1 --single-branch`.
The sparse Linux checkout failure is retained; its Git object store is usable.

To rerun, first archive the old results files, use the exact adapter hashes and
source revisions, then run `node run.mjs` and `node summarize.mjs` from this
directory. Optional project filters include `redis`, `lua`, `zlib`, and `linux`.
Do not compare a future adapter version directly against these rows without
recording its version/hash and repeating the experiment.
