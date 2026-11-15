"""Pruebas de JeanCode pygame (CPython).   python -m unittest discover -s pygame/tests

Un servidor falso con el formato de OpenAI responde en streaming; se prueba el
análisis, el puente de PyKernel (kernel <-> puente por un socket, como COM2) y
la ventana real de pygame con el controlador de vídeo "dummy".
"""
import http.server
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ["JEANCODE_HOME"] = tempfile.mkdtemp(prefix="jeancode-test-")

import bridge as host_bridge  # noqa: E402
from jeancode import chat as C  # noqa: E402
from jeancode import net  # noqa: E402

SEEN = []


class FakeAPI(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer test-key":
            return self._json(401, {"error": {"message": "Invalid API key"}})
        self._json(200, {"data": [{"id": "jean-marvel"}, {"id": "jean-grey"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(body)
        if body["model"] == "missing":
            return self._json(404, {"error": {"message": "model not found"}})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for piece in ("Hola", ", ñandú", " ✓"):
            chunk = {"choices": [{"delta": {"content": piece}}]}
            self.wfile.write(("data: %s\n\n" % json.dumps(chunk)).encode())
            self.wfile.flush()
            time.sleep(0.02)
        self.wfile.write(b"data: [DONE]\n\n")

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def start_server():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeAPI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/v1" % srv.server_address[1]


SERVER, URL = start_server()
EP = {"provider": "custom", "url": URL, "key": "test-key", "model": "jean-marvel"}


class Parsing(unittest.TestCase):
    def test_base_url(self):
        self.assertEqual(C.base_url(" https://x.trycloudflare.com/v1/ "), "https://x.trycloudflare.com/v1")
        self.assertEqual(C.base_url("https://a/v1/chat/completions"), "https://a/v1")

    def test_sse(self):
        self.assertEqual(C.sse_line('data: {"choices":[{"delta":{"content":"hi"}}]}'), ("text", "hi"))
        self.assertEqual(C.sse_line('data: {"choices":[{"delta":{"reasoning_content":"mm"}}]}'), ("think", "mm"))
        self.assertEqual(C.sse_line("data: [DONE]"), ("done",))
        self.assertEqual(C.sse_line(": keep-alive"), None)
        self.assertEqual(C.sse_line('data: {"error":{"message":"boom"}}'), ("error", "boom"))

    def test_errors_and_models(self):
        self.assertEqual(C.error_text('{"error":{"message":"bad key"}}'), "bad key")
        self.assertEqual(C.parse_models('{"data":[{"id":"b"},{"id":"a"},{"id":"a"}]}'), ["a", "b"])
        self.assertIn("Kaggle", C.status_hint(502))

    def test_request_never_sends_empty_messages(self):
        method, url, headers, body = C.chat_request(EP, [{"role": "user", "content": "x"},
                                                         {"role": "assistant", "content": ""}])
        sent = json.loads(body)
        self.assertEqual([m["role"] for m in sent["messages"]], ["system", "user"])
        self.assertTrue(sent["stream"])
        self.assertEqual(headers["Authorization"], "Bearer test-key")

    def test_wrap_and_blocks(self):
        self.assertEqual(C.wrap("uno dos tres", 7), ["uno dos", "tres"])
        self.assertEqual(C.wrap("abcdefghij", 8), ["abcdefgh", "ij"])
        self.assertEqual(C.wrap("a\n\nb", 10), ["a", "", "b"])
        self.assertEqual(C.wrap_code("    return a + b", 10), ["    return", " a + b"])
        self.assertEqual(C.blocks("hola\n```py\nx = 1\n```\nfin"),
                         [(False, "hola"), (True, "x = 1"), (False, "fin")])


def collect(transport, ep, messages):
    status, out = 0, ""
    for kind, value in transport.request(*C.chat_request(ep, messages)):
        if kind == "status":
            status = value
        else:
            ev = C.sse_line(value)
            if ev and ev[0] == "text":
                out += ev[1]
    return status, out


class Direct(unittest.TestCase):
    def test_stream(self):
        self.assertEqual(collect(net.Direct(), EP, [{"role": "user", "content": "hola"}]), (200, "Hola, ñandú ✓"))

    def test_models_and_bad_key(self):
        self.assertEqual(net.fetch(*C.models_request(EP))[0], 200)
        status, text = net.fetch(*C.models_request(dict(EP, key="nope")))
        self.assertEqual((status, C.error_text(text)), (401, "Invalid API key"))


class SocketUart:
    """Hace de COM2: lo que el kernel escribe sale por un socket hacia el puente."""

    def __init__(self, sock):
        self.sock, self.present = sock, True
        sock.setblocking(False)

    def write(self, data):
        self.sock.setblocking(True)
        self.sock.sendall(data)
        self.sock.setblocking(False)

    def read(self):
        try:
            return bytearray(self.sock.recv(4096))
        except BlockingIOError:
            return bytearray()


class PyKernelBridge(unittest.TestCase):
    """El cliente del kernel (net.Bridge) hablando con bridge.py, como por COM2."""

    @classmethod
    def setUpClass(cls):
        kernel_side, host_side = socket.socketpair()
        host = host_bridge.Bridge(host_side.sendall, log=lambda m: None)
        threading.Thread(target=host.serve, args=(host_side.makefile("rb").readline,), daemon=True).start()
        cls.client = net.Bridge(SocketUart(kernel_side))

    def test_ping(self):
        self.assertEqual(self.client.ready(), (True, ""))

    def test_stream_through_bridge(self):
        self.assertEqual(collect(self.client, EP, [{"role": "user", "content": "hola"}]), (200, "Hola, ñandú ✓"))

    def test_http_error_through_bridge(self):
        status, out = collect(self.client, dict(EP, model="missing"), [{"role": "user", "content": "x"}])
        self.assertEqual(status, 404)

    def test_bad_url_is_refused(self):
        with self.assertRaises(OSError):
            list(self.client.request("GET", "file:///etc/passwd", {}, None))


class Window(unittest.TestCase):
    """La app de verdad: escribir, Enter, y la respuesta llega en streaming."""

    def test_type_send_and_receive(self):
        import pygame
        from jeancode import app as A
        a = A.App(size=(800, 600))
        a.ep.update(EP)
        for ch in "hola":
            a.handle(pygame.event.Event(pygame.TEXTINPUT, text=ch))
        a.handle(pygame.event.Event(pygame.KEYDOWN, key=pygame.K_RETURN, mod=0, unicode="\r"))
        end = time.time() + 10
        while a.streaming and time.time() < end:
            time.sleep(0.05)
        a.draw()
        msgs = a.chat["messages"]
        self.assertEqual(msgs[0]["content"], "hola")
        self.assertEqual(msgs[1]["content"], "Hola, ñandú ✓", msgs[1])
        a.save_chat()
        self.assertEqual(a.store.chats()[0]["title"], "hola")
        # ajustes, modelos e historial se dibujan sin errores
        a.open_settings()
        a.draw()
        a.open_models()
        end = time.time() + 10
        while a.models["items"] is None and not a.models["error"] and time.time() < end:
            time.sleep(0.05)
        a.draw()
        self.assertEqual(a.models["items"], ["jean-grey", "jean-marvel"])
        a.open_history()
        a.draw()
        pygame.image.save(a.screen, os.path.join(os.environ["JEANCODE_HOME"], "shot.png"))
        pygame.quit()


if __name__ == "__main__":
    unittest.main()
