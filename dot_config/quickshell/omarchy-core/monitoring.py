"""Desktop runtime probes and upstream observation; never installs or updates code."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PACKAGES = ('qt6-base', 'qt6-declarative', 'qt6-wayland', 'quickshell', 'hyprland', 'uwsm')


def command(*args, timeout=15, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, **kwargs)
    if result.returncode:
        raise ValueError(f'{args[0]}: {result.stderr.strip() or result.stdout.strip()}')
    return result.stdout.strip()


def read(path, fallback=None):
    return json.loads(path.read_text()) if path.exists() else fallback


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(json.dumps(value, indent=2, sort_keys=True) + '\n')
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def runtime_versions():
    return dict(line.split(maxsplit=1) for line in command('pacman', '-Q', *PACKAGES).splitlines())


def runtime_snapshot(ctx):
    # Include actual QML, not just the upstream pin: backports and plugin edits
    # must invalidate a previous successful probe too.
    hashes = hashlib.sha256()
    roots = [ctx.vendor / 'shell', *sorted(ctx.plugin_dirs())]
    for index, root in enumerate(roots):
        for path in sorted(root.rglob('*')):
            if '.git' in path.parts or not path.is_file():
                continue
            if path.suffix not in ('.qml', '.js', '.json') and path.name != 'qmldir':
                continue
            hashes.update(f'{index}/{path.relative_to(root)}\0'.encode())
            hashes.update(path.read_bytes())
    hashes.update((ctx.core / 'health.qml').read_bytes())
    for name in ('monitoring.py', 'maintenance.py'):
        hashes.update((ctx.core / name).read_bytes())
    return {'packages': runtime_versions(), 'desktop': read(ctx.core / 'upstream.json'),
            'qml_sha256': hashes.hexdigest()}


def palette_probe(ctx):
    with tempfile.TemporaryDirectory(prefix='desktop-health-') as directory:
        probe = Path(directory)
        for name in ('Commons', 'Ui'):
            (probe / name).symlink_to(ctx.vendor / 'shell' / name, target_is_directory=True)
        shutil.copyfile(ctx.core / 'health.qml', probe / 'shell.qml')
        runtime = probe / 'runtime'
        runtime.mkdir(mode=0o700)
        env = dict(os.environ, QT_QPA_PLATFORM='offscreen', QT_QUICK_BACKEND='software',
                   XDG_RUNTIME_DIR=str(runtime), XDG_CACHE_HOME=str(probe / 'cache'))
        # No other QML imports or compositor windows are needed for this probe.
        result = subprocess.run(['quickshell', '-p', str(probe), '--no-color'], env=env,
                                capture_output=True, text=True, timeout=12)
        output = result.stdout + result.stderr
        if result.returncode or 'DESKTOP_HEALTH_PASS' not in output or re.search(
                r'DESKTOP_HEALTH_FAIL|TypeError|ReferenceError|Unable to assign|Failed to load', output):
            raise ValueError('palette/widget probe failed:\n' + output[-6000:])
    print('PASS isolated palette loading, theme changes and widget color bindings')


def live_probe(ctx):
    pid = command('systemctl', '--user', 'show', 'desktop-core-shell.service', '-p', 'MainPID', '--value')
    if pid == '0':
        print('SKIP live shell IPC/journal: shell is not running')
        return False
    env = dict(os.environ, OMARCHY_PATH=str(ctx.core))
    ipc = ctx.home / '.local/bin/omarchy-shell'
    # omarchy-shell is normally reached through the generated command allowlist.
    ipc = ctx.core / 'bin/omarchy-shell' if not ipc.exists() else ipc
    for target in ('shell', 'image-selector'):
        if command(str(ipc), target, 'ping', env=env) != 'ok':
            raise ValueError(f'{target} IPC did not answer ok')
    logs = command('journalctl', '--user', '-b', f'_PID={pid}',
                   '_SYSTEMD_USER_UNIT=desktop-core-shell.service', '-n', '2000', '-o', 'cat', '--no-pager')
    # The pinned shell has a pre-existing readonly moduleName warning. Keep it
    # visible in the journal while detecting new palette/load failures here.
    failures = [line for line in logs.splitlines() if re.search(
        r'Unable to assign .*QColor|Cannot read property|loadColors.*not a function|Failed to load|ERROR', line)]
    if failures:
        raise ValueError('live shell errors:\n' + '\n'.join(failures[-15:]))
    print('PASS live shell and picker IPC; no palette/load errors in current shell journal')
    return True


def health(ctx, static_check, record=False, live=True):
    if Path('/var/lib/pacman/db.lck').exists():
        raise ValueError('package transaction is in progress; retry after it finishes')
    if ctx.source and record:
        raise ValueError('record health from deployed code, without --source')
    before = runtime_snapshot(ctx)
    if not static_check(ctx):
        return False
    palette_probe(ctx)
    live_checked = live_probe(ctx) if live else False
    if before != runtime_snapshot(ctx):
        raise ValueError('runtime or QML changed during the probe; retry')
    if record:
        save(ctx.state / 'runtime-validated.json', {'checked_at': timestamp(), 'snapshot': before,
             'scope': 'static checks and isolated palette/widget probe', 'live_checked': live_checked})
        print('Recorded validated runtime: ' + str(ctx.state / 'runtime-validated.json'))
    return True


def notify(title, body):
    try:
        command('notify-send', '--app-name=Desktop maintenance', '--expire-time=12000',
                title, html.escape(body), timeout=5)
        return True
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'WARN desktop notification unavailable: {error}')
        return False


def monitor(ctx, static_check):
    if ctx.source:
        raise ValueError('monitor runs against deployed code, without --source')
    if Path('/var/lib/pacman/db.lck').exists():
        print('SKIP package transaction is in progress')
        return True
    ctx.state.mkdir(parents=True, exist_ok=True)
    with (ctx.state / 'runtime-monitor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        snapshot = runtime_snapshot(ctx)
        validated = read(ctx.state / 'runtime-validated.json', {})
        if validated.get('snapshot') == snapshot:
            print('Runtime and QML match the last successful validation')
            return True
        print('Runtime or QML changed; checking compatibility')
        previous = read(ctx.state / 'runtime-attempt.json', {})
        success, error = False, ''
        try:
            success = health(ctx, static_check, record=True)
        except (OSError, ValueError, subprocess.SubprocessError) as failure:
            error = str(failure)
            print('FAIL ' + error)
        attempt = {'snapshot': snapshot, 'passed': success, 'checked_at': timestamp(), 'error': error}
        changed = previous.get('snapshot') != snapshot or previous.get('passed') != success
        if changed or not previous.get('notified', False):
            if success:
                attempt['notified'] = notify('Desktop runtime checks passed', 'Qt, Quickshell and desktop compatibility checks passed. Details: desktop-core-maintain status')
            else:
                attempt['notified'] = notify('Desktop runtime needs attention', 'Compatibility checks failed. Run desktop-core-maintain health; see desktop-core-runtime-check.service logs.')
        else:
            attempt['notified'] = True
        save(ctx.state / 'runtime-attempt.json', attempt)
        return success


def github(endpoint):
    request = Request('https://api.github.com/repos/' + endpoint,
                      headers={'User-Agent': 'desktop-core-maintenance', 'Accept': 'application/vnd.github+json'})
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def slug(url):
    match = re.fullmatch(r'https://github.com/([\w.-]+/[\w.-]+?)(?:\.git)?/?', url)
    if not match:
        raise ValueError('expected a GitHub repository URL')
    return match[1]


def upstream_report(ctx):
    pin = read(ctx.core / 'upstream.json')
    policy = read(ctx.core / 'maintenance-policy.json')
    repo = slug(pin['repository'])
    tasks = {'release': lambda: github(repo + '/releases/latest')}
    for path in policy['paths']:
        tasks['branch:' + path] = lambda path=path: github(repo + '/commits?' + urlencode(
            {'sha': policy['branch'], 'path': path, 'per_page': policy['recent_commits']}))
        tasks['pin:' + path] = lambda path=path: github(repo + '/commits?' + urlencode(
            {'sha': pin['commit'], 'path': path, 'per_page': 1}))
    for plugin in ctx.pins():
        tasks['plugin:' + plugin['name']] = lambda plugin=plugin: github(slug(plugin['url']) + '/commits?per_page=1')
    values, errors = {}, {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {name: executor.submit(task) for name, task in tasks.items()}
        for name, future in futures.items():
            try:
                values[name] = future.result()
            except (OSError, ValueError, KeyError) as error:
                errors[name] = str(error)
    release = values.get('release', {})
    report = {'checked_at': timestamp(), 'pin': pin, 'branch': policy['branch'], 'errors': errors,
              'release': {k: release.get(k) for k in ('tag_name', 'published_at', 'html_url')},
              'paths': {}, 'plugins': {}}
    for path in policy['paths']:
        recent, pinned = values.get('branch:' + path, []), values.get('pin:' + path, [])
        report['paths'][path] = {'pinned_tip': pinned[0]['sha'] if pinned else None, 'recent': [
            {'sha': entry['sha'], 'message': entry['commit']['message'].splitlines()[0],
             'url': entry['html_url']} for entry in recent]}
    for plugin in ctx.pins():
        recent = values.get('plugin:' + plugin['name'], [])
        report['plugins'][plugin['name']] = {'pin': plugin['commit'], 'tip': recent[0]['sha'] if recent else None}
    return report


def candidates(report):
    release = report['release']['tag_name']
    paths = {path: item['recent'][0]['sha'] for path, item in report['paths'].items()
             if item['recent'] and item['pinned_tip'] and item['recent'][0]['sha'] != item['pinned_tip']}
    plugins = {name: item['tip'] for name, item in report['plugins'].items() if item['tip'] and item['tip'] != item['pin']}
    return {'release': release if release and release != 'v' + report['pin']['version'] else None,
            'paths': paths, 'plugins': plugins}


def report_text(report):
    lines = [f"Checked: {report['checked_at']}", f"Installed snapshot: {report['pin']['version']}",
             f"Latest release: {report['release']['tag_name']} {report['release']['html_url']}",
             f"Recent desktop changes on {report['branch']} (review candidates, not compatibility guarantees):"]
    for path, item in report['paths'].items():
        lines.append(f'  {path}:')
        for commit in item['recent']:
            lines.append(f"    {commit['sha'][:12]} {commit['message']} {commit['url']}")
    for name, item in report['plugins'].items():
        lines.append(f"Plugin {name}: {item['tip']} (pin {item['pin']})")
    for name, error in report['errors'].items():
        lines.append(f'ERROR {name}: {error}')
    lines.append('Review snapshots monthly; stage an explicit ref with desktop-core-maintain stage <ref>.')
    return '\n'.join(lines) + '\n'


def review(ctx, notifications=False):
    if ctx.source:
        raise ValueError('save upstream reports from deployed code, without --source')
    ctx.state.mkdir(parents=True, exist_ok=True)
    with (ctx.state / 'upstream-review.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        report = upstream_report(ctx)
        save(ctx.state / 'upstream-report.json', report)
        text = report_text(report)
        (ctx.state / 'upstream-report.txt').write_text(text)
        print(text, end='')
        if report['errors']:
            return False  # Never acknowledge an incomplete upstream observation.
        observed = candidates(report)
        path = ctx.state / 'upstream-notified.json'
        if notifications and read(path) != observed:
            if observed['release'] or observed['paths'] or observed['plugins']:
                if not notify('Upstream desktop changes available',
                              'Review releases, shell fixes and plugins in ~/.local/state/desktop-core/upstream-report.txt. No updates were installed.'):
                    return False
            save(path, observed)
    return True
