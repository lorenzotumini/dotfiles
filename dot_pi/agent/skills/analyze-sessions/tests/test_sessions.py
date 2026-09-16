"""Synthetic-only regression suite; never reads the user's real session tree."""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import sessions as S
import cost
import prompts
import search
import show_session


def usage(total):
    return {'input': 10, 'output': 5, 'cost': {'total': total}}


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_root = S.SESSIONS_ROOT
        S.SESSIONS_ROOT = self.root
        self.env = dict(os.environ, PI_CODING_AGENT_SESSION_DIR=str(self.root), PYTHONDONTWRITEBYTECODE='1')

    def tearDown(self):
        S.SESSIONS_ROOT = self.old_root
        self.temp.cleanup()

    def fixture(self, sid='one', date='2020-01-01T12:00:00Z', records=None, relative=None):
        path = self.root / (relative or f'--project--/{sid}.jsonl')
        path.parent.mkdir(parents=True, exist_ok=True)
        header = {'type': 'session', 'id': sid, 'timestamp': date, 'cwd': '/fixture'}
        if records is None:
            records = [{'type': 'message', 'message': {'role':'assistant', 'model':'model', 'provider':'custom-provider', 'usage':usage(1), 'content':[]}}]
        path.write_text('\n'.join(json.dumps(r) for r in [header, *records])+'\n')
        return path

    def cli(self, script='cost.py', *args):
        return subprocess.run([sys.executable, '-B', str(SCRIPTS/script), *args], env=self.env, capture_output=True, text=True)

    def test_all_usage_sources_and_no_retained_tail_double_count(self):
        assistant = {'role':'assistant', 'provider':'custom-provider', 'model':'same', 'usage':usage(1), 'content':[]}
        path = self.fixture(records=[
            {'type':'message','message':assistant},
            {'type':'message','message':{**assistant, 'provider':'other', 'usage':usage(2)}},
            {'type':'message','message':{'role':'toolResult','usage':usage(3),'content':[]}},
            {'type':'compaction','usage':usage(4),'retainedTail':[assistant]},
            {'type':'branch_summary','usage':usage(5)},
            {'type':'custom','data':{'usage':usage(999)}},
        ])
        s = S.summarize_session(path)
        self.assertEqual(s.cost_total, 15)
        self.assertEqual(s.tok_input, 50)
        self.assertEqual(s.cost_by_model['custom-provider/same'], 1)
        self.assertEqual(s.cost_by_model['other/same'], 2)
        self.assertEqual(s.cost_by_model['[tool usage: model unknown]'], 3)
        report = cost.build_report([s], 'model')
        self.assertAlmostEqual(sum(row['cost'] for row in report['groups'].values()), report['total_cost'])

    def test_legacy_string_prompts_all_consumers(self):
        p = self.fixture(records=[{'type':'message','message':{'role':'user','content':'hello fixture'}}])
        self.assertEqual(S.summarize_session(p).first_user_prompt, 'hello fixture')
        self.assertEqual(prompts._collect_prompts(p, 2000, 1)[0][1], 'hello fixture')
        self.assertEqual(search._join_text('hello'), 'hello')
        self.assertEqual(show_session._join_text('hello'), 'hello')
        for script, args in [('prompts.py', ['--format','jsonl']), ('search.py',['hello']), ('show_session.py',['--latest'])]:
            r = self.cli(script, *args)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('hello fixture', r.stdout)

    def test_malformed_lines_and_cost_numbers(self):
        p = self.fixture(records=[None, [], {'type':'message','message':'invalid'}, {'type':'message','message':{'role':'assistant','content':[], 'usage':{'input':'bad','output':float('nan'),'cost':{'input':0.2,'output':0.3}}}}])
        with p.open('a') as f: f.write('{unfinished\n')
        s = S.summarize_session(p)
        self.assertAlmostEqual(s.cost_total, 0.5)
        self.assertEqual(s.tok_input, 0)
        self.assertTrue(all(isinstance(r,dict) for r in S.iter_records(p)))

    def test_unknown_dates_and_naive_utc(self):
        self.assertEqual(S.ts_from_iso('2020-01-01T00:00:00').tzinfo, timezone.utc)
        s = S.summarize_session(self.fixture(date='bad'))
        self.assertFalse(S.Filters(since=S.parse_date('2000-01-01')).matches(s))
        with contextlib.redirect_stdout(io.StringIO()):
            prompts._render_markdown([(s,[(0,'missing date')]), (S.summarize_session(self.fixture('dated')),[(0,'dated')])],2)

    def test_dates_and_until_includes_entire_utc_day(self):
        parser = argparse.ArgumentParser()
        S.add_filter_args(parser, subagents_default=False)
        args = parser.parse_args(['--until','2020-01-01','--provider','openai-codex'])
        filters = S.filters_from_args(args, subagents_default=False)
        self.assertEqual(filters.until, datetime(2020,1,1,23,59,59,999999,tzinfo=timezone.utc))
        self.assertEqual(filters.provider,'openai-codex')
        self.fixture()
        r = self.cli('cost.py','--until','2020-01-01','--json','--provider','custom-provider')
        self.assertEqual(json.loads(r.stdout)['total_sessions'],1)
        r = self.cli('cost.py','--since','not-a-date')
        self.assertEqual(r.returncode,2)
        self.assertNotIn('Traceback',r.stderr)

    def test_all_time_and_json_empty(self):
        self.fixture()
        default = self.cli('cost.py','--json')
        self.assertEqual(json.loads(default.stdout)['total_sessions'],0)
        all_time = self.cli('cost.py','--all-time','--json','--cwd','fixture')
        self.assertEqual(json.loads(all_time.stdout)['total_sessions'],1)
        self.assertEqual(self.cli('cost.py','--all-time','--since','7d').returncode,2)

    def test_limit_consistency_and_totals(self):
        self.fixture('old','2020-01-01T12:00:00Z')
        self.fixture('new','2020-01-02T12:00:00Z')
        for by in ['day','session','project','model','total']:
            result = self.cli('cost.py','--all-time','--json','--by',by,'--limit','1')
            self.assertEqual(result.returncode,0,result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report['total_sessions'],2)
            self.assertEqual(report['total_cost'],2)
            self.assertEqual(len(report['groups']),1)
            if by == 'day':
                self.assertIn('2020-01-02', report['groups'])
                table = self.cli('cost.py','--all-time','--by','day','--limit','1')
                self.assertIn('1 groups omitted',table.stdout)
        self.assertEqual(self.cli('cost.py','--limit','0').returncode,2)
        self.assertEqual(self.cli('cost.py','--limit','-1').returncode,2)

    def test_subagent_discovery_and_toggle(self):
        self.fixture('parent')
        child = self.fixture('child', relative='--project--/timestamp_parent/child/run-1/child.jsonl')
        self.assertEqual(S.parent_session_id_from_path(child),'parent')
        self.assertEqual(len(S.load_summaries(S.Filters(include_subagents=True))),2)
        self.assertEqual(len(S.load_summaries(S.Filters(include_subagents=False))),1)
        for flag, count in [('--include-subagents',2),('--no-subagents',1)]:
            report = json.loads(self.cli('cost.py','--all-time','--json',flag).stdout)
            self.assertEqual(report['total_sessions'],count)

    def test_error_filter_and_nonmessage_timestamp(self):
        p = self.fixture(records=[{'type':'message','message':{'role':'toolResult','isError':True,'content':[]}}, {'type':'compaction','timestamp':'2020-01-02T00:00:00Z','usage':usage(1)}])
        s = S.summarize_session(p)
        self.assertTrue(S.Filters(errors_only=True).matches(s))
        self.assertEqual(s.last_at,S.parse_date('2020-01-02'))


if __name__ == '__main__':
    unittest.main()
