# Red. Dos caminos con la misma interfaz:
#
#   CPython (Windows, macOS, Linux): HTTPS directo con urllib.
#   PyKernel: el kernel aún no tiene tarjeta de red ni TCP/IP, así que las
#   peticiones salen por el segundo puerto serie (COM2) hacia el puente
#   (bridge.py), que corre en el PC anfitrión y hace la conexión HTTPS.
#
# transport().request(método, url, cabeceras, cuerpo, cancelado) es un
# generador: primero ("status", código), luego ("line", texto) por cada línea
# de la respuesta. Lanza OSError si no hay conexión.
import json
import time

try:
    import _kernel                       # noqa: F401  (solo existe dentro de PyKernel)
    PYKERNEL = True
except ImportError:
    PYKERNEL = False


def sleep_ms(ms):
    if hasattr(time, "sleep_ms"):
        time.sleep_ms(ms)
    else:
        time.sleep(ms / 1000)


def ticks_ms():
    if hasattr(time, "ticks_ms"):
        return time.ticks_ms()
    return int(time.time() * 1000)


# ---------------------------------------------------------------- CPython

def http_lines(method, url, headers, body, cancelled=None, timeout=300):
    import urllib.error
    import urllib.request
    data = body.encode("utf-8") if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        status = resp.status
    except urllib.error.HTTPError as e:
        resp, status = e, e.code
    except urllib.error.URLError as e:
        raise OSError("no se pudo conectar: %s" % (e.reason,))
    try:
        yield ("status", status)
        while not (cancelled and cancelled()):
            raw = resp.readline()
            if not raw:
                break
            yield ("line", raw.decode("utf-8", "replace").rstrip("\r\n"))
    finally:
        resp.close()


class Direct:
    name = "directa"

    def ready(self):
        return True, ""

    def request(self, method, url, headers, body, cancelled=None):
        return http_lines(method, url, headers, body, cancelled)


# ---------------------------------------------------------------- PyKernel

class Uart:
    """Puerto serie 16550 por sondeo (sin interrupciones)."""

    def __init__(self, base=0x2F8):
        from _kernel import inb, outb
        self.inb, self.outb, self.base = inb, outb, base
        outb(base + 7, 0x5A)
        self.present = inb(base + 7) == 0x5A
        if self.present:
            outb(base + 1, 0x00)             # sin interrupciones
            outb(base + 3, 0x80)             # divisor: 115200 baudios
            outb(base + 0, 0x01)
            outb(base + 1, 0x00)
            outb(base + 3, 0x03)             # 8N1
            outb(base + 2, 0xC7)             # FIFO
            outb(base + 4, 0x03)             # DTR + RTS

    def write(self, data):
        inb, outb, lsr, thr = self.inb, self.outb, self.base + 5, self.base
        for b in data:
            while not inb(lsr) & 0x20:
                pass
            outb(thr, b)

    def read(self):
        inb, lsr, rbr = self.inb, self.base + 5, self.base
        out = bytearray()
        while inb(lsr) & 1:
            out.append(inb(rbr))
        return out


class Bridge:
    """Cliente del puente: mensajes JSON, uno por línea, por COM2."""
    name = "puente COM2"

    def __init__(self, uart=None):
        import _thread
        self.uart = uart or Uart()
        self.inbox = {}
        self.wlock = _thread.allocate_lock()
        self.next_id = 1
        self.reading = False
        self.busy = 0
        self.checked = None

    def _start(self):
        if not self.reading:
            import _thread
            self.reading = True
            _thread.start_new_thread(self._reader, ())

    def _reader(self):
        buf = bytearray()
        idle = 0
        while True:
            data = self.uart.read()
            if data:
                idle = 0
                buf += data
                while True:
                    i = buf.find(b"\n")
                    if i < 0:
                        break
                    line, buf = bytes(buf[:i]), buf[i + 1:]
                    try:
                        msg = json.loads(line.decode("utf-8"))
                    except (ValueError, UnicodeError):
                        continue
                    box = self.inbox.get(msg.get("id"))
                    if box is not None:
                        box.append(msg)
                continue
            idle += 1
            if idle > 300:
                sleep_ms(2 if self.busy else 20)

    def _send(self, obj):
        data = (json.dumps(obj) + "\n").encode("utf-8")
        with self.wlock:
            self.uart.write(data)

    def ready(self):
        if not self.uart.present:
            return False, "Este PC no tiene COM2: no hay salida de red."
        if self.checked:
            return True, ""
        self._start()
        box = self.inbox[0] = []
        self._send({"t": "ping", "id": 0})
        end = ticks_ms() + 2000
        while ticks_ms() < end:
            if box:
                self.checked = True
                return True, ""
            sleep_ms(20)
        return False, ("El puente de red no responde. Arranca PyKernel con  python tools/run.py --screen  "
                       "(abre el puente solo) o ejecuta  python bridge.py  en el PC anfitrión.")

    def request(self, method, url, headers, body, cancelled=None):
        rid = self.next_id
        self.next_id += 1
        box = self.inbox[rid] = []
        self._start()
        self.busy += 1
        self._send({"t": "req", "id": rid, "method": method, "url": url,
                    "headers": headers, "body": body})
        last = ticks_ms()
        try:
            while True:
                if cancelled and cancelled():
                    self._send({"t": "cancel", "id": rid})
                    return
                if not box:
                    if ticks_ms() - last > 300000:
                        raise OSError("el puente dejó de responder")
                    sleep_ms(5)
                    continue
                last = ticks_ms()
                msg = box.pop(0)
                t = msg.get("t")
                if t == "status":
                    yield ("status", msg.get("status", 0))
                elif t == "line":
                    yield ("line", msg.get("d", ""))
                elif t == "end":
                    return
                elif t == "error":
                    raise OSError(msg.get("d") or "error del puente")
        finally:
            self.busy -= 1
            self.inbox.pop(rid, None)


_transport = None


def transport():
    global _transport
    if _transport is None:
        _transport = Bridge() if PYKERNEL else Direct()
    return _transport


def fetch(method, url, headers, body=None):
    """Petición completa: (estado, texto)."""
    status, lines = 0, []
    for kind, value in transport().request(method, url, headers, body):
        if kind == "status":
            status = value
        else:
            lines.append(value)
    return status, "\n".join(lines)
