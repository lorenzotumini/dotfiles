#!/usr/bin/env python3
"""Cost rollups across pi sessions.

Examples:
  python3 cost.py                                # last 7d, by day
  python3 cost.py --since 30d --by project
  python3 cost.py --since 30d --by model
  python3 cost.py --cwd /path/to/project --all-time
  python3 cost.py --since 30d --by session --limit 10 --show-subagents
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import sessions as S


GROUPINGS = ["total", "day", "project", "model", "session"]


def main() -> int:
    p = argparse.ArgumentParser(description="Cost rollups across pi sessions.")
    p.add_argument("--by", choices=GROUPINGS, default="day",
                   help="Grouping for the breakdown table (default: day). "
                        "'total' prints only the grand total.")
    p.add_argument("--show-subagents", action="store_true",
                   help="Also print a row with the subagent share for each group.")
    p.add_argument("--json", action="store_true", help="Emit JSON instead of a table.")
    p.add_argument("--all-time", action="store_true", help="Disable the default 7-day window (cannot combine with dates).")
    # Preserve included-by-default nested logs; disclose possible usage overlap.
    S.add_filter_args(p, subagents_default=True)
    args = p.parse_args()

    if args.all_time and (args.since or args.until):
        p.error("--all-time cannot be combined with --since/--until")
    # Explicit session selection and --all-time disable the default window.
    if not args.all_time and not args.since and not args.until and not args.session:
        args.since = "7d"

    filters = S.filters_from_args(args, subagents_default=True)
    # For grouped views, --limit caps groups, not sessions. Drop it from the
    # session-level filter so grouping sees every matching session.
    group_limit = args.limit
    filters.limit = None  # --limit never changes grand totals or which sessions are scanned

    summaries = S.load_summaries(filters)

    if not summaries and not args.json:
        S.stderr("No sessions matched.")
        return 0

    if args.json:
        report = build_report(summaries, args.by, limit=group_limit)
        print(json.dumps(report, indent=2, default=str))
        return 0

    if args.by == "total":
        print_grand_total(summaries)
        return 0

    print_grand_total(summaries)
    print()
    print_grouped(summaries, args.by, show_subagents=args.show_subagents,
                  limit=group_limit)
    return 0


# ---------------------------------------------------------------------------
# Grouping
# ---------------------------------------------------------------------------


def session_keys(s: S.SessionSummary, by: str):
    """Return the group key(s) a session contributes to, and a per-key cost
    override. For 'model' a session can split across explicitly attributed
    assistant costs and unknown tool/summary buckets. For everything else it's a
    single key with full session cost."""
    if by == "day":
        k = (s.started_at.astimezone().strftime("%Y-%m-%d")
             if s.started_at else "unknown")
        yield k, s.cost_total
    elif by == "project":
        yield (s.cwd or "?"), s.cost_total
    elif by == "session":
        yield s.id, s.cost_total
    elif by == "model":
        yield from s.cost_by_model.items()
    else:
        yield "all", s.cost_total


def build_report(summaries, by: str, limit=None) -> dict:
    rows = defaultdict(lambda: dict(cost=0.0, sessions=0, messages=0, errors=0,
                                    sub_cost=0.0, sub_sessions=0))
    for s in summaries:
        for k, cost in session_keys(s, by):
            r = rows[k]
            r["cost"] += cost
            r["sessions"] += 1
            r["messages"] += s.message_count
            r["errors"] += s.error_count
            if s.is_subagent:
                r["sub_cost"] += cost
                r["sub_sessions"] += 1
    items = sorted(rows.items(), key=(lambda kv: kv[0]) if by == "day" else (lambda kv: (-kv[1]["cost"], kv[0])))
    if limit and by != "total":
        items = items[-limit:] if by == "day" else items[:limit]
    return {
        "grouping": by,
        "accounting": "recorded usage across all entries; not a deduplicated billing statement",
        "date_basis": "session start (day groups use local timezone)",
        "groups_omitted": len(rows) - len(items),
        "total_cost": sum(s.cost_total for s in summaries),
        "total_sessions": len(summaries),
        "groups": dict(items),
    }


# ---------------------------------------------------------------------------
# Printing
# ---------------------------------------------------------------------------


def print_grand_total(summaries) -> None:
    total = sum(s.cost_total for s in summaries)
    top_level = [s for s in summaries if not s.is_subagent]
    sub = [s for s in summaries if s.is_subagent]
    tok_in = sum(s.tok_input for s in summaries)
    tok_out = sum(s.tok_output for s in summaries)
    cache_r = sum(s.cost_cache_read for s in summaries)
    cache_w = sum(s.cost_cache_write for s in summaries)

    print(f"Recorded cost:  {S.fmt_money(total)}")
    print("  note: all entries counted; fork copies/nested subagent usage may overlap")
    print(f"  sessions:  {len(top_level)} top-level"
          + (f"  +  {len(sub)} subagent" if sub else ""))
    print(f"  cache:     read {S.fmt_money(cache_r)}   write {S.fmt_money(cache_w)}")
    print(f"  tokens:    in {tok_in:,}   out {tok_out:,}")
    if summaries:
        first = min((s.started_at for s in summaries if s.started_at), default=None)
        last = max((s.started_at for s in summaries if s.started_at), default=None)
        if first and last:
            print(f"  window:    {S.fmt_short_ts(first)}  →  {S.fmt_short_ts(last)}")


def print_grouped(summaries, by: str, *, show_subagents: bool, limit) -> None:
    report = build_report(summaries, by, limit=limit)
    items = list(report["groups"].items())
    if report["groups_omitted"]:
        print(f"({report['groups_omitted']} groups omitted; grand total includes all matches)")

    label = {"day": "DATE", "project": "PROJECT", "model": "MODEL",
             "session": "SESSION"}[by]
    # Compute column widths
    keycol = max(len(label), max((len(_render_key(k, by)) for k, _ in items), default=4))
    keycol = min(keycol, 70)

    headers = [label.ljust(keycol), "COST".rjust(10), "SESS".rjust(5),
               "MSGS".rjust(6), "ERR".rjust(5)]
    if show_subagents:
        headers.append("SUB$".rjust(9))
    print("  ".join(headers))
    print("  ".join("-" * len(h) for h in headers))

    for k, r in items:
        key_disp = _render_key(k, by)
        if len(key_disp) > keycol:
            key_disp = "…" + key_disp[-(keycol - 1):]
        row = [
            key_disp.ljust(keycol),
            S.fmt_money(r["cost"]).rjust(10),
            str(r["sessions"]).rjust(5),
            str(r["messages"]).rjust(6),
            str(r["errors"]).rjust(5),
        ]
        if show_subagents:
            row.append(S.fmt_money(r["sub_cost"]).rjust(9))
        print("  ".join(row))


def _render_key(k: str, by: str) -> str:
    if by == "session":
        return k[:8] if k else "?"
    return k or "?"


if __name__ == "__main__":
    sys.exit(main())
