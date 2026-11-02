#!/usr/bin/env python3
"""
MILO Config & Repair UI
=======================
A local web interface served BY THE MACHINE ITSELF, styled with the exact same
visual language, mascot logo, and Lucide icon set as the MILO Recycling System
PWA so technicians can diagnose, view live camera predictions, inspect/edit
database tables, run raw fixes, configure, update, or restore a machine from
any phone or laptop on the local network:

    http://<pi-ip>:8088     (unlock with Technician PIN OR Admin username/password)

Deliberately dependency-free (Python standard library only, with optional
bcrypt for admin password verification). If the virtual environment, the MQTT
broker, or the application are broken, this page still loads.

Every action is a fixed, named operation; nothing from the browser is ever
executed as a shell command.
"""

import glob
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import bcrypt
except ImportError:
    bcrypt = None

MILO_ROOT = os.environ.get('MILO_ROOT', '/opt/milo')
CONFIG_FILE = os.path.join(MILO_ROOT, 'data', 'config.env')
PORT = int(os.environ.get('MILO_UI_PORT', '8088'))

PREVIEW_JPG_PATH = '/dev/shm/milo_preview.jpg' if os.path.isdir('/dev/shm') else '/tmp/milo_preview.jpg'
PREVIEW_JSON_PATH = '/dev/shm/milo_preview.json' if os.path.isdir('/dev/shm') else '/tmp/milo_preview.json'
SIM_SERIAL_PATH = '/dev/shm/milo_sim_serial.cmd' if os.path.isdir('/dev/shm') else '/tmp/milo_sim_serial.cmd'

SESSION_TTL = 3600          # idle logout after an hour
MAX_ATTEMPTS = 5            # failed logins per window, per client address
ATTEMPT_WINDOW = 300

_sessions = {}              # token -> last-seen timestamp
_attempts = {}              # ip -> [timestamps]
_lock = threading.Lock()
_job = {'running': False, 'name': '', 'output': '', 'finished_at': 0, 'ok': None}


def safe_cwd():
    return MILO_ROOT if os.path.isdir(MILO_ROOT) else '/'


# --------------------------------------------------------------------------
# Configuration & Database helpers
# --------------------------------------------------------------------------
def read_config():
    cfg = {}
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                cfg[k.strip()] = v.strip().strip('"')
    except OSError:
        pass
    return cfg


def db_path():
    cfg = read_config()
    return cfg.get('MILO_DB_PATH') or os.path.join(MILO_ROOT, 'data', 'recycling_points.db')


def verify_admin_credentials(username, password):
    """Allow logging into the Repair UI using a MILO Admin account (e.g. admin/milo)."""
    if not username or not password:
        return False
    p = db_path()
    if not os.path.isfile(p):
        return username == 'admin' and password == 'milo'
    try:
        conn = sqlite3.connect(p, timeout=5.0)
        cur = conn.cursor()
        cur.execute('SELECT password_hash FROM admins WHERE username = ?', (username.strip(),))
        row = cur.fetchone()
        conn.close()
        if not row or not row[0]:
            return False
        stored = row[0]
        if stored.startswith('$2') and bcrypt is not None:
            return bcrypt.checkpw(password.encode('utf-8'), stored.encode('utf-8'))
        return hashlib.sha256(password.encode('utf-8')).hexdigest() == stored
    except Exception:
        return False


def write_config(updates):
    """Rewrite only the given keys, preserving comments, order and secrets."""
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as fh:
            lines = fh.readlines()
    except OSError:
        return False
    seen = set()
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith('#') and '=' in stripped:
            key = stripped.split('=', 1)[0].strip()
            if key in updates:
                out.append(f"{key}={updates[key]}\n")
                seen.add(key)
                continue
        out.append(line)
    for k, v in updates.items():
        if k not in seen:
            out.append(f"{k}={v}\n")
    tmp = CONFIG_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.writelines(out)
    os.chmod(tmp, 0o640)
    os.replace(tmp, CONFIG_FILE)
    return True


def main_unit():
    return 'milo-edge.service' if read_config().get('MILO_ROLE') == 'edge' else 'milo-core.service'


def strip_noise(text):
    """Filter out harmless shell-init/getcwd and null-byte warnings."""
    if not text:
        return ''
    cleaned = [
        ln for ln in text.splitlines()
        if 'getcwd: cannot access parent directories' not in ln
        and 'ignored null byte in input' not in ln
    ]
    return '\n'.join(cleaned)


def extract_json_line(text):
    """Find the last valid JSON object line in command output, ignoring stderr noise."""
    for ln in reversed((text or '').splitlines()):
        s = ln.strip()
        if s.startswith('{') and s.endswith('}'):
            try:
                return json.loads(s)
            except ValueError:
                continue
    return None


def run(cmd, timeout=600):
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=safe_cwd(),
        )
        out = strip_noise((p.stdout or '') + (p.stderr or ''))
        return p.returncode, out
    except subprocess.TimeoutExpired:
        return 124, 'Timed out.'
    except (OSError, ValueError) as e:
        return 1, f'Could not run: {e}'


def tool(name):
    """Prefer the installed command, fall back to the copy in this release."""
    found = shutil.which(name)
    if found:
        return found
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + '.sh')
    if os.path.exists(local):
        return local
    local_plain = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    return local_plain if os.path.exists(local_plain) else name


# --------------------------------------------------------------------------
# Actions — a closed set; the browser can only pick one of these names
# --------------------------------------------------------------------------
def _job_runner(name, cmd, timeout):
    code, out = run(cmd, timeout)
    with _lock:
        _job.update(running=False, output=out[-20000:], finished_at=time.time(), ok=(code == 0))


def start_job(name, cmd, timeout=600):
    with _lock:
        if _job['running']:
            return False, 'Another task is still running.'
        _job.update(running=True, name=name, output='', finished_at=0, ok=None)
    threading.Thread(target=_job_runner, args=(name, cmd, timeout), daemon=True).start()
    return True, 'started'


def wake_detector_sim():
    try:
        with open(SIM_SERIAL_PATH, 'w', encoding='utf-8') as fh:
            fh.write('START:1001\n')
        return True, 'Woke detector for test user 1001'
    except OSError as e:
        return False, str(e)


def capture_still_fallback():
    """If the GStreamer pipeline isn't writing frames, grab one via rpicam-still."""
    for bin_name in ('rpicam-still', 'libcamera-still'):
        if shutil.which(bin_name):
            return start_job(
                'Capturing test camera frame',
                [bin_name, '-n', '-t', '300', '--width', '640', '--height', '480', '-o', PREVIEW_JPG_PATH],
                20,
            )
    return False, 'rpicam-still not found; start MILO Core service for live GStreamer frames'


ACTIONS = {
    'restart_app':    lambda: start_job('Restarting MILO application', ['systemctl', 'restart', main_unit()], 120),
    'stop_app':       lambda: start_job('Stopping MILO application', ['systemctl', 'stop', main_unit()], 60),
    'start_app':      lambda: start_job('Starting MILO application', ['systemctl', 'start', main_unit()], 120),
    'restart_broker': lambda: start_job('Restarting MQTT broker', ['systemctl', 'restart', 'mosquitto'], 60),
    'run_doctor':     lambda: start_job('Running diagnostics & auto-repair', [tool('milo-doctor'), '--heal'], 240),
    'fix_mqtt':       lambda: start_job('Raw Fix: Rebuilding Mosquitto & Web App credentials', [tool('milo'), 'fix', 'mqtt'], 120),
    'fix_hailo':      lambda: start_job('Raw Fix: Linking Hailo & hailo_apps into venv', [tool('milo'), 'fix', 'hailo'], 240),
    'fix_db':         lambda: start_job('Raw Fix: SQLite WAL checkpoint, integrity check & VACUUM', [tool('milo'), 'fix', 'db'], 180),
    'fix_reinstall':  lambda: start_job('Raw Fix: Full local repair install', [tool('milo'), 'fix', 'reinstall'], 600),
    'wake_detector':  wake_detector_sim,
    'capture_still':  capture_still_fallback,
    'update_check':   lambda: start_job('Checking for updates', [tool('milo-update'), '--check'], 120),
    'update_now':     lambda: start_job('Installing latest update', [tool('milo-update'), '--force'], 900),
    'rollback':       lambda: start_job('Rolling back to previous release', [tool('milo-update'), '--rollback'], 300),
    'backup_now':     lambda: start_job('Creating database snapshot', [tool('milo-backup'), '--rotate'], 300),
    'restore_latest': lambda: start_job('Restoring newest database backup', [tool('milo-backup'), '--restore-latest'], 300),
    'reboot':         lambda: start_job('Rebooting Raspberry Pi', ['systemctl', 'reboot'], 30),
}


def gather_status():
    _, out = run([tool('milo-doctor'), '--json'], 90)
    doctor = extract_json_line(out)
    if not doctor:
        doctor = {'overall': 'fail', 'checks': [
            {'id': 'doctor', 'status': 'fail', 'label': 'Diagnostics', 'detail': 'milo-doctor did not respond'}]}

    _, uo = run([tool('milo-update'), '--json'], 60)
    update = extract_json_line(uo) or {'status': 'unknown', 'update_available': False}

    cfg = read_config()
    backups = []
    bdir = os.path.join(MILO_ROOT, 'backups')
    try:
        for fn in sorted(os.listdir(bdir), reverse=True)[:10]:
            p = os.path.join(bdir, fn)
            st = os.stat(p)
            backups.append({'name': fn, 'size': st.st_size, 'mtime': int(st.st_mtime)})
    except OSError:
        pass

    with _lock:
        job = dict(_job)

    return {
        'doctor': doctor,
        'update': update,
        'backups': backups,
        'job': job,
        'config': {
            'machine_id': cfg.get('MILO_MACHINE_ID', ''),
            'machine_name': cfg.get('MILO_MACHINE_NAME', ''),
            'machine_env': cfg.get('MILO_MACHINE_ENV', ''),
            'role': cfg.get('MILO_ROLE', 'both'),
            'mqtt_host': cfg.get('MILO_MQTT_HOST', '127.0.0.1'),
            'channel': cfg.get('MILO_CHANNEL', 'stable'),
            'auto_update': cfg.get('MILO_UPDATE_ENABLED', '1') == '1',
            'repo': cfg.get('MILO_REPO', 'EKOKIBO/MILO-Backend'),
            'site': cfg.get('MILO_SITE', 'https://milo-robotics.org'),
            'camera_input': cfg.get('MILO_CAMERA_INPUT', 'rpi'),
            'has_github_token': bool(cfg.get('MILO_GITHUB_TOKEN', '')),
            'browser_pass': cfg.get('MILO_BROWSER_PASS', 'milo_browser_public'),
            'ui_pin': cfg.get('MILO_UI_PIN', ''),
        },
        'now': int(time.time()),
    }


def list_db_tables():
    p = db_path()
    if not os.path.isfile(p):
        return {'exists': False, 'path': p, 'tables': []}
    try:
        conn = sqlite3.connect(p, timeout=5.0)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        names = [r[0] for r in cur.fetchall()]
        tables = []
        for t in names:
            safe_t = re.sub(r'[^A-Za-z0-9_]', '', t)
            cur.execute(f'SELECT COUNT(*) FROM "{safe_t}"')
            cnt = cur.fetchone()[0]
            cur.execute(f'PRAGMA table_info("{safe_t}")')
            cols = [c[1] for c in cur.fetchall()]
            tables.append({'name': safe_t, 'count': cnt, 'columns': cols})
        conn.close()
        return {'exists': True, 'path': p, 'size': os.path.getsize(p), 'tables': tables}
    except Exception as e:
        return {'exists': True, 'path': p, 'error': str(e), 'tables': []}


def read_db_table(table_name, limit=200):
    safe_t = re.sub(r'[^A-Za-z0-9_]', '', table_name or '')
    if not safe_t:
        return {'error': 'Invalid table name'}
    p = db_path()
    if not os.path.isfile(p):
        return {'error': 'Database file not found'}
    try:
        conn = sqlite3.connect(p, timeout=5.0)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (safe_t,))
        if not cur.fetchone():
            conn.close()
            return {'error': f'Table {safe_t} does not exist'}
        cur.execute(f'PRAGMA table_info("{safe_t}")')
        cols = [c[1] for c in cur.fetchall()]
        pk_cols = [c[1] for c in cur.fetchall() if c[5]]
        cur.execute(f'SELECT rowid AS _rowid_, * FROM "{safe_t}" ORDER BY rowid DESC LIMIT ?', (min(int(limit), 500),))
        rows = [[ '' if v is None else str(v) for v in r ] for r in cur.fetchall()]
        conn.close()
        return {'table': safe_t, 'columns': ['_rowid_'] + cols, 'rows': rows, 'pk': pk_cols}
    except Exception as e:
        return {'error': str(e)}


def execute_db_sql(sql_text, backup_first=True):
    sql_text = (sql_text or '').strip()
    if not sql_text:
        return {'ok': False, 'error': 'SQL query is empty'}
    p = db_path()
    if not os.path.isfile(p):
        return {'ok': False, 'error': 'Database file not found'}
    is_write = not bool(re.match(r'^\s*(SELECT|PRAGMA\s+table_info|PRAGMA\s+quick_check|PRAGMA\s+integrity_check|EXPLAIN)\b', sql_text, re.I))
    if is_write and backup_first:
        run([tool('milo-backup'), '--tag', 'pre-sql'], 30)
    try:
        conn = sqlite3.connect(p, timeout=10.0)
        cur = conn.cursor()
        cur.execute(sql_text)
        if cur.description:
            cols = [d[0] for d in cur.description]
            rows = [['' if v is None else str(v) for v in r] for r in cur.fetchall()[:500]]
            conn.commit()
            conn.close()
            return {'ok': True, 'columns': cols, 'rows': rows, 'rowcount': len(rows)}
        else:
            affected = cur.rowcount
            conn.commit()
            conn.close()
            return {'ok': True, 'columns': ['Result'], 'rows': [[f'Query executed successfully ({affected} rows affected)']], 'rowcount': affected}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def read_camera_state():
    has_frame = os.path.isfile(PREVIEW_JPG_PATH)
    frame_age = round(time.time() - os.path.getmtime(PREVIEW_JPG_PATH), 1) if has_frame else None
    meta = {'ts': 0, 'awake': False, 'user_code': '', 'detections': []}
    if os.path.isfile(PREVIEW_JSON_PATH):
        try:
            with open(PREVIEW_JSON_PATH, 'r', encoding='utf-8') as fh:
                meta = json.load(fh)
        except Exception:
            pass
    return {
        'has_frame': has_frame,
        'frame_age_sec': frame_age,
        'awake': meta.get('awake', False),
        'user_code': meta.get('user_code', ''),
        'detections': meta.get('detections', []),
        'ts': meta.get('ts', 0),
    }


def read_log_source(source):
    if source == 'broker':
        _, out = run(['journalctl', '-u', 'mosquitto.service', '-n', '200', '--no-pager'], 30)
        return out or 'No MQTT broker logs available.'
    if source == 'update':
        p = os.path.join(MILO_ROOT, 'logs', 'update.log')
        if os.path.isfile(p):
            try:
                with open(p, 'r', encoding='utf-8', errors='replace') as fh:
                    return ''.join(fh.readlines()[-250:]) or 'Update log is empty.'
            except OSError:
                pass
        return 'No update.log found yet.'
    if source == 'install':
        logs = sorted(glob.glob(os.path.join(MILO_ROOT, 'logs', 'install-*.log')), reverse=True)
        if logs:
            try:
                with open(logs[0], 'r', encoding='utf-8', errors='replace') as fh:
                    return f"=== {os.path.basename(logs[0])} ===\n" + ''.join(fh.readlines()[-250:])
            except OSError:
                pass
        return 'No install log found.'
    _, out = run(['journalctl', '-u', main_unit(), '-n', '200', '--no-pager'], 30)
    return out or 'No application logs available.'


def load_mascot_png():
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'milo_mascot.png'),
        os.path.join(MILO_ROOT, 'current', 'deploy', 'milo_mascot.png'),
    ]
    for c in candidates:
        if os.path.isfile(c):
            try:
                with open(c, 'rb') as fh:
                    return fh.read()
            except OSError:
                pass
    return None


FALLBACK_MASCOT_SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
<rect width="64" height="64" rx="16" fill="#4f46e5"/>
<rect x="14" y="18" width="36" height="30" rx="8" fill="#ffffff"/>
<circle cx="25" cy="31" r="4" fill="#4f46e5"/>
<circle cx="39" cy="31" r="4" fill="#4f46e5"/>
<path d="M24 40c2.5 2.5 13.5 2.5 16 0" stroke="#10b981" stroke-width="3.5" stroke-linecap="round"/>
<path d="M32 10v8M26 10h12" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
</svg>"""


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = 'MILO-ConfigUI'

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype='application/json', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        data = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass

    def _client(self):
        return self.client_address[0] if self.client_address else '?'

    def _authed(self):
        cookie = self.headers.get('Cookie', '')
        m = re.search(r'milo_sid=([A-Za-z0-9_-]+)', cookie)
        if not m:
            return False
        tok = m.group(1)
        with _lock:
            ts = _sessions.get(tok)
            if ts and time.time() - ts < SESSION_TTL:
                _sessions[tok] = time.time()
                return True
            _sessions.pop(tok, None)
        return False

    def _body(self):
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n <= 0 or n > 64_000:
                return {}
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except (ValueError, OSError):
            return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        if path in ('/', '/index.html'):
            return self._send(200, PAGE, 'text/html; charset=utf-8')
        if path in ('/milo_mascot.png', '/favicon.ico'):
            png = load_mascot_png()
            if png:
                return self._send(200, png, 'image/png', {'Cache-Control': 'public, max-age=3600'})
            return self._send(200, FALLBACK_MASCOT_SVG, 'image/svg+xml')
        if path == '/api/session':
            cfg = read_config()
            return self._send(200, {'authed': self._authed(), 'site': cfg.get('MILO_SITE', 'https://milo-robotics.org')})
        if not self._authed():
            return self._send(401, {'error': 'auth'})
        if path == '/api/status':
            return self._send(200, gather_status())
        if path == '/api/camera/state':
            return self._send(200, read_camera_state())
        if path == '/api/camera/frame.jpg':
            if os.path.isfile(PREVIEW_JPG_PATH):
                try:
                    with open(PREVIEW_JPG_PATH, 'rb') as fh:
                        return self._send(200, fh.read(), 'image/jpeg')
                except OSError:
                    pass
            return self._send(404, b'', 'text/plain')
        if path == '/api/db/tables':
            return self._send(200, list_db_tables())
        if path == '/api/db/table':
            tname = (qs.get('name') or ['users'])[0]
            limit = (qs.get('limit') or ['200'])[0]
            return self._send(200, read_db_table(tname, limit))
        if path == '/api/logs':
            source = (qs.get('source') or ['core'])[0]
            return self._send(200, read_log_source(source), 'text/plain; charset=utf-8')
        return self._send(404, {'error': 'not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._body()

        if path == '/api/login':
            ip = self._client()
            now = time.time()
            with _lock:
                tries = [t for t in _attempts.get(ip, []) if now - t < ATTEMPT_WINDOW]
                _attempts[ip] = tries
                if len(tries) >= MAX_ATTEMPTS:
                    return self._send(429, {'error': 'Too many attempts. Wait five minutes.'})
            real_pin = read_config().get('MILO_UI_PIN', '')
            given_pin = str(body.get('pin', '')).strip()
            username = str(body.get('username', '')).strip()
            password = str(body.get('password', ''))

            pin_ok = bool(real_pin and given_pin and secrets.compare_digest(given_pin, real_pin))
            admin_ok = bool(username and password and verify_admin_credentials(username, password))

            if pin_ok or admin_ok:
                tok = secrets.token_urlsafe(24)
                with _lock:
                    _sessions[tok] = time.time()
                    _attempts.pop(ip, None)
                return self._send(200, {'ok': True}, extra={
                    'Set-Cookie': f'milo_sid={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL}'})
            with _lock:
                _attempts.setdefault(ip, []).append(now)
            return self._send(403, {'error': 'Invalid Technician PIN or Admin credentials'})

        if not self._authed():
            return self._send(401, {'error': 'auth'})

        if path == '/api/action':
            name = str(body.get('action', ''))
            fn = ACTIONS.get(name)
            if not fn:
                return self._send(400, {'error': 'Unknown action'})
            okay, msg = fn()
            return self._send(200 if okay else 409, {'ok': okay, 'message': msg})

        if path == '/api/db/query':
            sql_text = str(body.get('sql', ''))
            backup_first = bool(body.get('backup_first', True))
            res = execute_db_sql(sql_text, backup_first=backup_first)
            return self._send(200 if res.get('ok') else 400, res)

        if path == '/api/db/delete_row':
            tname = re.sub(r'[^A-Za-z0-9_]', '', str(body.get('table', '')))
            rowid = int(body.get('rowid', -1))
            if not tname or rowid < 0:
                return self._send(400, {'ok': False, 'error': 'Invalid table or rowid'})
            res = execute_db_sql(f'DELETE FROM "{tname}" WHERE rowid = {rowid};', backup_first=False)
            return self._send(200 if res.get('ok') else 400, res)

        if path == '/api/config':
            updates = {}
            mid = str(body.get('machine_id', '')).strip()
            if mid:
                updates['MILO_MACHINE_ID'] = re.sub(r'[^A-Za-z0-9_-]', '', mid)[:32]
            if 'machine_name' in body:
                updates['MILO_MACHINE_NAME'] = str(body['machine_name'])[:64].replace('\n', ' ')
            env = str(body.get('machine_env', '')).strip()
            if env in ('', 'office', 'school', 'city'):
                updates['MILO_MACHINE_ENV'] = env
            host = str(body.get('mqtt_host', '')).strip()
            if host and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', host):
                updates['MILO_MQTT_HOST'] = host
            ch = str(body.get('channel', '')).strip()
            if ch in ('stable', 'beta'):
                updates['MILO_CHANNEL'] = ch
            if 'auto_update' in body:
                updates['MILO_UPDATE_ENABLED'] = '1' if body['auto_update'] else '0'
            cam_in = str(body.get('camera_input', '')).strip()
            if cam_in in ('rpi', 'usb', '/dev/video0', 'default'):
                updates['MILO_CAMERA_INPUT'] = cam_in
            repo = str(body.get('repo', '')).strip()
            if repo and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
                updates['MILO_REPO'] = repo
            tok = str(body.get('github_token', '')).strip()
            if tok and re.fullmatch(r'[A-Za-z0-9_.-]{10,256}', tok):
                updates['MILO_GITHUB_TOKEN'] = tok
            if not updates:
                return self._send(400, {'error': 'Nothing valid to save'})
            if not write_config(updates):
                return self._send(500, {'error': 'Could not write the configuration file'})
            if body.get('apply_restart'):
                ACTIONS['restart_app']()
            return self._send(200, {'ok': True, 'saved': list(updates.keys()), 'restarting': bool(body.get('apply_restart'))})

        if path == '/api/logout':
            cookie = self.headers.get('Cookie', '')
            m = re.search(r'milo_sid=([A-Za-z0-9_-]+)', cookie)
            if m:
                with _lock:
                    _sessions.pop(m.group(1), None)
            return self._send(200, {'ok': True}, extra={'Set-Cookie': 'milo_sid=; Path=/; Max-Age=0'})

        return self._send(404, {'error': 'not found'})


# --------------------------------------------------------------------------
# Web Interface — matches the MILO Recycling System PWA
# --------------------------------------------------------------------------
PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<script>
try {
  document.querySelector('meta[name="color-scheme"]').content = localStorage.getItem("color-scheme") ?? "light dark";
} catch {}
</script>
<link rel="icon" href="/milo_mascot.png">
<title>MILO — Repair &amp; Configure</title>
<style>
:root {
  --bg-light: #f1f5f9;
  --bg-dark: #0f172a;
  --card-light: #ffffff;
  --card-dark: #1e293b;
  --card-alt-light: #f8fafc;
  --card-alt-dark: #0f172a;
  --header-light: rgba(255, 255, 255, 0.88);
  --header-dark: rgba(30, 41, 59, 0.88);
  --fg-light: #1e293b;
  --fg-dark: #f1f5f9;
  --muted-light: #64748b;
  --muted-dark: #94a3b8;
  --border-light: #e2e8f0;
  --border-dark: #334155;
  --accent-light: #4f46e5;
  --accent-dark: #6366f1;
  --accent-hover-light: #4338ca;
  --accent-hover-dark: #4f46e5;
  --accent-soft-light: #eef2ff;
  --accent-soft-dark: rgba(99, 102, 241, 0.16);
  --accent-text-light: #4f46e5;
  --accent-text-dark: #818cf8;

  --ok: #10b981;
  --ok-soft-light: #ecfdf5;
  --ok-soft-dark: rgba(16, 185, 129, 0.15);
  --ok-text-light: #047857;
  --ok-text-dark: #34d399;

  --warn: #f59e0b;
  --warn-soft-light: #fffbeb;
  --warn-soft-dark: rgba(245, 158, 11, 0.15);
  --warn-text-light: #b45309;
  --warn-text-dark: #fbbf24;

  --err: #f43f5e;
  --err-soft-light: #fff1f2;
  --err-soft-dark: rgba(244, 63, 94, 0.16);
  --err-text-light: #be123c;
  --err-text-dark: #fb7185;

  --bg: var(--bg-light);
  --card: var(--card-light);
  --card-alt: var(--card-alt-light);
  --header-bg: var(--header-light);
  --fg: var(--fg-light);
  --muted: var(--muted-light);
  --border: var(--border-light);
  --accent: var(--accent-light);
  --accent-hover: var(--accent-hover-light);
  --accent-soft: var(--accent-soft-light);
  --accent-text: var(--accent-text-light);
  --ok-soft: var(--ok-soft-light);
  --ok-text: var(--ok-text-light);
  --warn-soft: var(--warn-soft-light);
  --warn-text: var(--warn-text-light);
  --err-soft: var(--err-soft-light);
  --err-text: var(--err-text-light);

  @media (prefers-color-scheme: dark) {
    --bg: var(--bg-dark);
    --card: var(--card-dark);
    --card-alt: var(--card-alt-dark);
    --header-bg: var(--header-dark);
    --fg: var(--fg-dark);
    --muted: var(--muted-dark);
    --border: var(--border-dark);
    --accent: var(--accent-dark);
    --accent-hover: var(--accent-hover-dark);
    --accent-soft: var(--accent-soft-dark);
    --accent-text: var(--accent-text-dark);
    --ok-soft: var(--ok-soft-dark);
    --ok-text: var(--ok-text-dark);
    --warn-soft: var(--warn-soft-dark);
    --warn-text: var(--warn-text-dark);
    --err-soft: var(--err-soft-dark);
    --err-text: var(--err-text-dark);
  }

  @supports (color: light-dark(white, black)) {
    --bg: light-dark(var(--bg-light), var(--bg-dark));
    --card: light-dark(var(--card-light), var(--card-dark));
    --card-alt: light-dark(var(--card-alt-light), var(--card-alt-dark));
    --header-bg: light-dark(var(--header-light), var(--header-dark));
    --fg: light-dark(var(--fg-light), var(--fg-dark));
    --muted: light-dark(var(--muted-light), var(--muted-dark));
    --border: light-dark(var(--border-light), var(--border-dark));
    --accent: light-dark(var(--accent-light), var(--accent-dark));
    --accent-hover: light-dark(var(--accent-hover-light), var(--accent-hover-dark));
    --accent-soft: light-dark(var(--accent-soft-light), var(--accent-soft-dark));
    --accent-text: light-dark(var(--accent-text-light), var(--accent-text-dark));
    --ok-soft: light-dark(var(--ok-soft-light), var(--ok-soft-dark));
    --ok-text: light-dark(var(--ok-text-light), var(--ok-text-dark));
    --warn-soft: light-dark(var(--warn-soft-light), var(--warn-soft-dark));
    --warn-text: light-dark(var(--warn-text-light), var(--warn-text-dark));
    --err-soft: light-dark(var(--err-soft-light), var(--err-soft-dark));
    --err-text: light-dark(var(--err-text-light), var(--err-text-dark));
  }

  color-scheme: light dark;
  accent-color: var(--accent);
  color: var(--fg);

  &:has(> head > meta[name="color-scheme"][content="dark"]) {
    color-scheme: dark;
  }
  &:has(> head > meta[name="color-scheme"][content="light"]) {
    color-scheme: light;
  }
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
  min-height: 100vh;
}
svg.lucide {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  flex-shrink: 0;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--header-bg);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}
.header-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 16px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: inherit;
}
.mascot-badge {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid var(--border);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  padding: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mascot-badge img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.brand-title {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
  margin: 0;
}
.brand-sub {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-text);
  margin: 3px 0 0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.machine-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--accent-soft);
  color: var(--accent-text);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
}
@media (max-width: 720px) {
  .machine-pill { display: none; }
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--card-alt);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}
.icon-btn:hover {
  border-color: var(--accent);
}

.container {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 800;
  margin: 0;
}
.card-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.hero-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 18px 22px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--card);
  margin-bottom: 16px;
}
.hero-banner.ok   { border-left: 5px solid var(--ok); }
.hero-banner.warn { border-left: 5px solid var(--warn); }
.hero-banner.fail { border-left: 5px solid var(--err); }
.hero-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.status-orb {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.status-orb.ok   { background: var(--ok-soft);   color: var(--ok-text); }
.status-orb.warn { background: var(--warn-soft); color: var(--warn-text); }
.status-orb.fail { background: var(--err-soft);  color: var(--err-text); }
.hero-title {
  font-size: 17px;
  font-weight: 800;
  margin: 0;
}
.hero-sub {
  font-size: 13px;
  color: var(--muted);
  margin: 2px 0 0;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
@media (max-width: 860px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .kpi-grid { grid-template-columns: 1fr; }
}
.kpi-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.kpi-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.kpi-value {
  font-size: 15px;
  font-weight: 800;
  margin-top: 4px;
}
.kpi-detail {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}

.tabs-bar {
  display: flex;
  gap: 6px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 6px;
  margin-bottom: 20px;
  overflow-x: auto;
}
.tab-btn {
  flex: 1;
  min-width: max-content;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.15s;
}
.tab-btn:hover { color: var(--fg); }
.tab-btn.active {
  background: var(--accent);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.28);
}
.tab-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.22);
}
.tab-btn:not(.active) .tab-badge.err {
  background: var(--err-soft);
  color: var(--err-text);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--card-alt);
  color: var(--fg);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-decoration: none;
}
.btn:hover:not(:disabled) {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  color: #ffffff;
  border-color: transparent;
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: transparent;
}
.btn-danger {
  background: var(--err-soft);
  color: var(--err-text);
  border-color: transparent;
}
.btn-danger:hover:not(:disabled) {
  background: var(--err);
  color: #ffffff;
}
.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}
.pill.ok   { background: var(--ok-soft);   color: var(--ok-text); }
.pill.warn { background: var(--warn-soft); color: var(--warn-text); }
.pill.fail { background: var(--err-soft);  color: var(--err-text); }

.checks-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (max-width: 760px) {
  .checks-grid { grid-template-columns: 1fr; }
}
.check-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--card-alt);
  border: 1px solid var(--border);
}
.check-item.fail { border-color: var(--err); background: var(--err-soft); }
.check-item.warn { border-color: var(--warn); }
.check-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.check-dot {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.check-dot.ok   { background: var(--ok-soft);   color: var(--ok-text); }
.check-dot.warn { background: var(--warn-soft); color: var(--warn-text); }
.check-dot.fail { background: var(--err-soft);  color: var(--err-text); }
.check-label { font-size: 13px; font-weight: 700; }
.check-detail { font-size: 12px; color: var(--muted); text-align: right; word-break: break-word; }
.check-item.fail .check-detail { color: var(--err-text); font-weight: 600; }

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 820px) {
  .two-col { grid-template-columns: 1fr; }
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 680px) {
  .form-grid { grid-template-columns: 1fr; }
}
.field label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 6px;
}
.field-hint { font-size: 11px; color: var(--muted); margin-top: 4px; }
input[type="text"],
input[type="password"],
input[type="search"],
textarea,
select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--card-alt);
  color: var(--fg);
  font: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.input-group { display: flex; gap: 8px; }

/* Terminal / Log Viewer (component-specific-light-dark-theme) */
pre.log-viewer {
  color-scheme: only dark;
  background: #0b1120;
  color: #e2e8f0;
  accent-color: var(--accent);
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 14px 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

/* Responsive Data Table (follows modern-web-guidance `responsive-table`) */
.table-wrapper {
  overflow: auto;
  max-inline-size: 100%;
  max-block-size: min(480px, 75vh);
  container-type: inline-size;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card);
}
.table-wrapper table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
}
.table-wrapper caption {
  text-align: left;
  padding: 10px 14px;
  font-weight: 800;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  background: var(--card-alt);
  border-bottom: 1px solid var(--border);
}
.table-wrapper thead {
  position: sticky;
  inset-block-start: 0;
  z-index: 2;
}
.table-wrapper th,
.table-wrapper td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.table-wrapper thead th {
  background: var(--card-alt);
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.table-wrapper tbody th {
  position: sticky;
  inset-inline-start: 0;
  z-index: 1;
  background: var(--card);
  font-family: ui-monospace, monospace;
  font-weight: 700;
}
@container (width < 560px) {
  .table-wrapper table,
  .table-wrapper thead,
  .table-wrapper tbody,
  .table-wrapper tr,
  .table-wrapper th,
  .table-wrapper td {
    display: block;
    white-space: normal;
    max-width: none;
  }
  .table-wrapper thead {
    display: none;
  }
  .table-wrapper tr {
    margin-block-end: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .table-wrapper tbody th {
    position: sticky;
    inset-block-start: 0;
    background: var(--card-alt);
  }
  .table-wrapper td::before {
    content: attr(data-label) ": ";
    font-weight: 800;
    color: var(--muted);
  }
}

.backup-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.backup-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--card-alt);
  border: 1px solid var(--border);
  font-size: 12px;
}
.backup-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  word-break: break-all;
}

/* Camera Preview Frame */
.cam-stage {
  background: #0b1120;
  border: 1px solid var(--border);
  border-radius: 14px;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
.cam-stage img {
  width: 100%;
  max-height: 480px;
  object-fit: contain;
  display: block;
}

/* Login Screen */
.login-wrap {
  min-height: calc(100vh - 80px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}
.login-card {
  max-width: 420px;
  width: 100%;
  text-align: center;
  padding: 32px 28px;
}
.login-mascot {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid var(--border);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
  padding: 8px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-mascot img { width: 100%; height: 100%; object-fit: contain; }
.pin-input {
  text-align: center;
  font-size: 24px !important;
  font-weight: 800;
  letter-spacing: 0.3em;
  padding: 12px !important;
}

/* Native Modal Dialog (`dialog`) */
dialog:modal {
  overscroll-behavior: contain;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--card);
  color: var(--fg);
  padding: 24px;
  max-width: 400px;
  width: calc(100% - 32px);
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.35);
}
dialog::backdrop {
  overflow: hidden;
  overscroll-behavior: contain;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
}
.dialog-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--warn-soft);
  color: var(--warn-text);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
}
.dialog-icon.danger { background: var(--err-soft); color: var(--err-text); }

.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 60;
  background: var(--fg);
  color: var(--card);
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
}

.hidden { display: none !important; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin {
  width: 16px;
  height: 16px;
  border: 2.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
  display: inline-block;
}
</style>
</head>
<body>

<header class="site-header">
  <div class="header-inner">
    <div class="brand">
      <div class="mascot-badge">
        <img src="/milo_mascot.png" alt="" aria-hidden="true" draggable="false">
      </div>
      <div>
        <h1 class="brand-title">MILO</h1>
        <p class="brand-sub">Repair &amp; Configure</p>
      </div>
    </div>

    <div class="header-actions">
      <span id="hdr-machine-pill" class="machine-pill hidden">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
        <span id="hdr-machine-text"></span>
      </span>

      <a id="hdr-pwa-link" href="https://milo-robotics.org" target="_blank" rel="noopener" class="icon-btn" title="Open MILO Web App">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        <span>MILO Web App</span>
      </a>

      <button type="button" class="icon-btn" id="theme-btn" onclick="toggleTheme()" aria-label="Toggle color theme">
        <svg id="icon-sun" class="lucide hidden" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
        <svg id="icon-moon" class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      </button>

      <button type="button" class="icon-btn hidden" id="logout-btn" onclick="logout()">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
        <span>Log out</span>
      </button>
    </div>
  </div>
</header>

<!-- Unified Login View (Technician PIN OR Admin Username/Password) -->
<div id="login-view" class="login-wrap hidden">
  <div class="card login-card">
    <div class="login-mascot">
      <img src="/milo_mascot.png" alt="" aria-hidden="true" draggable="false">
    </div>
    <h2 style="margin:0 0 6px;font-size:22px;font-weight:900">Technician &amp; Admin Access</h2>
    <p style="margin:0 0 16px;font-size:13px;color:var(--muted)">
      Sign in with your MILO Admin account (e.g. <code>admin</code>) or the 6-digit Technician PIN.
    </p>

    <div class="tabs-bar" style="margin-bottom:16px">
      <button type="button" class="tab-btn active" id="lmode-admin" onclick="setLoginMode('admin')">Admin Account</button>
      <button type="button" class="tab-btn" id="lmode-pin" onclick="setLoginMode('pin')">6-Digit PIN</button>
    </div>

    <form onsubmit="login(event)">
      <div id="login-admin-fields" style="display:flex;flex-direction:column;gap:10px">
        <input id="login-user" type="text" placeholder="Admin username (e.g. admin)" value="admin" autocomplete="username">
        <input id="login-pass" type="password" placeholder="Admin password" autocomplete="current-password">
      </div>
      <div id="login-pin-fields" class="hidden">
        <input id="pin" class="pin-input" type="password" inputmode="numeric" autocomplete="one-time-code"
               placeholder="••••••" maxlength="16">
      </div>

      <div id="login-err" style="color:var(--err-text);font-size:13px;font-weight:700;min-height:20px;margin:10px 0"></div>
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:14px" type="submit">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Unlock Machine Console
      </button>
    </form>
  </div>
</div>

<!-- Authenticated Console View -->
<main id="app-view" class="container hidden">

  <!-- Overall Health Hero Banner -->
  <div id="hero-banner" class="hero-banner ok">
    <div class="hero-left">
      <div id="hero-orb" class="status-orb ok">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
      </div>
      <div>
        <h2 id="hero-title" class="hero-title">Checking machine health…</h2>
        <p id="hero-sub" class="hero-sub">Loading diagnostic telemetry…</p>
      </div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-primary" onclick="act('run_doctor')">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        Auto-Repair All Issues
      </button>
      <button type="button" class="btn" onclick="refresh()">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
        Refresh
      </button>
    </div>
  </div>

  <!-- Live Background Task Output Card -->
  <div id="job-card" class="card hidden" style="margin-bottom:18px;border-color:var(--accent)">
    <div class="card-header" style="margin-bottom:10px">
      <div class="card-title">
        <span id="job-spin" class="spin"></span>
        <span id="job-title">Running task…</span>
      </div>
      <span id="job-badge" class="pill warn">In progress</span>
    </div>
    <pre id="job-out" class="log-viewer" style="max-height:220px"></pre>
  </div>

  <!-- 4 Summary KPI Cards -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div>
        <div class="kpi-label">MILO Core Service</div>
        <div id="kpi-app-val" class="kpi-value">—</div>
        <div id="kpi-app-det" class="kpi-detail">—</div>
      </div>
      <span id="kpi-app-dot" class="check-dot ok">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
      </span>
    </div>
    <div class="kpi-card">
      <div>
        <div class="kpi-label">MQTT Broker</div>
        <div id="kpi-mqtt-val" class="kpi-value">—</div>
        <div id="kpi-mqtt-det" class="kpi-detail">—</div>
      </div>
      <span id="kpi-mqtt-dot" class="check-dot ok">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/></svg>
      </span>
    </div>
    <div class="kpi-card">
      <div>
        <div class="kpi-label">AI HAT+ &amp; Vision</div>
        <div id="kpi-hw-val" class="kpi-value">—</div>
        <div id="kpi-hw-det" class="kpi-detail">—</div>
      </div>
      <span id="kpi-hw-dot" class="check-dot ok">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
      </span>
    </div>
    <div class="kpi-card">
      <div>
        <div class="kpi-label">Database &amp; Temp</div>
        <div id="kpi-db-val" class="kpi-value">—</div>
        <div id="kpi-db-det" class="kpi-detail">—</div>
      </div>
      <span id="kpi-db-dot" class="check-dot ok">
        <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
      </span>
    </div>
  </div>

  <!-- 6 Segmented Navigation Tabs -->
  <nav class="tabs-bar" aria-label="Console sections">
    <button type="button" class="tab-btn active" data-tab="health" onclick="switchTab('health')">
      <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
      <span>Health &amp; Raw Fixes</span>
      <span id="tab-health-badge" class="tab-badge hidden"></span>
    </button>
    <button type="button" class="tab-btn" data-tab="camera" onclick="switchTab('camera')">
      <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
      <span>Camera &amp; AI Preview</span>
    </button>
    <button type="button" class="tab-btn" data-tab="database" onclick="switchTab('database')">
      <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
      <span>Database Tables</span>
    </button>
    <button type="button" class="tab-btn" data-tab="updates" onclick="switchTab('updates')">
      <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
      <span>Updates &amp; Backups</span>
      <span id="tab-update-badge" class="tab-badge hidden">NEW</span>
    </button>
    <button type="button" class="tab-btn" data-tab="config" onclick="switchTab('config')">
      <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      <span>Configuration</span>
    </button>
    <button type="button" class="tab-btn" data-tab="logs" onclick="switchTab('logs')">
      <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
      <span>Live Logs</span>
    </button>
  </nav>

  <!-- TAB 1: HEALTH & RAW FIXES -->
  <section id="tab-health">
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">
            <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
          </span>
          Diagnostic Checklist
        </h3>
        <span style="font-size:12px;color:var(--muted)">Updated automatically every 6 seconds</span>
      </div>
      <div id="checks-grid" class="checks-grid"></div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            <span class="card-icon">
              <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </span>
            Targeted Raw Technician Fixes
          </h3>
        </div>
        <p style="margin:0 0 14px;font-size:13px;color:var(--muted)">
          Execute individual low-level system repairs or run them directly via SSH without the UI using <code>sudo milo fix</code>.
        </p>
        <div class="btn-row" style="margin-bottom:16px">
          <button type="button" class="btn btn-primary" onclick="act('fix_mqtt')">
            Fix MQTT &amp; Web App Link
          </button>
          <button type="button" class="btn" onclick="act('fix_hailo')">
            Fix Hailo &amp; Vision Links
          </button>
          <button type="button" class="btn" onclick="act('fix_db')">
            Repair &amp; Vacuum Database
          </button>
          <button type="button" class="btn" onclick="askConfirm('fix_reinstall', 'Run Full Local Repair Install?', 'This re-runs install.sh --repair using the local release files in /opt/milo/current.', false)">
            Full Local Re-Install
          </button>
        </div>
        <pre class="log-viewer" style="font-size:11px;padding:10px 12px"># Headless / SSH Raw Fix Commands (without Web UI):
sudo milo fix all        # Repair MQTT, Hailo, permissions &amp; restart
sudo milo fix mqtt       # Rewrite Mosquitto config &amp; browser password
sudo milo fix hailo      # Link hailo_apps into /opt/milo/venv
sudo milo fix db         # Checkpoint WAL, integrity check &amp; vacuum DB
milo db                  # View all database tables &amp; rows in terminal
sudo milo camera         # Run interactive camera preview on Pi desktop</pre>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            <span class="card-icon">
              <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" x2="12" y1="2" y2="12"/></svg>
            </span>
            Service &amp; Hardware Controls
          </h3>
        </div>
        <p style="margin:0 0 14px;font-size:13px;color:var(--muted)">
          Manage the systemd services for the MILO application, local MQTT broker, and Raspberry Pi power state.
        </p>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" onclick="act('restart_app')">
            <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
            Restart MILO Service
          </button>
          <button type="button" class="btn" onclick="act('restart_broker')">
            Restart MQTT Broker
          </button>
          <button type="button" class="btn" onclick="act('start_app')">
            Start App
          </button>
          <button type="button" class="btn" onclick="act('stop_app')">
            Stop App
          </button>
          <button type="button" class="btn btn-danger" onclick="askConfirm('reboot', 'Reboot Raspberry Pi?', 'The machine will go offline for ~45 seconds while it restarts.', true)">
            Reboot Machine
          </button>
        </div>
      </div>
    </div>
  </section>

  <!-- TAB 2: CAMERA & AI PREVIEW -->
  <section id="tab-camera" class="hidden">
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">
            <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
          </span>
          Live Camera View &amp; AI Predictions
        </h3>
        <div class="btn-row">
          <span id="cam-wake-pill" class="pill warn">Idle (Waiting for RFID)</span>
          <button type="button" class="btn btn-primary" onclick="act('wake_detector')">
            Simulate RFID Scan (Wake Detector)
          </button>
          <button type="button" class="btn" onclick="act('capture_still')">
            Capture Test Still
          </button>
        </div>
      </div>

      <div class="two-col">
        <div class="cam-stage">
          <img id="cam-img" class="hidden" alt="Live camera preview with AI bounding boxes">
          <div id="cam-empty" style="padding:28px;text-align:center;color:#94a3b8;font-size:13px">
            No live camera frame captured yet.<br>
            Ensure the Raspberry Pi camera ribbon is seated and click <strong>Capture Test Still</strong> or <strong>Restart MILO Service</strong>.
          </div>
        </div>

        <div>
          <h4 style="margin:0 0 10px;font-size:14px;font-weight:800">Real-Time Detections</h4>
          <div id="cam-dets" style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
            <div class="backup-row"><span style="color:var(--muted)">Waiting for detections…</span></div>
          </div>

          <h4 style="margin:0 0 8px;font-size:14px;font-weight:800">Desktop HDMI Window</h4>
          <p style="margin:0;font-size:13px;color:var(--muted)">
            <code>milo-detect.py</code> automatically attaches to your Raspberry Pi desktop display (<code>DISPLAY=:0</code> / <code>wayland-0</code>) and passes <code>--input rpi</code> so the native GStreamer preview window opens directly on the Pi monitor. You can also run <code>sudo milo camera</code> in a terminal on the Pi.
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- TAB 3: DATABASE EXPLORER & RAW SQL -->
  <section id="tab-database" class="hidden">
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">
            <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
          </span>
          Database Table Explorer
        </h3>
        <div class="btn-row">
          <input id="db-search" type="search" placeholder="Filter rows…" oninput="filterDbRows()" style="width:200px;padding:7px 12px">
          <button type="button" class="btn" onclick="loadDbTables()">Refresh Tables</button>
        </div>
      </div>

      <div id="db-table-pills" class="btn-row" style="margin-bottom:14px"></div>

      <div tabindex="0" role="region" aria-labelledby="db-table-caption" class="table-wrapper">
        <table>
          <caption id="db-table-caption">Select a table above</caption>
          <thead id="db-thead"></thead>
          <tbody id="db-tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">
            <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
          </span>
          Raw SQL Query &amp; Fix Console
        </h3>
        <div class="btn-row">
          <button type="button" class="btn" onclick="setSqlPreset('SELECT code, name, department, status, account_type FROM users;')">Users</button>
          <button type="button" class="btn" onclick="setSqlPreset('SELECT id, user_code, material, points, machine_id, datetime(CAST(timestamp AS INTEGER), \'unixepoch\', \'localtime\') AS time FROM user_points ORDER BY id DESC LIMIT 50;')">Recent Deposits</button>
          <button type="button" class="btn" onclick="setSqlPreset('SELECT * FROM bins;')">Bins</button>
          <button type="button" class="btn" onclick="setSqlPreset('UPDATE bins SET count = 0, alerted = 0;')">Empty All Bins</button>
          <button type="button" class="btn" onclick="setSqlPreset('PRAGMA integrity_check;')">Integrity Check</button>
        </div>
      </div>
      <form onsubmit="runSqlQuery(event)">
        <textarea id="sql-input" rows="3" style="font-family:ui-monospace,monospace;font-size:13px;margin-bottom:10px" placeholder="SELECT * FROM users LIMIT 50;"></textarea>
        <div class="btn-row" style="justify-content:space-between;align-items:center">
          <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer">
            <input id="sql-backup" type="checkbox" checked>
            Create automatic database backup before any write query
          </label>
          <button type="submit" class="btn btn-primary">Execute SQL</button>
        </div>
      </form>
      <div id="sql-err" style="color:var(--err-text);font-size:13px;font-weight:700;margin-top:10px"></div>
    </div>
  </section>

  <!-- TAB 4: UPDATES & BACKUPS -->
  <section id="tab-updates" class="hidden">
    <div class="two-col">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            <span class="card-icon">
              <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            </span>
            Over-the-Air Software
          </h3>
          <span id="upd-pill" class="pill ok">Up to date</span>
        </div>
        <div id="upd-rows" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" onclick="act('update_now')">Install Latest Release</button>
          <button type="button" class="btn" onclick="act('update_check')">Check Now</button>
          <button type="button" class="btn" onclick="askConfirm('rollback', 'Roll back to previous release?', 'This switches /opt/milo/current back to the previous release and restarts MILO.', false)">Roll Back</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            <span class="card-icon">
              <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
            </span>
            Database Backups
          </h3>
        </div>
        <p style="margin:0 0 14px;font-size:13px;color:var(--muted)">
          Snapshots are stored in <code>/opt/milo/backups</code> and survive software updates and reinstalls.
        </p>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" onclick="act('backup_now')">Create Snapshot Now</button>
          <button type="button" class="btn" onclick="askConfirm('restore_latest', 'Restore newest database backup?', 'The current database will first be saved as pre-restore-*.db before restoring the latest backup.', false)">Restore Newest Snapshot</button>
        </div>
        <div id="backups-list" class="backup-list"></div>
      </div>
    </div>
  </section>

  <!-- TAB 5: CONFIGURATION -->
  <section id="tab-config" class="hidden">
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">
            <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </span>
          Machine &amp; Fleet Configuration
        </h3>
        <span style="font-size:12px;color:var(--muted)">Saved in <code>/opt/milo/data/config.env</code></span>
      </div>

      <form onsubmit="saveConfig(event)">
        <div class="form-grid">
          <div class="field">
            <label for="cfg-id">Machine ID</label>
            <input id="cfg-id" type="text" required placeholder="milo-b8b8f7">
          </div>
          <div class="field">
            <label for="cfg-name">Display Name</label>
            <input id="cfg-name" type="text" required placeholder="MILO Lobby #1">
          </div>
          <div class="field">
            <label for="cfg-env">Environment Theme</label>
            <select id="cfg-env">
              <option value="">Use network default</option>
              <option value="office">Office / Corporate (Indigo)</option>
              <option value="school">School / Campus (Amber)</option>
              <option value="city">City / Public Space (Emerald)</option>
            </select>
          </div>
          <div class="field">
            <label for="cfg-cam">Camera Input Source</label>
            <select id="cfg-cam">
              <option value="rpi">Raspberry Pi CSI Camera (--input rpi)</option>
              <option value="usb">USB Webcam (--input usb)</option>
              <option value="/dev/video0">V4L2 /dev/video0</option>
              <option value="default">Hailo default pipeline</option>
            </select>
          </div>
          <div class="field">
            <label for="cfg-host">MQTT Broker Host</label>
            <input id="cfg-host" type="text" required placeholder="127.0.0.1">
          </div>
          <div class="field">
            <label for="cfg-channel">Update Channel</label>
            <select id="cfg-channel">
              <option value="stable">Stable (GitHub releases, fallback to main)</option>
              <option value="beta">Beta (latest commit on main branch)</option>
            </select>
          </div>
          <div class="field">
            <label for="cfg-auto">Automatic Over-the-Air Updates</label>
            <select id="cfg-auto">
              <option value="1">Enabled (checks twice daily, auto-rollback)</option>
              <option value="0">Disabled (manual updates only)</option>
            </select>
          </div>
          <div class="field">
            <label for="cfg-repo">GitHub Backend Repository</label>
            <input id="cfg-repo" type="text" placeholder="EKOKIBO/MILO-Backend">
          </div>
          <div class="field">
            <label for="cfg-token">GitHub Personal Access Token (Private Repo)</label>
            <input id="cfg-token" type="password" autocomplete="off" placeholder="Leave blank to keep existing token">
            <div id="cfg-token-hint" class="field-hint"></div>
          </div>
          <div class="field">
            <label for="cfg-pin">Technician 6-Digit PIN (Read-only)</label>
            <input id="cfg-pin" type="text" readonly style="font-family:ui-monospace,monospace;font-weight:700">
          </div>
        </div>

        <div class="btn-row" style="margin-top:18px">
          <button type="submit" class="btn btn-primary">
            Save &amp; Apply (Restart Service)
          </button>
        </div>
      </form>
    </div>
  </section>

  <!-- TAB 6: LIVE LOGS -->
  <section id="tab-logs" class="hidden">
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">
            <svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
          </span>
          System &amp; Service Logs
        </h3>
        <div class="btn-row">
          <select id="log-source" onchange="loadLogs()" style="width:auto;padding:8px 12px;font-weight:700">
            <option value="core">MILO Application (milo-core)</option>
            <option value="broker">MQTT Broker (mosquitto)</option>
            <option value="update">OTA Updater (update.log)</option>
            <option value="install">Installer (install.log)</option>
          </select>
          <button type="button" class="btn" onclick="loadLogs()">Refresh</button>
          <button type="button" class="btn" onclick="copyLogs()">Copy Logs</button>
        </div>
      </div>
      <pre id="logbox" class="log-viewer">Select Refresh to load service logs…</pre>
    </div>
  </section>

</main>

<!-- Native Modal Dialog (`dialog`) -->
<dialog id="confirm-dialog" closedby="any" aria-labelledby="confirm-title">
  <div id="confirm-icon" class="dialog-icon">
    <svg class="lucide" style="width:26px;height:26px" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
  </div>
  <h2 id="confirm-title" style="margin:0 0 8px;font-size:18px;font-weight:800;text-align:center">Confirm Action</h2>
  <p id="confirm-desc" style="margin:0 0 22px;font-size:13px;color:var(--muted);text-align:center"></p>
  <form method="dialog" style="display:flex;gap:10px">
    <button type="submit" value="cancel" class="btn" style="flex:1" autofocus>Cancel</button>
    <button type="submit" value="confirm" id="confirm-ok-btn" class="btn btn-primary" style="flex:1">Confirm</button>
  </form>
</dialog>

<div id="toast" class="toast hidden" role="status" aria-live="polite"></div>

<script>
const $ = (s) => document.querySelector(s);
let pollTimer = null;
let camTimer = null;
let cfgLoaded = false;
let activeTab = 'health';
let loginMode = 'admin';
let pendingAction = null;
let currentDbTable = 'users';
let cachedDbRows = [];
let cachedDbCols = [];

const confirmDialog = $('#confirm-dialog');
if (confirmDialog) {
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    confirmDialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, confirmDialog); });
    confirmDialog.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e, confirmDialog)) confirmDialog.close(); });
  }
  confirmDialog.addEventListener('close', () => {
    const choice = confirmDialog.returnValue;
    confirmDialog.returnValue = '';
    if (choice === 'confirm' && pendingAction) {
      const toRun = pendingAction;
      pendingAction = null;
      if (typeof toRun === 'function') toRun();
      else act(toRun);
    } else {
      pendingAction = null;
    }
  });
}

function askConfirm(actionOrFn, title, desc, isDanger) {
  pendingAction = actionOrFn;
  $('#confirm-title').textContent = title;
  $('#confirm-desc').textContent = desc;
  $('#confirm-icon').className = 'dialog-icon' + (isDanger ? ' danger' : '');
  $('#confirm-ok-btn').className = 'btn ' + (isDanger ? 'btn-danger' : 'btn-primary');
  confirmDialog.showModal();
}

function setLoginMode(mode) {
  loginMode = mode;
  $('#lmode-admin').classList.toggle('active', mode === 'admin');
  $('#lmode-pin').classList.toggle('active', mode === 'pin');
  $('#login-admin-fields').classList.toggle('hidden', mode !== 'admin');
  $('#login-pin-fields').classList.toggle('hidden', mode !== 'pin');
}

function currentRenderedDark() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const val = meta ? meta.content : 'light dark';
  if (val === 'dark') return true;
  if (val === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function syncThemeIcons() {
  const isDark = currentRenderedDark();
  $('#icon-sun').classList.toggle('hidden', !isDark);
  $('#icon-moon').classList.toggle('hidden', isDark);
}

function toggleTheme() {
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const targetDark = !currentRenderedDark();
  const targetScheme = targetDark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (targetDark === sysDark) {
    try { localStorage.removeItem('color-scheme'); } catch {}
    if (meta) meta.content = 'light dark';
  } else {
    try { localStorage.setItem('color-scheme', targetScheme); } catch {}
    if (meta) meta.content = targetScheme;
  }
  syncThemeIcons();
}
window.addEventListener('storage', (e) => {
  if (e.key === 'color-scheme') {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = e.newValue ?? 'light dark';
    syncThemeIcons();
  }
});
syncThemeIcons();

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  ['health', 'camera', 'database', 'updates', 'config', 'logs'].forEach((t) => {
    $('#tab-' + t).classList.toggle('hidden', t !== tab);
  });
  clearInterval(camTimer);
  if (tab === 'logs') loadLogs();
  if (tab === 'database') loadDbTables();
  if (tab === 'camera') {
    pollCamera();
    camTimer = setInterval(pollCamera, 1200);
  }
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.add('hidden'), ms);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function checkIconSvg(st) {
  if (st === 'ok') return '<svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  if (st === 'warn') return '<svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  return '<svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>';
}

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: {'Content-Type': 'application/json'}, ...opts });
  if (r.status === 401) { show(false); throw new Error('auth'); }
  return r;
}

function show(authed) {
  $('#login-view').classList.toggle('hidden', authed);
  $('#app-view').classList.toggle('hidden', !authed);
  $('#logout-btn').classList.toggle('hidden', !authed);
  $('#hdr-machine-pill').classList.toggle('hidden', !authed);
  clearInterval(pollTimer);
  clearInterval(camTimer);
  if (authed) {
    refresh();
    pollTimer = setInterval(refresh, 6000);
  }
}

async function login(e) {
  e.preventDefault();
  $('#login-err').textContent = '';
  const payload = loginMode === 'pin'
    ? { pin: $('#pin').value }
    : { username: $('#login-user').value, password: $('#login-pass').value };
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok) {
    $('#pin').value = '';
    $('#login-pass').value = '';
    cfgLoaded = false;
    show(true);
  } else {
    $('#login-err').textContent = d.error || 'Login failed';
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  show(false);
}

function findCheck(checks, prefix) {
  return (checks || []).find((c) => c.id === prefix || c.id.startsWith(prefix));
}

async function refresh() {
  let d;
  try { d = await (await api('/api/status')).json(); } catch { return; }

  const doc = d.doctor || {};
  const checks = doc.checks || [];
  const overall = doc.overall || 'fail';

  if (d.config?.site) {
    $('#hdr-pwa-link').href = d.config.site;
  }

  $('#hdr-machine-text').textContent = `${doc.machine_name || doc.machine_id || 'MILO'} · v${doc.version || '?'}`;

  const hb = $('#hero-banner');
  hb.className = 'hero-banner ' + overall;
  $('#hero-orb').className = 'status-orb ' + overall;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  $('#hero-title').textContent = overall === 'ok'
    ? 'All Systems Operational'
    : overall === 'warn'
      ? `Running with ${warnCount} warning${warnCount === 1 ? '' : 's'}`
      : `${failCount} system check${failCount === 1 ? ' needs' : 's need'} attention`;
  $('#hero-sub').textContent = `Machine ID: ${doc.machine_id || '?'} · Role: ${doc.role || 'both'} · Release: ${doc.version || '?'}`;

  const hBadge = $('#tab-health-badge');
  if (failCount > 0) {
    hBadge.textContent = failCount;
    hBadge.className = 'tab-badge err';
    hBadge.classList.remove('hidden');
  } else {
    hBadge.classList.add('hidden');
  }

  const cApp = findCheck(checks, 'svc_milo-') || { status: 'warn', detail: 'unknown' };
  $('#kpi-app-val').textContent = cApp.status === 'ok' ? 'Running' : 'Stopped';
  $('#kpi-app-det').textContent = cApp.detail || '';
  $('#kpi-app-dot').className = 'check-dot ' + cApp.status;

  const cMosq = findCheck(checks, 'svc_mosquitto') || findCheck(checks, 'mqtt') || { status: 'ok', detail: 'remote' };
  const cAuth = findCheck(checks, 'mqtt');
  const mqttOk = cMosq.status === 'ok' && (!cAuth || cAuth.status === 'ok');
  $('#kpi-mqtt-val').textContent = mqttOk ? 'Connected' : 'Issue Detected';
  $('#kpi-mqtt-det').textContent = (cAuth && cAuth.status !== 'ok') ? cAuth.detail : (cMosq.detail || '');
  $('#kpi-mqtt-dot').className = 'check-dot ' + (mqttOk ? 'ok' : 'fail');

  const cHailo = findCheck(checks, 'hailo');
  const cPy = findCheck(checks, 'hailopy');
  const hwSt = (!cHailo || cHailo.status === 'ok') && (!cPy || cPy.status === 'ok') ? 'ok' : (cHailo && cHailo.status === 'fail' ? 'fail' : 'warn');
  $('#kpi-hw-val').textContent = cHailo ? cHailo.detail : 'Core-only';
  $('#kpi-hw-det').textContent = cPy ? cPy.detail : 'No local camera';
  $('#kpi-hw-dot').className = 'check-dot ' + hwSt;

  const cDb = findCheck(checks, 'db') || { status: 'ok', detail: '—' };
  const cTemp = findCheck(checks, 'temp');
  $('#kpi-db-val').textContent = cDb.detail || '—';
  $('#kpi-db-det').textContent = cTemp ? `CPU Temp: ${cTemp.detail}` : 'Storage healthy';
  $('#kpi-db-dot').className = 'check-dot ' + cDb.status;

  $('#checks-grid').innerHTML = checks.map((c) => `
    <div class="check-item ${esc(c.status)}">
      <div class="check-left">
        <span class="check-dot ${esc(c.status)}">${checkIconSvg(c.status)}</span>
        <span class="check-label">${esc(c.label)}</span>
      </div>
      <span class="check-detail">${esc(c.detail)}</span>
    </div>
  `).join('');

  const u = d.update || {};
  const upPill = $('#upd-pill');
  upPill.className = 'pill ' + (u.update_available ? 'warn' : (u.status === 'ok' ? 'ok' : 'warn'));
  upPill.textContent = u.update_available ? `Update available: ${u.available_name || ''}` : (u.status === 'ok' ? 'Up to date' : 'Offline / Unchecked');
  $('#tab-update-badge').classList.toggle('hidden', !u.update_available);

  $('#upd-rows').innerHTML = [
    ['Active Release', doc.version || u.current_version || '?'],
    ['Upstream Available', u.available_name || u.available_ref || '—'],
    ['Update Channel', `${u.channel || d.config?.channel || 'stable'} (${u.repo || d.config?.repo || 'EKOKIBO/MILO-Backend'})`],
    ['Automatic Checks', u.auto_update ? 'Enabled (every 12 hours)' : 'Disabled'],
  ].map(([k, v]) => `
    <div class="backup-row">
      <span style="font-weight:700">${esc(k)}</span>
      <span style="color:var(--muted)">${esc(v)}</span>
    </div>
  `).join('');

  const bks = d.backups || [];
  $('#backups-list').innerHTML = bks.length
    ? bks.map((b) => `
        <div class="backup-row">
          <span class="backup-name">${esc(b.name)}</span>
          <span style="color:var(--muted);white-space:nowrap">${(b.size / 1024).toFixed(0)} KB · ${new Date(b.mtime * 1000).toLocaleString()}</span>
        </div>
      `).join('')
    : '<p style="font-size:13px;color:var(--muted);margin:8px 0 0">No database backups created yet.</p>';

  if (!cfgLoaded && d.config) {
    $('#cfg-id').value = d.config.machine_id || '';
    $('#cfg-name').value = d.config.machine_name || '';
    $('#cfg-env').value = d.config.machine_env || '';
    $('#cfg-cam').value = d.config.camera_input || 'rpi';
    $('#cfg-host').value = d.config.mqtt_host || '127.0.0.1';
    $('#cfg-channel').value = d.config.channel || 'stable';
    $('#cfg-auto').value = d.config.auto_update ? '1' : '0';
    $('#cfg-repo').value = d.config.repo || 'EKOKIBO/MILO-Backend';
    $('#cfg-pin').value = d.config.ui_pin || '';
    $('#cfg-token-hint').textContent = d.config.has_github_token
      ? '✓ A GitHub token is currently saved in config.env. Leave blank to keep it.'
      : 'Optional: required only if your GitHub repository is Private.';
    cfgLoaded = true;
  }

  const j = d.job || {};
  const jc = $('#job-card');
  if (j.running || (j.finished_at && (d.now - j.finished_at) < 120)) {
    jc.classList.remove('hidden');
    $('#job-spin').classList.toggle('hidden', !j.running);
    $('#job-title').textContent = j.running ? j.name : `${j.name} — ${j.ok ? 'Completed' : 'Finished with warnings/errors'}`;
    const jb = $('#job-badge');
    jb.className = 'pill ' + (j.running ? 'warn' : (j.ok ? 'ok' : 'fail'));
    jb.textContent = j.running ? 'Running' : (j.ok ? 'Success' : 'Failed');
    $('#job-out').textContent = j.output || (j.running ? 'Working…' : 'Done.');
  } else {
    jc.classList.add('hidden');
  }
}

async function pollCamera() {
  try {
    const st = await (await api('/api/camera/state')).json();
    const wp = $('#cam-wake-pill');
    if (st.awake) {
      wp.className = 'pill ok';
      wp.textContent = `Awake — Scanning for User ${st.user_code || '?'}`;
    } else {
      wp.className = 'pill warn';
      wp.textContent = 'Idle (Waiting for RFID or Simulate button)';
    }
    if (st.has_frame) {
      const img = $('#cam-img');
      img.src = '/api/camera/frame.jpg?t=' + Date.now();
      img.classList.remove('hidden');
      $('#cam-empty').classList.add('hidden');
    }
    const dets = st.detections || [];
    $('#cam-dets').innerHTML = dets.length
      ? dets.map((d) => `
          <div class="backup-row">
            <span style="font-weight:800;text-transform:capitalize">${esc(d.label)}</span>
            <span class="pill ok">${Math.round((d.confidence || 0) * 100)}% confidence</span>
          </div>
        `).join('')
      : `<div class="backup-row"><span style="color:var(--muted)">No objects detected in current frame${st.frame_age_sec !== null ? ` (frame age: ${st.frame_age_sec}s)` : ''}</span></div>`;
  } catch {}
}

async function loadDbTables() {
  try {
    const d = await (await api('/api/db/tables')).json();
    const tables = d.tables || [];
    $('#db-table-pills').innerHTML = tables.map((t) => `
      <button type="button" class="btn ${t.name === currentDbTable ? 'btn-primary' : ''}" onclick="selectDbTable('${esc(t.name)}')">
        ${esc(t.name)} <span style="opacity:0.75;font-size:11px">(${t.count})</span>
      </button>
    `).join('');
    if (tables.length) {
      if (!tables.some((t) => t.name === currentDbTable)) currentDbTable = tables[0].name;
      await selectDbTable(currentDbTable);
    }
  } catch {}
}

async function selectDbTable(name) {
  currentDbTable = name;
  document.querySelectorAll('#db-table-pills .btn').forEach((b) => {
    b.classList.toggle('btn-primary', b.textContent.trim().startsWith(name + ' '));
  });
  const d = await (await api('/api/db/table?name=' + encodeURIComponent(name))).json();
  if (d.error) {
    $('#db-table-caption').textContent = `${name} — ${d.error}`;
    $('#db-thead').innerHTML = '';
    $('#db-tbody').innerHTML = '';
    return;
  }
  cachedDbCols = d.columns || [];
  cachedDbRows = d.rows || [];
  renderDbTable(name, cachedDbCols, cachedDbRows, true);
}

function renderDbTable(title, cols, rows, allowDelete) {
  $('#db-table-caption').textContent = `${title} (${rows.length} rows shown)`;
  $('#db-thead').innerHTML = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}${allowDelete ? '<th>Action</th>' : ''}</tr>`;
  if (!rows.length) {
    $('#db-tbody').innerHTML = `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:var(--muted);padding:20px">Table is empty</td></tr>`;
    return;
  }
  $('#db-tbody').innerHTML = rows.map((r) => {
    const rowid = r[0];
    const cells = r.map((val, idx) => idx === 0
      ? `<th>${esc(val)}</th>`
      : `<td data-label="${esc(cols[idx] || '')}" title="${esc(val)}">${esc(val)}</td>`
    ).join('');
    const delBtn = allowDelete
      ? `<td data-label="Action"><button type="button" class="btn btn-danger" style="padding:4px 8px;font-size:11px" onclick="deleteDbRow('${esc(currentDbTable)}', ${Number(rowid)})">Delete</button></td>`
      : '';
    return `<tr>${cells}${delBtn}</tr>`;
  }).join('');
}

function filterDbRows() {
  const q = ($('#db-search').value || '').toLowerCase().trim();
  if (!q) {
    renderDbTable(currentDbTable, cachedDbCols, cachedDbRows, true);
    return;
  }
  const filtered = cachedDbRows.filter((r) => r.some((cell) => String(cell).toLowerCase().includes(q)));
  renderDbTable(currentDbTable, cachedDbCols, filtered, true);
}

function deleteDbRow(table, rowid) {
  askConfirm(async () => {
    const r = await api('/api/db/delete_row', {
      method: 'POST',
      body: JSON.stringify({ table, rowid }),
    });
    if (r.ok) {
      toast(`Deleted row #${rowid} from ${table}`);
      loadDbTables();
    } else {
      toast('Could not delete row');
    }
  }, `Delete row #${rowid} from ${table}?`, 'This row will be permanently removed from the SQLite database.', true);
}

function setSqlPreset(q) {
  $('#sql-input').value = q;
}

async function runSqlQuery(e) {
  e.preventDefault();
  $('#sql-err').textContent = '';
  const sql = $('#sql-input').value.trim();
  if (!sql) return;
  const r = await api('/api/db/query', {
    method: 'POST',
    body: JSON.stringify({ sql, backup_first: $('#sql-backup').checked }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) {
    $('#sql-err').textContent = d.error || 'SQL execution failed';
    return;
  }
  toast('SQL query executed');
  renderDbTable('SQL Query Result', d.columns || [], d.rows || [], false);
}

async function act(name) {
  const r = await api('/api/action', { method: 'POST', body: JSON.stringify({ action: name }) });
  const d = await r.json().catch(() => ({}));
  toast(r.ok ? (d.message && d.message !== 'started' ? d.message : `Started: ${name.replace(/_/g, ' ')}`) : (d.message || d.error || 'Could not start task'));
  setTimeout(refresh, 500);
  if (activeTab === 'camera') setTimeout(pollCamera, 600);
}

async function saveConfig(e) {
  e.preventDefault();
  const body = {
    machine_id: $('#cfg-id').value,
    machine_name: $('#cfg-name').value,
    machine_env: $('#cfg-env').value,
    camera_input: $('#cfg-cam').value,
    mqtt_host: $('#cfg-host').value,
    channel: $('#cfg-channel').value,
    auto_update: $('#cfg-auto').value === '1',
    repo: $('#cfg-repo').value,
    github_token: $('#cfg-token').value,
    apply_restart: true,
  };
  const r = await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (r.ok) {
    $('#cfg-token').value = '';
    cfgLoaded = false;
    toast('Configuration saved & restarting MILO service…', 4500);
    setTimeout(refresh, 800);
  } else {
    toast(d.error || 'Could not save configuration', 4500);
  }
}

async function loadLogs() {
  const lb = $('#logbox');
  const src = $('#log-source').value || 'core';
  lb.textContent = 'Loading logs…';
  lb.textContent = await (await api('/api/logs?source=' + encodeURIComponent(src))).text();
  lb.scrollTop = lb.scrollHeight;
}

function copyLogs() {
  const txt = $('#logbox').textContent || '';
  navigator.clipboard.writeText(txt).then(() => toast('Logs copied to clipboard')).catch(() => {});
}

fetch('/api/session').then((r) => r.json()).then((d) => {
  if (d.site) $('#hdr-pwa-link').href = d.site;
  show(d.authed);
}).catch(() => show(false));
</script>
</body></html>
"""


def main():
    try:
        os.chdir(safe_cwd())
    except OSError:
        pass
    cfg = read_config()
    if not cfg.get('MILO_UI_PIN'):
        print('[WARN] No MILO_UI_PIN in config.env — use Admin username/password to log in.')
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    srv.daemon_threads = True
    print(f'[MILO] Config & Repair UI on http://0.0.0.0:{PORT} (machine {cfg.get("MILO_MACHINE_ID", "?")})')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == '__main__':
    main()
