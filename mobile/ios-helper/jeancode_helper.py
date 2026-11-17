#!/usr/bin/env python3
"""Ayudante del mini agente de JeanCode para iPhone con jailbreak.

La app de JeanCode no puede ejecutar comandos ni leer fuera de su caja de arena; este servicio, que corre en el propio
iPhone (como el usuario `mobile`, o como root si lo eliges), sí. Escucha SOLO en 127.0.0.1 y exige un token secreto
que se genera la primera vez (lo pegas en la app: Móvil → Ayudante).

    POST /status                         → { "ok": true, "user": …, "system": … }
    POST /exec   { cmd, timeout (ms) }   → { "code", "out", "err" }
    POST /read   { path, maxBytes }      → { "b64" }
    POST /write  { path, b64 }           → { "ok": true }

Cabecera obligatoria: Authorization: Bearer <token>. Solo la biblioteca estándar de Python 3 (python3 de Procursus).
"""
import base64
import hmac
import json
import os
import secrets
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = '127.0.0.1'
PORT = int(os.environ.get('JEANCODE_HELPER_PORT', '47322'))
TOKEN_FILE = os.environ.get('JEANCODE_HELPER_TOKEN_FILE', os.path.expanduser('~/Library/JeanCode/helper-token'))
MAX_BODY = 32 * 1024 * 1024
MAX_OUT = 1024 * 1024
# JEANCODE_HELPER_SHELL solo para probarlo fuera del iPhone (p. ej. con bash en un PC)
SHELL = os.environ.get('JEANCODE_HELPER_SHELL') or ('/var/jb/bin/sh' if os.path.exists('/var/jb/bin/sh') else '/bin/sh')


def load_token():
    """El token se crea una vez (32 bytes aleatorios) con permisos 600."""
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, encoding='utf-8') as f:
            token = f.read().strip()
        if len(token) >= 32:
            return token
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    token = secrets.token_urlsafe(32)
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(token)
    return token


TOKEN = None


def run(cmd, timeout_ms):
    timeout = max(1, min(int(timeout_ms or 120000), 600000)) / 1000
    try:
        # el comando lo decide el agente (con tu permiso en la app): se pasa entero a sh -c, como un terminal
        p = subprocess.run([SHELL, '-c', cmd], capture_output=True, timeout=timeout,
                           env={**os.environ, 'PATH': '/var/jb/usr/bin:/var/jb/bin:/usr/bin:/bin:/usr/sbin:/sbin:' + os.environ.get('PATH', '')})
        return {'code': p.returncode, 'out': p.stdout[:MAX_OUT].decode('utf-8', 'replace'), 'err': p.stderr[:MAX_OUT].decode('utf-8', 'replace')}
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'')[:MAX_OUT].decode('utf-8', 'replace')
        return {'code': -1, 'out': out, 'err': f'tiempo agotado ({int(timeout)} s)'}


class Handler(BaseHTTPRequestHandler):
    server_version = 'jeancode-helper/1'

    def log_message(self, *args):  # sin registro: los comandos pueden llevar datos personales
        pass

    def reply(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(405, {'error': 'usa POST'})

    def do_POST(self):
        # solo procesos de este mismo teléfono, con el token, y sin peticiones de páginas web ajenas
        auth = self.headers.get('Authorization', '')
        if not hmac.compare_digest(auth.encode(), f'Bearer {TOKEN}'.encode()):
            return self.reply(401, {'error': 'token incorrecto'})
        origin = self.headers.get('Origin')
        if origin and origin not in ('capacitor://localhost', 'http://localhost', 'https://localhost', 'ionic://localhost'):
            return self.reply(403, {'error': 'origen no permitido'})
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            return self.reply(413, {'error': 'petición demasiado grande'})
        try:
            data = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return self.reply(400, {'error': 'JSON no válido'})
        try:
            if self.path == '/status':
                return self.reply(200, {'ok': True, 'user': run('id', 5000)['out'].strip(), 'system': run('uname -srm; sw_vers 2>/dev/null', 5000)['out'].strip()})
            if self.path == '/exec':
                return self.reply(200, run(str(data.get('cmd', '')), data.get('timeout')))
            if self.path == '/read':
                path = str(data.get('path', ''))
                limit = min(int(data.get('maxBytes') or MAX_BODY), MAX_BODY)
                if os.path.getsize(path) > limit:
                    return self.reply(200, {'error': f'archivo de más de {limit // 1048576} MB'})
                with open(path, 'rb') as f:
                    return self.reply(200, {'b64': base64.b64encode(f.read()).decode()})
            if self.path == '/write':
                path = str(data.get('path', ''))
                raw = base64.b64decode(str(data.get('b64', '')), validate=True)
                os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
                tmp = f'{path}.jeancode-tmp'
                with open(tmp, 'wb') as f:
                    f.write(raw)
                os.replace(tmp, path)
                return self.reply(200, {'ok': True})
            return self.reply(404, {'error': 'ruta desconocida'})
        except FileNotFoundError:
            return self.reply(200, {'error': 'no existe ese archivo'})
        except (OSError, ValueError) as e:
            return self.reply(200, {'error': str(e)})


def main():
    global TOKEN
    TOKEN = load_token()
    if '--token' in sys.argv:
        print(TOKEN)
        return
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'jeancode-helper escuchando en http://{HOST}:{PORT} (token en {TOKEN_FILE})', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
