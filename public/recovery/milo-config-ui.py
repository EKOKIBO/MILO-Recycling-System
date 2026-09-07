#!/usr/bin/env python3
"""
MILO Config & Repair UI
=======================
A small web interface served BY THE MACHINE ITSELF, so a technician on the same
network can diagnose, configure, update or restore it without a keyboard, a
monitor or any SSH knowledge:

    http://<pi-ip>:8088     (PIN shown at the end of the install)

Deliberately dependency-free (Python standard library only). If the virtual
environment, the MQTT broker or the application are broken, this page still
loads — that is the entire point of a repair tool.

Every action is a fixed, named operation; nothing from the browser is ever
executed as a shell command.
"""

import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

MILO_ROOT = os.environ.get('MILO_ROOT', '/opt/milo')
CONFIG_FILE = os.path.join(MILO_ROOT, 'data', 'config.env')
PORT = int(os.environ.get('MILO_UI_PORT', '8088'))

SESSION_TTL = 3600          # idle logout after an hour
MAX_ATTEMPTS = 5            # failed PINs per window, per client address
ATTEMPT_WINDOW = 300

_sessions = {}              # token -> last-seen timestamp
_attempts = {}              # ip -> [timestamps]
_lock = threading.Lock()
_job = {'running': False, 'name': '', 'output': '', 'finished_at': 0, 'ok': None}


# --------------------------------------------------------------------------
# Configuration file helpers
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


def run(cmd, timeout=600):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
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
    return local if os.path.exists(local) else name


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


ACTIONS = {
    'restart_app':   lambda: start_job('Restarting the application', ['systemctl', 'restart', main_unit()], 120),
    'stop_app':      lambda: start_job('Stopping the application', ['systemctl', 'stop', main_unit()], 60),
    'start_app':     lambda: start_job('Starting the application', ['systemctl', 'start', main_unit()], 120),
    'restart_broker': lambda: start_job('Restarting the MQTT broker', ['systemctl', 'restart', 'mosquitto'], 60),
    'run_doctor':    lambda: start_job('Running diagnostics', [tool('milo-doctor'), '--heal'], 180),
    'update_check':  lambda: start_job('Checking for updates', [tool('milo-update'), '--check'], 120),
    'update_now':    lambda: start_job('Installing update', [tool('milo-update'), '--force'], 900),
    'rollback':      lambda: start_job('Rolling back', [tool('milo-update'), '--rollback'], 300),
    'backup_now':    lambda: start_job('Backing up the database', [tool('milo-backup'), '--rotate'], 300),
    'restore_latest': lambda: start_job('Restoring the newest backup', [tool('milo-backup'), '--restore-latest'], 300),
    'reboot':        lambda: start_job('Rebooting', ['systemctl', 'reboot'], 30),
}


def gather_status():
    code, out = run([tool('milo-doctor'), '--json'], 90)
    try:
        doctor = json.loads(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        doctor = {'overall': 'fail', 'checks': [
            {'id': 'doctor', 'status': 'fail', 'label': 'Diagnostics', 'detail': 'milo-doctor did not respond'}]}

    try:
        _, uo = run([tool('milo-update'), '--json'], 60)
        update = json.loads(uo.strip().splitlines()[-1])
    except (ValueError, IndexError):
        update = {'status': 'unknown', 'update_available': False}

    cfg = read_config()
    backups = []
    bdir = os.path.join(MILO_ROOT, 'backups')
    try:
        for fn in sorted(os.listdir(bdir), reverse=True)[:8]:
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
            'repo': cfg.get('MILO_REPO', ''),
            'site': cfg.get('MILO_SITE', ''),
        },
        'now': int(time.time()),
    }


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = 'MILO-ConfigUI'

    def log_message(self, fmt, *args):        # keep the journal readable
        pass

    # -- helpers --
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

    # -- routes --
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/index.html'):
            return self._send(200, PAGE, 'text/html; charset=utf-8')
        if path == '/api/session':
            return self._send(200, {'authed': self._authed()})
        if not self._authed():
            return self._send(401, {'error': 'auth'})
        if path == '/api/status':
            return self._send(200, gather_status())
        if path == '/api/logs':
            _, out = run(['journalctl', '-u', main_unit(), '-n', '200', '--no-pager'], 30)
            return self._send(200, out or 'No logs available.', 'text/plain; charset=utf-8')
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
            real = read_config().get('MILO_UI_PIN', '')
            given = str(body.get('pin', ''))
            if real and secrets.compare_digest(given, real):
                tok = secrets.token_urlsafe(24)
                with _lock:
                    _sessions[tok] = time.time()
                    _attempts.pop(ip, None)
                return self._send(200, {'ok': True}, extra={
                    'Set-Cookie': f'milo_sid={tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}'})
            with _lock:
                _attempts.setdefault(ip, []).append(now)
            return self._send(403, {'error': 'Incorrect PIN'})

        if not self._authed():
            return self._send(401, {'error': 'auth'})

        if path == '/api/action':
            name = str(body.get('action', ''))
            fn = ACTIONS.get(name)
            if not fn:
                return self._send(400, {'error': 'Unknown action'})
            okay, msg = fn()
            return self._send(200 if okay else 409, {'ok': okay, 'message': msg})

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
            if not updates:
                return self._send(400, {'error': 'Nothing valid to save'})
            if not write_config(updates):
                return self._send(500, {'error': 'Could not write the configuration file'})
            return self._send(200, {'ok': True, 'saved': list(updates.keys())})

        if path == '/api/logout':
            cookie = self.headers.get('Cookie', '')
            m = re.search(r'milo_sid=([A-Za-z0-9_-]+)', cookie)
            if m:
                with _lock:
                    _sessions.pop(m.group(1), None)
            return self._send(200, {'ok': True}, extra={'Set-Cookie': 'milo_sid=; Path=/; Max-Age=0'})

        return self._send(404, {'error': 'not found'})


# --------------------------------------------------------------------------
# The page — same visual language as the MILO web app (slate + indigo cards,
# rounded corners, automatic dark mode).
# --------------------------------------------------------------------------
PAGE = r"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>MILO · Repair & Configure</title>
<style>
  :root{
    --bg:#f1f5f9; --card:#ffffff; --line:#e2e8f0; --text:#1e293b; --muted:#64748b;
    --accent:#4f46e5; --accent-soft:#eef2ff; --accent-text:#4338ca;
    --ok:#059669; --ok-soft:#ecfdf5; --warn:#d97706; --warn-soft:#fffbeb;
    --err:#e11d48; --err-soft:#fff1f2; --radius:0.75rem;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#0f172a; --card:#1e293b; --line:#334155; --text:#f1f5f9; --muted:#94a3b8;
      --accent:#6366f1; --accent-soft:#312e81; --accent-text:#c7d2fe;
      --ok:#34d399; --ok-soft:#064e3b; --warn:#fbbf24; --warn-soft:#78350f;
      --err:#fb7185; --err-soft:#881337;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       -webkit-font-smoothing:antialiased;line-height:1.5}
  .wrap{max-width:940px;margin:0 auto;padding:1rem 1rem 4rem}
  header{position:sticky;top:0;z-index:10;background:var(--card);border-bottom:1px solid var(--line);
         padding:.75rem 1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:.6rem}
  .logo{width:38px;height:38px;border-radius:.6rem;background:linear-gradient(135deg,#4f46e5,#0ea5e9);
        display:grid;place-items:center;color:#fff;font-weight:900;font-size:1rem;letter-spacing:-.5px}
  h1{font-size:1.1rem;margin:0;font-weight:900;letter-spacing:-.02em}
  .sub{font-size:.62rem;text-transform:uppercase;letter-spacing:.12em;color:var(--accent-text);font-weight:800}
  .spacer{flex:1}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
        padding:1.25rem;margin-top:1rem;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .card h2{font-size:1rem;margin:0 0 .9rem;display:flex;align-items:center;gap:.5rem;font-weight:800}
  .row{display:flex;align-items:center;gap:.75rem;padding:.6rem 0;border-bottom:1px solid var(--line)}
  .row:last-child{border-bottom:0}
  .row .label{font-weight:600;flex:1;min-width:0}
  .row .detail{color:var(--muted);font-size:.8rem;text-align:right;word-break:break-word}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .dot.ok{background:var(--ok)} .dot.warn{background:var(--warn)} .dot.fail{background:var(--err)}
  .pill{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .7rem;border-radius:999px;
        font-size:.75rem;font-weight:800}
  .pill.ok{background:var(--ok-soft);color:var(--ok)}
  .pill.warn{background:var(--warn-soft);color:var(--warn)}
  .pill.fail{background:var(--err-soft);color:var(--err)}
  button{font:inherit;font-weight:700;border:0;border-radius:.55rem;padding:.6rem 1rem;cursor:pointer;
         background:var(--accent);color:#fff;transition:filter .15s}
  button:hover:not(:disabled){filter:brightness(1.1)}
  button:disabled{opacity:.5;cursor:not-allowed}
  button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
  button.danger{background:var(--err)}
  button.ok{background:var(--ok)}
  .btns{display:flex;flex-wrap:wrap;gap:.5rem}
  input,select{font:inherit;width:100%;padding:.6rem .7rem;border-radius:.55rem;border:1px solid var(--line);
               background:var(--bg);color:var(--text)}
  label{display:block;font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:.3rem;
        text-transform:uppercase;letter-spacing:.05em}
  .grid{display:grid;gap:.9rem;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
  .muted{color:var(--muted);font-size:.82rem}
  pre{background:var(--bg);border:1px solid var(--line);border-radius:.55rem;padding:.8rem;
      overflow:auto;max-height:340px;font-size:.74rem;white-space:pre-wrap;word-break:break-word;margin:0}
  .center{min-height:100vh;display:grid;place-items:center;padding:1rem}
  .login{width:100%;max-width:340px;text-align:center}
  .login .logo{margin:0 auto 1rem;width:56px;height:56px;font-size:1.4rem;border-radius:1rem}
  .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:1.5rem;z-index:50;
         background:var(--card);border:1px solid var(--line);border-radius:.7rem;padding:.7rem 1.1rem;
         box-shadow:0 8px 24px rgba(0,0,0,.18);font-weight:700;font-size:.86rem;max-width:90vw}
  .spin{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;
        border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
  @keyframes sp{to{transform:rotate(360deg)}}
  .hidden{display:none!important}
  @media (max-width:560px){ .row{align-items:flex-start;flex-wrap:wrap} .row .detail{text-align:left;width:100%} }
</style>
</head><body>

<div id="login" class="center">
  <form class="login card" onsubmit="doLogin(event)">
    <div class="logo">M</div>
    <h1>MILO Repair &amp; Configure</h1>
    <p class="muted" style="margin:.4rem 0 1.2rem">Enter the PIN shown when this machine was installed.</p>
    <input id="pin" type="password" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit PIN"
           style="text-align:center;font-size:1.3rem;letter-spacing:.3em" required>
    <p id="loginErr" class="pill fail hidden" style="margin:.8rem 0 0"></p>
    <button style="width:100%;margin-top:1rem;padding:.8rem">Unlock</button>
    <p class="muted" style="margin-top:1rem;font-size:.72rem">
      Forgot it? On the machine run: <code>sudo milo ui</code>
    </p>
  </form>
</div>

<div id="app" class="hidden">
  <header>
    <div class="brand">
      <div class="logo">M</div>
      <div><h1>MILO</h1><div class="sub">Repair &amp; Configure</div></div>
    </div>
    <div class="spacer"></div>
    <span id="overallPill" class="pill warn">checking…</span>
    <button class="ghost" onclick="logout()">Log out</button>
  </header>

  <div class="wrap">
    <div class="card">
      <h2>🩺 Machine health</h2>
      <div id="ident" class="muted" style="margin-bottom:.6rem"></div>
      <div id="checks"></div>
      <div class="btns" style="margin-top:1rem">
        <button onclick="act('run_doctor','Run diagnostics and auto-fix?')">Run diagnostics &amp; fix</button>
        <button class="ghost" onclick="act('restart_app','Restart the MILO application?')">Restart app</button>
        <button class="ghost" onclick="act('restart_broker','Restart the MQTT broker?')">Restart broker</button>
        <button class="ghost" onclick="loadLogs()">View logs</button>
      </div>
      <pre id="logbox" class="hidden" style="margin-top:.9rem"></pre>
    </div>

    <div class="card">
      <h2>⬆️ Software &amp; updates</h2>
      <div id="updateBox"></div>
      <div class="btns" style="margin-top:1rem">
        <button onclick="act('update_check')">Check now</button>
        <button class="ok" onclick="act('update_now','Download and install the latest version? The machine restarts automatically and rolls back if anything fails.')">Install update</button>
        <button class="ghost" onclick="act('rollback','Go back to the previous version?')">Roll back</button>
      </div>
    </div>

    <div class="card">
      <h2>💾 Backups</h2>
      <p class="muted">Snapshots are taken daily and before every update. Restoring stops the app briefly.</p>
      <div id="backups" style="margin-top:.6rem"></div>
      <div class="btns" style="margin-top:1rem">
        <button onclick="act('backup_now')">Back up now</button>
        <button class="danger" onclick="act('restore_latest','Restore the NEWEST backup? Data added since that snapshot will be lost.')">Restore newest</button>
      </div>
    </div>

    <div class="card">
      <h2>⚙️ Configuration</h2>
      <div class="grid">
        <div><label for="cid">Machine ID</label><input id="cid" placeholder="school-1"></div>
        <div><label for="cname">Display name</label><input id="cname" placeholder="MILO School"></div>
        <div><label for="cenv">Environment (theme)</label>
          <select id="cenv"><option value="">Network default</option><option value="office">Office</option>
          <option value="school">School</option><option value="city">City</option></select></div>
        <div><label for="chost">Broker host</label><input id="chost" placeholder="127.0.0.1"></div>
        <div><label for="cchan">Update channel</label>
          <select id="cchan"><option value="stable">Stable</option><option value="beta">Beta</option></select></div>
        <div><label for="cauto">Automatic updates</label>
          <select id="cauto"><option value="1">Enabled</option><option value="0">Disabled</option></select></div>
      </div>
      <div class="btns" style="margin-top:1rem">
        <button onclick="saveConfig()">Save configuration</button>
        <span class="muted" style="align-self:center">Restart the app to apply.</span>
      </div>
    </div>

    <div class="card">
      <h2>🔌 Power</h2>
      <div class="btns">
        <button class="danger" onclick="act('reboot','Reboot this machine now?')">Reboot machine</button>
      </div>
      <p class="muted" style="margin-top:.7rem">A reboot is needed after installing the AI HAT+ for the first time.</p>
    </div>

    <p class="muted" style="text-align:center;margin-top:1.5rem;font-size:.75rem">
      MILO Recovery Kit · rebuild any machine with<br>
      <code id="rebuildCmd">curl -fsSL &lt;your-site&gt;/recovery/install.sh | sudo bash</code>
    </p>
  </div>
</div>

<div id="toast" class="toast hidden"></div>

<script>
let timer = null, busy = false;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const toast = (msg, ms = 3500) => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms);
};

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (r.status === 401) { show(false); throw new Error('auth'); }
  return r;
}

function show(authed) {
  document.getElementById('login').classList.toggle('hidden', authed);
  document.getElementById('app').classList.toggle('hidden', !authed);
  if (authed) { refresh(); timer = timer || setInterval(refresh, 5000); }
  else { clearInterval(timer); timer = null; }
}

async function doLogin(e) {
  e.preventDefault();
  const err = document.getElementById('loginErr');
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: document.getElementById('pin').value })
  });
  if (r.ok) { err.classList.add('hidden'); show(true); }
  else { const d = await r.json().catch(() => ({})); err.textContent = d.error || 'Incorrect PIN'; err.classList.remove('hidden'); }
}

async function logout() { await api('/api/logout', { method: 'POST' }); show(false); }

async function refresh() {
  if (busy) return;
  let d;
  try { d = await (await api('/api/status')).json(); } catch { return; }

  const overall = d.doctor.overall || 'warn';
  const pill = document.getElementById('overallPill');
  pill.className = 'pill ' + overall;
  pill.textContent = { ok: '✓ Healthy', warn: '! Warnings', fail: '✗ Needs attention' }[overall] || overall;

  document.getElementById('ident').innerHTML =
    `<b>${esc(d.doctor.machine_name || d.config.machine_id || 'MILO')}</b> · ${esc(d.config.machine_id)} · ` +
    `role ${esc(d.config.role)} · version ${esc(d.doctor.version || '?')}`;

  document.getElementById('checks').innerHTML = (d.doctor.checks || []).map(c =>
    `<div class="row"><span class="dot ${esc(c.status)}"></span>` +
    `<span class="label">${esc(c.label)}</span><span class="detail">${esc(c.detail)}</span></div>`).join('');

  if (d.config.site) {
    document.getElementById('rebuildCmd').textContent =
      `curl -fsSL ${d.config.site}/recovery/install.sh | sudo bash`;
  }

  const u = d.update || {};
  document.getElementById('updateBox').innerHTML =
    `<div class="row"><span class="label">Installed</span><span class="detail">${esc(u.current_version || '?')}</span></div>` +
    `<div class="row"><span class="label">Channel</span><span class="detail">${esc(u.channel || '?')} · ${u.auto_update ? 'automatic' : 'manual'}</span></div>` +
    `<div class="row"><span class="label">Available</span><span class="detail">${
       u.status === 'offline' ? 'offline — cannot check'
       : u.update_available ? '<b style="color:var(--accent-text)">' + esc(u.available_name) + ' ready to install</b>'
       : 'up to date'}</span></div>`;

  document.getElementById('backups').innerHTML = (d.backups || []).length
    ? d.backups.map(b => `<div class="row"><span class="label" style="font-size:.8rem">${esc(b.name)}</span>` +
        `<span class="detail">${(b.size / 1024).toFixed(0)} KB · ${new Date(b.mtime * 1000).toLocaleString()}</span></div>`).join('')
    : '<p class="muted">No backups yet.</p>';

  if (!document.activeElement || !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) {
    document.getElementById('cid').value = d.config.machine_id || '';
    document.getElementById('cname').value = d.config.machine_name || '';
    document.getElementById('cenv').value = d.config.machine_env || '';
    document.getElementById('chost').value = d.config.mqtt_host || '';
    document.getElementById('cchan').value = d.config.channel || 'stable';
    document.getElementById('cauto').value = d.config.auto_update ? '1' : '0';
  }

  const j = d.job || {};
  document.querySelectorAll('.card button').forEach(b => { b.disabled = !!j.running; });
  if (j.running) toast(j.name + ' …', 4000);
  else if (j.finished_at && j.finished_at !== window._lastJob) {
    window._lastJob = j.finished_at;
    toast((j.ok ? '✓ ' : '✗ ') + (j.name || 'Task') + (j.ok ? ' finished' : ' failed'), 6000);
    if (j.output) { const lb = document.getElementById('logbox'); lb.textContent = j.output; lb.classList.remove('hidden'); }
  }
}

async function act(action, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  busy = true;
  try {
    const r = await api('/api/action', { method: 'POST', body: JSON.stringify({ action }) });
    const d = await r.json();
    toast(d.ok ? 'Started…' : (d.message || 'Could not start'), 4000);
  } catch { toast('Request failed'); }
  busy = false;
  setTimeout(refresh, 800);
}

async function saveConfig() {
  const body = {
    machine_id: document.getElementById('cid').value,
    machine_name: document.getElementById('cname').value,
    machine_env: document.getElementById('cenv').value,
    mqtt_host: document.getElementById('chost').value,
    channel: document.getElementById('cchan').value,
    auto_update: document.getElementById('cauto').value === '1'
  };
  const r = await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
  const d = await r.json();
  toast(r.ok ? '✓ Saved — restart the app to apply' : (d.error || 'Save failed'), 5000);
}

async function loadLogs() {
  const lb = document.getElementById('logbox');
  lb.classList.remove('hidden');
  lb.textContent = 'Loading…';
  lb.textContent = await (await api('/api/logs')).text();
  lb.scrollTop = lb.scrollHeight;
}

fetch('/api/session').then(r => r.json()).then(d => show(d.authed)).catch(() => show(false));
</script>
</body></html>
"""


def main():
    cfg = read_config()
    if not cfg.get('MILO_UI_PIN'):
        print('[WARN] No MILO_UI_PIN in config.env — the UI will refuse every login.')
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
