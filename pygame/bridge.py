#!/usr/bin/env python3
"""Puente de red de JeanCode para PyKernel.

PyKernel todavía no tiene tarjeta de red: JeanCode envía cada petición por
el segundo puerto serie (COM2) y este programa, en el PC anfitrión, la hace
por HTTPS y devuelve la respuesta línea a línea.

    python bridge.py --connect 127.0.0.1:4555     # QEMU escucha:  -serial tcp:127.0.0.1:4555,server=on,wait=off
    python bridge.py --listen 4555                # QEMU se conecta: -serial tcp:127.0.0.1:4555

PyKernel's tools/run.py lo arranca solo. Protocolo (una línea JSON por mensaje):
  kernel -> puente   {"t":"ping","id":0}  {"t":"req","id":N,"method","url","headers","body"}  {"t":"cancel","id":N}
  puente -> kernel   {"t":"pong"}  {"t":"status","status":200}  {"t":"line","d":"..."}  {"t":"end"}  {"t":"error","d":"..."}
Nunca se escriben en el registro las cabeceras ni el cuerpo (llevan la clave).
"""
import argparse
import json
import os
import socket
import sys
import threading
import time
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jeancode.net import http_lines  # noqa: E402


class Bridge:
    def __init__(self, write, log=None):
        self._write = write
        self.wlock = threading.Lock()
        self.cancelled = set()
        self.log = log or (lambda msg: print("[puente] " + msg, file=sys.stderr, flush=True))

    def send(self, obj):
        data = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
        with self.wlock:
            self._write(data)

    def handle(self, line):
        try:
            msg = json.loads(line)
        except ValueError:
            return
        t, rid = msg.get("t"), msg.get("id")
        if t == "ping":
            self.send({"t": "pong", "id": rid})
        elif t == "cancel":
            self.cancelled.add(rid)
        elif t == "req":
            threading.Thread(target=self.run, args=(msg,), daemon=True).start()

    def run(self, msg):
        rid, url, method = msg["id"], msg.get("url", ""), msg.get("method", "GET")
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            self.send({"t": "error", "id": rid, "d": "URL no válida: debe empezar por https://"})
            return
        self.log("%s %s://%s%s" % (method, parts.scheme, parts.hostname, parts.path))
        try:
            for kind, value in http_lines(method, url, msg.get("headers") or {}, msg.get("body"),
                                          cancelled=lambda: rid in self.cancelled):
                if kind == "status":
                    self.send({"t": "status", "id": rid, "status": value})
                else:
                    self.send({"t": "line", "id": rid, "d": value})
            self.send({"t": "end", "id": rid})
        except Exception as e:                       # noqa: BLE001 (se informa al kernel)
            self.send({"t": "error", "id": rid, "d": str(e) or e.__class__.__name__})
        finally:
            self.cancelled.discard(rid)

    def serve(self, read_line):
        while True:
            line = read_line()
            if not line:
                return
            self.handle(line.decode("utf-8", "replace"))


def connect(addr, wait):
    host, port = addr.rsplit(":", 1)
    end = time.time() + wait
    while True:
        try:
            return socket.create_connection((host, int(port)), timeout=5)
        except OSError:
            if time.time() > end:
                raise
            time.sleep(0.3)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--connect", metavar="HOST:PUERTO", help="conectarse al puerto serie que abre QEMU")
    g.add_argument("--listen", metavar="PUERTO", type=int, help="esperar a que QEMU se conecte")
    ap.add_argument("--wait", type=float, default=60, help="segundos de espera para conectar (por defecto 60)")
    args = ap.parse_args()
    if args.connect:
        sock = connect(args.connect, args.wait)
    else:
        srv = socket.socket()
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", args.listen))
        srv.listen(1)
        sock, _ = srv.accept()
    sock.settimeout(None)
    f = sock.makefile("rb")
    bridge = Bridge(sock.sendall)
    bridge.log("conectado: JeanCode en PyKernel ya tiene red")
    try:
        bridge.serve(f.readline)
    except (OSError, KeyboardInterrupt):
        pass


if __name__ == "__main__":
    main()
