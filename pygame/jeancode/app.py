# JeanCode en pygame: chat con tus modelos en una ventana (CPython) o a pantalla
# completa dentro de PyKernel. El mismo código para los dos.
#
#   Enter envía · Shift+Enter nueva línea · Esc detiene la respuesta
#   F2 ajustes · F3 modelos · F4 historial · Ctrl+N conversación nueva · Ctrl+Q salir
import _thread
import time

import pygame

from jeancode import chat as C
from jeancode import net, providers
from jeancode.store import Store

VERSION = "1.2.2"

NIGHT = (0, 0, 0)
RAISE = (11, 11, 11)
RAISE2 = (20, 20, 20)
INK = (242, 241, 236)
SMOKE = (163, 162, 155)
ASH = (127, 126, 120)
LINE = (35, 35, 35)
LINE2 = (58, 58, 56)
LINE3 = (92, 91, 87)
OK = (207, 232, 184)
BAD = (255, 138, 128)

PAD = 12
SHADOW = 4


def _now():
    try:
        return int(time.time())
    except Exception:          # noqa: BLE001
        return 0


def _mask(key):
    if not key:
        return ""
    return "*" * max(0, min(len(key), 24) - 4) + key[-4:]


class Field:
    """Una línea de texto editable."""

    def __init__(self, text=""):
        self.text = text
        self.pos = len(text)

    def insert(self, s):
        self.text = self.text[: self.pos] + s + self.text[self.pos:]
        self.pos += len(s)

    def key(self, ev):
        k = ev.key
        if k == pygame.K_BACKSPACE and self.pos:
            self.text = self.text[: self.pos - 1] + self.text[self.pos:]
            self.pos -= 1
        elif k == pygame.K_DELETE:
            self.text = self.text[: self.pos] + self.text[self.pos + 1:]
        elif k == pygame.K_LEFT:
            self.pos = max(0, self.pos - 1)
        elif k == pygame.K_RIGHT:
            self.pos = min(len(self.text), self.pos + 1)
        elif k == pygame.K_HOME:
            self.pos = 0
        elif k == pygame.K_END:
            self.pos = len(self.text)
        else:
            return False
        return True


class App:
    def __init__(self, size=None):
        pygame.init()
        flags = 0 if net.PYKERNEL else pygame.RESIZABLE
        self.screen = pygame.display.set_mode(size or ((800, 600) if net.PYKERNEL else (1000, 680)), flags)
        pygame.display.set_caption("JeanCode " + VERSION)
        try:
            pygame.key.set_repeat(400, 35)
        except Exception:          # noqa: BLE001
            pass
        self.font = self._font(15)
        self.big = self._font(30, bold=True)
        self.cw = max(1, self.font.size("M")[0])
        self.lh = self.font.get_linesize()
        self.cache = {}
        self.store = Store()
        self.settings = self.store.settings()
        self.ep = self.settings["endpoint"]
        self.view = "chat"
        self.chat = self._new_chat()
        self.input = Field()
        self.scroll = 0
        self.rows_cache = {}
        self.streaming = False
        self.stop = False
        self.need_save = False
        self.dirty = True
        self.notice = ""
        self.eat_text = False
        self.wheel = False
        self.form = None
        self.models = None
        self.history = None

    # ------------------------------------------------------------ dibujo

    def _font(self, size, bold=False):
        if net.PYKERNEL:
            return pygame.font.Font(None, 16 if size < 24 else 40)
        for name in ("dejavusansmono", "consolas", "menlo", "liberationmono", "couriernew"):
            try:
                path = pygame.font.match_font(name, bold=bold)
            except Exception:      # noqa: BLE001
                path = None
            if path:
                return pygame.font.Font(path, size)
        return pygame.font.Font(None, size + 5)

    def text(self, s, x, y, color=INK, font=None, bg=None):
        if not s:
            return 0
        font = font or self.font
        key = (s, color, bg, font is self.big)
        surf = self.cache.get(key)
        if surf is None:
            if len(self.cache) > 800:
                self.cache.clear()
            surf = font.render(s, True, color, bg) if bg else font.render(s, True, color)
            self.cache[key] = surf
        self.screen.blit(surf, (x, y))
        return surf.get_width()

    def box(self, rect, bg=RAISE, border=LINE2, shadow=False, width=1):
        x, y, w, h = rect
        if shadow:
            self.screen.fill(LINE3, (x + SHADOW, y + SHADOW, w, h))
        self.screen.fill(bg, (x, y, w, h))
        if border:
            pygame.draw.rect(self.screen, border, (x, y, w, h), width)

    def cols(self, width):
        return max(10, width // self.cw)

    def draw(self):
        W, H = self.screen.get_size()
        self.screen.fill(NIGHT)
        top = self.lh + 14
        # barra superior
        label = " JEANCODE "
        self.screen.fill(INK, (PAD, 7, len(label) * self.cw, self.lh))
        self.text(label, PAD, 7, NIGHT)
        x = PAD + (len(label) + 1) * self.cw
        self.text(VERSION + ("  PyKernel" if net.PYKERNEL else ""), x, 7, ASH)
        prov = providers.by_id(self.ep.get("provider"))[1]
        right = prov + " / " + (self.ep.get("model") or "sin modelo")
        right = right[-(self.cols(W) // 2):]
        self.text(right, W - PAD - len(right) * self.cw, 7, SMOKE)
        self.screen.fill(LINE2, (0, top - 1, W, 1))
        # pie con las teclas
        foot = {"chat": "Enter enviar  Shift+Enter salto  Esc parar  F2 API  F3 modelo  F4 historial  ^N nuevo  ^Q salir",
                "settings": "Tab/flechas campo  Izq/Der proveedor  F3 elegir modelo  Enter guardar  Esc volver",
                "models": "Escribe para filtrar  flechas elegir  Enter usar  Esc volver",
                "history": "flechas elegir  Enter abrir  Supr borrar  Esc volver"}[self.view]
        fy = H - self.lh - 6
        self.screen.fill(LINE, (0, fy - 6, W, 1))
        self.text(foot[: self.cols(W - 2 * PAD)], PAD, fy, ASH)
        area = (PAD, top + PAD, W - 2 * PAD - SHADOW, fy - top - 2 * PAD - 6)
        getattr(self, "draw_" + self.view)(area)
        pygame.display.flip()

    # ------------------------------------------------------------ chat

    def _new_chat(self):
        return {"id": "c%d%d" % (_now(), net.ticks_ms() % 1000), "title": "", "ts": _now(), "messages": []}

    def _rows(self, i, m, cols):
        sig = (len(m.get("content", "")), len(m.get("think", "")), m.get("error"), cols, m.get("live"))
        hit = self.rows_cache.get(i)
        if hit and hit[0] == sig:
            return hit[1]
        rows = []
        if m["role"] == "user":
            rows.append(("label", "Tú", SMOKE))
        else:
            rows.append(("label", "JEAN  " + (m.get("model") or ""), INK))
        content = m.get("content", "")
        if m.get("think") and not content:
            for line in C.wrap(m["think"], cols - 2)[-4:]:
                rows.append(("text", "  " + line, ASH))
        for code, part in C.blocks(content):
            if code:
                for line in C.wrap_code(part, cols - 4):
                    rows.append(("code", line, OK))
            else:
                for line in C.wrap(part, cols):
                    rows.append(("text", line, INK if m["role"] == "assistant" else SMOKE))
        if m.get("live") and not content and not m.get("think"):
            rows.append(("text", "esperando al modelo...", ASH))
        if m.get("error"):
            for line in C.wrap(m["error"], cols):
                rows.append(("text", line, BAD))
        rows.append(("gap", "", None))
        self.rows_cache[i] = (sig, rows)
        return rows

    def _input_lines(self, cols):
        lines, start = [], 0
        for para in self.input.text.split("\n"):
            if not para:
                lines.append((start, ""))
            for j in range(0, len(para), cols):
                lines.append((start + j, para[j: j + cols]))
            start += len(para) + 1
        return lines

    def draw_chat(self, area):
        x, y, w, h = area
        cols = self.cols(w - 2 * PAD)
        lines = self._input_lines(cols)
        shown = min(6, len(lines))
        ih = shown * self.lh + 2 * PAD
        iy = y + h - ih
        # conversación
        rows = []
        for i, m in enumerate(self.chat["messages"]):
            rows.extend(self._rows(i, m, self.cols(w)))
        if not rows:
            self._welcome(x, y, w)
        vis = max(1, (iy - y - PAD) // self.lh)
        self.scroll = max(0, min(self.scroll, len(rows) - vis))
        first = max(0, len(rows) - vis - self.scroll)
        ry = y
        for kind, s, color in rows[first: first + vis]:
            if kind == "label":
                self.text(s, x, ry, color)
                rule = w - (len(s) + 1) * self.cw
                if rule > 0:
                    self.screen.fill(LINE2, (x + (len(s) + 1) * self.cw, ry + self.lh // 2, rule, 1))
            elif kind == "code":
                self.screen.fill(RAISE2, (x, ry, w, self.lh))
                self.screen.fill(LINE3, (x, ry, 2, self.lh))
                self.text(s, x + 2 * self.cw, ry, color)
            elif s:
                self.text(s, x, ry, color)
            ry += self.lh
        if self.scroll:
            tag = " %d líneas más abajo (PgDn) " % self.scroll
            self.text(tag, x + w - len(tag) * self.cw, iy - PAD - self.lh, NIGHT, bg=SMOKE)
        # caja de escribir
        self.box((x, iy, w, ih), RAISE, INK, shadow=True, width=2)
        cur = 0
        for n, (start, s) in enumerate(lines):
            if start <= self.input.pos <= start + len(s):
                cur = n
        top_line = max(0, min(cur - shown + 1, len(lines) - shown))
        for n in range(top_line, top_line + shown):
            start, s = lines[n]
            ly = iy + PAD + (n - top_line) * self.lh
            self.text(s, x + PAD, ly, INK)
            if n == cur:
                cx = x + PAD + (self.input.pos - start) * self.cw
                self.screen.fill(INK, (cx, ly + 1, 2, self.lh - 2))
        if not self.input.text:
            hint = "respondiendo... Esc detiene" if self.streaming else "Escribe tu mensaje"
            self.text(hint, x + PAD + 4, iy + PAD, ASH)
        if self.notice:
            self.text(" " + self.notice + " ", x, iy - PAD - self.lh, NIGHT, bg=OK)

    def _welcome(self, x, y, w):
        self.text("JeanCode", x, y + self.lh, INK, font=self.big)
        lines = ["Chat con tus modelos, sin navegador."]
        if not self.ep.get("url") or not self.ep.get("model"):
            lines += ["", "Primero elige una API: pulsa F2.",
                      "¿No tienes? Jean-API-Generator te da una gratis en Kaggle:",
                      "github.com/jeancodeeer/Jean-API-Generator"]
        else:
            lines += ["", "Escribe abajo y pulsa Enter."]
        if net.PYKERNEL:
            lines += ["", "En PyKernel la red sale por COM2 hacia el puente del PC anfitrión."]
        ly = y + self.lh + self.big.get_linesize() + PAD
        for s in lines:
            for part in C.wrap(s, self.cols(w)) if s else [""]:
                self.text(part, x, ly, SMOKE)
                ly += self.lh

    def send(self):
        text = self.input.text.strip()
        if not text or self.streaming:
            return
        if not self.ep.get("url") or not self.ep.get("model"):
            self.flash("Falta la URL o el modelo: pulsa F2.")
            return
        msgs = self.chat["messages"]
        msgs.append({"role": "user", "content": text})
        reply = {"role": "assistant", "content": "", "model": self.ep.get("model"), "live": True}
        msgs.append(reply)
        if not self.chat["title"]:
            self.chat["title"] = C.title_of(msgs)
        self.chat["model"] = self.ep.get("model")
        self.input = Field()
        self.scroll = 0
        self.streaming, self.stop = True, False
        _thread.start_new_thread(self._worker, (msgs[:-1], reply, dict(self.ep)))

    def _worker(self, history, reply, ep):
        gen = None
        try:
            ok, why = net.transport().ready()
            if not ok:
                reply["error"] = why
                return
            method, url, headers, body = C.chat_request(ep, history)
            status, raw, events = 0, [], 0
            gen = net.transport().request(method, url, headers, body, cancelled=lambda: self.stop)
            for kind, value in gen:
                if kind == "status":
                    status = value
                    continue
                ev = C.sse_line(value) if status == 200 else None
                if ev is None:
                    if len(raw) < 400:
                        raw.append(value)
                    continue
                events += 1
                if ev[0] == "text":
                    reply["content"] += ev[1]
                elif ev[0] == "think":
                    reply["think"] = reply.get("think", "") + ev[1]
                elif ev[0] == "error":
                    reply["error"] = ev[1]
                elif ev[0] == "done":
                    break
                self.dirty = True
            if status and status != 200:
                reply["error"] = C.status_hint(status) + " " + C.error_text("\n".join(raw))
            elif not events and raw:                    # servidor sin streaming
                try:
                    import json
                    obj = json.loads("\n".join(raw))
                    reply["content"] = obj["choices"][0]["message"]["content"] or ""
                except Exception:                   # noqa: BLE001
                    reply["error"] = "Respuesta inesperada: " + C.error_text("\n".join(raw))
            if self.stop and not reply.get("error"):
                reply["error"] = "Detenido."
        except Exception as e:                      # noqa: BLE001
            reply["error"] = "Sin conexión: " + (str(e) or e.__class__.__name__)
        finally:
            if gen is not None:
                try:
                    gen.close()
                except Exception:                   # noqa: BLE001
                    pass
            reply.pop("live", None)
            reply.pop("think", None) if reply.get("content") else None
            self.streaming = False
            self.need_save = True
            self.dirty = True

    def key_chat(self, ev, ctrl, shift):
        k = ev.key
        if k in (pygame.K_RETURN, pygame.K_KP_ENTER):
            if shift:
                self.input.insert("\n")
            else:
                self.send()
        elif k == pygame.K_ESCAPE:
            self.stop = True
        elif k == pygame.K_PAGEUP:
            self.scroll += 10
        elif k == pygame.K_PAGEDOWN:
            self.scroll = max(0, self.scroll - 10)
        elif ctrl and k == pygame.K_n:
            self.new_chat()
        elif ctrl and k == pygame.K_v:
            self.paste()
        elif k in (pygame.K_UP, pygame.K_DOWN):
            self._vertical(k == pygame.K_UP)
        else:
            self.input.key(ev)

    def _vertical(self, up):
        if up and not self.input.text:
            for m in reversed(self.chat["messages"]):
                if m["role"] == "user":
                    self.input = Field(m["content"])
                    return
            return
        W = self.screen.get_size()[0]
        lines = self._input_lines(self.cols(W - 2 * PAD - SHADOW - 2 * PAD))
        cur = 0
        for n, (start, s) in enumerate(lines):
            if start <= self.input.pos <= start + len(s):
                cur = n
        col = self.input.pos - lines[cur][0]
        nxt = cur - 1 if up else cur + 1
        if 0 <= nxt < len(lines):
            start, s = lines[nxt]
            self.input.pos = start + min(col, len(s))
        else:
            self.scroll += 3 if up else -3
            self.scroll = max(0, self.scroll)

    def paste(self):
        try:
            if not pygame.scrap.get_init():
                pygame.scrap.init()
            text = pygame.scrap.get_text()
        except Exception:                           # noqa: BLE001
            text = None
        if text:
            self.input.insert(text.replace("\r\n", "\n").replace("\x00", ""))

    def new_chat(self):
        if self.streaming:
            self.flash("Espera a que termine la respuesta (Esc la detiene).")
            return
        self.save_chat()
        self.chat = self._new_chat()
        self.rows_cache = {}
        self.input = Field()
        self.scroll = 0

    def save_chat(self):
        if self.chat["messages"]:
            try:
                self.store.save_chat(self.chat)
            except OSError as e:
                self.flash("No se pudo guardar el historial: %s" % e)

    def flash(self, msg):
        self.notice = msg
        self.notice_until = net.ticks_ms() + 4000

    # ------------------------------------------------------------ ajustes

    def open_settings(self):
        ep = self.ep
        self.form = {"i": 0, "provider": providers.index_of(ep.get("provider")),
                     "url": Field(ep.get("url", "")), "key": Field(ep.get("key", "")),
                     "model": Field(ep.get("model", "")), "reveal": False}
        self.view = "settings"

    FIELDS = ("provider", "url", "key", "model")

    def draw_settings(self, area):
        x, y, w, h = area
        f = self.form
        self.text("AJUSTES", x, y, INK)
        y += self.lh * 2
        p = providers.PROVIDERS[f["provider"]]
        labels = {"provider": "PROVEEDOR", "url": "URL BASE", "key": "CLAVE", "model": "MODELO"}
        for n, name in enumerate(self.FIELDS):
            active = f["i"] == n
            self.text(labels[name], x, y, SMOKE if active else ASH)
            y += self.lh + 4
            bh = self.lh + 16
            self.box((x, y, w, bh), RAISE, INK if active else LINE2, shadow=active, width=2 if active else 1)
            if name == "provider":
                s = "<  %s  >" % p[1]
                self.text(s, x + PAD, y + 8, INK)
            else:
                fld = f[name]
                shown = fld.text if (name != "key" or f["reveal"]) else _mask(fld.text)
                cols = self.cols(w - 2 * PAD) - 1
                start = max(0, fld.pos - cols) if active else 0
                self.text(shown[start: start + cols], x + PAD, y + 8, INK)
                if not fld.text:
                    hint = {"url": p[2] or "https://.../v1", "key": p[3], "model": "F3 para elegir de la lista"}[name]
                    self.text(hint, x + PAD, y + 8, ASH)
                if active:
                    self.screen.fill(INK, (x + PAD + (fld.pos - start) * self.cw, y + 9, 2, self.lh - 2))
            y += bh + PAD
        notes = [providers.NOTES.get(p[0], "")]
        if p[4]:
            notes.append("Clave: " + p[4])
        notes.append("F5 muestra u oculta la clave. Se guarda solo en este equipo (%s)." % self.store.root)
        for s in notes:
            for part in C.wrap(s, self.cols(w)) if s else []:
                self.text(part, x, y, ASH)
                y += self.lh

    def key_settings(self, ev, ctrl, shift):
        f = self.form
        k = ev.key
        name = self.FIELDS[f["i"]]
        if k == pygame.K_ESCAPE:
            self.view = "chat"
        elif k in (pygame.K_RETURN, pygame.K_KP_ENTER):
            self.apply_settings()
            self.view = "chat"
        elif k == pygame.K_TAB or k in (pygame.K_UP, pygame.K_DOWN):
            step = -1 if (k == pygame.K_UP or (k == pygame.K_TAB and shift)) else 1
            f["i"] = (f["i"] + step) % len(self.FIELDS)
        elif k == pygame.K_F5:
            f["reveal"] = not f["reveal"]
        elif k == pygame.K_F3:
            self.apply_settings()
            self.open_models("settings")
        elif ctrl and k == pygame.K_v and name != "provider":
            try:
                if not pygame.scrap.get_init():
                    pygame.scrap.init()
                text = pygame.scrap.get_text() or ""
            except Exception:                       # noqa: BLE001
                text = ""
            f[name].insert(text.strip())
        elif name == "provider" and k in (pygame.K_LEFT, pygame.K_RIGHT):
            old = providers.PROVIDERS[f["provider"]]
            f["provider"] = (f["provider"] + (1 if k == pygame.K_RIGHT else -1)) % len(providers.PROVIDERS)
            new = providers.PROVIDERS[f["provider"]]
            if not f["url"].text or f["url"].text == old[2]:
                f["url"] = Field(new[2])
            if old[0] != new[0]:
                f["model"] = Field("")
        elif name != "provider":
            f[name].key(ev)

    def type_settings(self, s):
        name = self.FIELDS[self.form["i"]]
        if name != "provider":
            self.form[name].insert(s)

    def apply_settings(self):
        f = self.form
        self.ep.update({"provider": providers.PROVIDERS[f["provider"]][0], "url": C.base_url(f["url"].text),
                        "key": f["key"].text.strip(), "model": f["model"].text.strip()})
        self.settings["endpoint"] = self.ep
        try:
            self.store.save_settings(self.settings)
        except OSError as e:
            self.flash("No se pudieron guardar los ajustes: %s" % e)

    # ------------------------------------------------------------ modelos

    def open_models(self, back="chat"):
        self.models = {"back": back, "items": None, "error": "", "filter": Field(), "sel": 0}
        self.view = "models"
        if not self.ep.get("url"):
            self.models["error"] = "Primero escribe la URL base en Ajustes (F2)."
            return
        _thread.start_new_thread(self._load_models, (self.models, dict(self.ep)))

    def _load_models(self, state, ep):
        try:
            ok, why = net.transport().ready()
            if not ok:
                state["error"] = why
                return
            status, text = net.fetch(*C.models_request(ep))
            if status != 200:
                state["error"] = C.status_hint(status) + " " + C.error_text(text)
            else:
                state["items"] = C.parse_models(text)
                if not state["items"]:
                    state["error"] = "La API no devolvió modelos. Escribe el nombre a mano en Ajustes."
        except Exception as e:                      # noqa: BLE001
            state["error"] = "Sin conexión: " + (str(e) or e.__class__.__name__)
        finally:
            self.dirty = True

    def _filtered(self):
        q = self.models["filter"].text.lower()
        return [m for m in (self.models["items"] or []) if q in m.lower()]

    def draw_models(self, area):
        x, y, w, h = area
        st = self.models
        self.text("MODELOS  " + providers.by_id(self.ep.get("provider"))[1], x, y, INK)
        y += self.lh * 2
        self.box((x, y, w, self.lh + 16), RAISE, INK, shadow=True, width=2)
        self.text(st["filter"].text or "filtrar...", x + PAD, y + 8, INK if st["filter"].text else ASH)
        y += self.lh + 16 + PAD * 2
        if st["error"]:
            for part in C.wrap(st["error"], self.cols(w)):
                self.text(part, x, y, BAD)
                y += self.lh
            return
        if st["items"] is None:
            self.text("cargando la lista de modelos...", x, y, ASH)
            return
        items = self._filtered()
        st["sel"] = max(0, min(st["sel"], len(items) - 1))
        vis = max(1, (h - (y - area[1])) // self.lh)
        first = max(0, st["sel"] - vis + 1)
        for n in range(first, min(len(items), first + vis)):
            name = items[n][: self.cols(w) - 2]
            if n == st["sel"]:
                self.screen.fill(INK, (x, y, w, self.lh))
                self.text(" " + name, x, y, NIGHT)
            else:
                self.text(" " + name, x, y, INK if name == self.ep.get("model") else SMOKE)
            y += self.lh
        if not items:
            self.text("ningún modelo coincide", x, y, ASH)

    def key_models(self, ev, ctrl, shift):
        st, k = self.models, ev.key
        if k == pygame.K_ESCAPE:
            self._back_from_models()
        elif k == pygame.K_UP:
            st["sel"] -= 1
        elif k == pygame.K_DOWN:
            st["sel"] += 1
        elif k == pygame.K_PAGEUP:
            st["sel"] -= 10
        elif k == pygame.K_PAGEDOWN:
            st["sel"] += 10
        elif k in (pygame.K_RETURN, pygame.K_KP_ENTER):
            items = self._filtered()
            if items:
                self.ep["model"] = items[max(0, min(st["sel"], len(items) - 1))]
                self.settings["endpoint"] = self.ep
                self.store.save_settings(self.settings)
                self.flash("Modelo: " + self.ep["model"])
            self._back_from_models()
        else:
            st["filter"].key(ev)
            st["sel"] = 0

    def _back_from_models(self):
        if self.models["back"] == "settings":
            self.open_settings()
            self.form["i"] = 3
        else:
            self.view = "chat"

    # ------------------------------------------------------------ historial

    def open_history(self):
        self.save_chat()
        self.history = {"items": self.store.chats(), "sel": 0, "confirm": False}
        self.view = "history"

    def draw_history(self, area):
        x, y, w, h = area
        st = self.history
        self.text("HISTORIAL", x, y, INK)
        y += self.lh * 2
        if not st["items"]:
            self.text("Todavía no hay conversaciones guardadas.", x, y, ASH)
            return
        vis = max(1, (h - self.lh * 4) // (self.lh * 2))
        first = max(0, st["sel"] - vis + 1)
        for n in range(first, min(len(st["items"]), first + vis)):
            c = st["items"][n]
            on = n == st["sel"]
            if on:
                self.screen.fill(INK, (x, y, w, self.lh * 2 - 4))
            fg, sub = (NIGHT, NIGHT) if on else (INK, ASH)
            self.text(" " + (c.get("title") or "Conversación")[: self.cols(w) - 2], x, y, fg)
            meta = " %d mensajes  %s" % (len(c.get("messages", [])), c.get("model") or "")
            self.text(meta[: self.cols(w)], x, y + self.lh - 2, sub)
            y += self.lh * 2
        if st["confirm"]:
            self.text(" Pulsa Supr otra vez para borrar esta conversación ", x, area[1] + h - self.lh, NIGHT, bg=BAD)

    def key_history(self, ev, ctrl, shift):
        st, k = self.history, ev.key
        n = len(st["items"])
        if k != pygame.K_DELETE:
            st["confirm"] = False
        if k == pygame.K_ESCAPE:
            self.view = "chat"
        elif k == pygame.K_UP and n:
            st["sel"] = (st["sel"] - 1) % n
        elif k == pygame.K_DOWN and n:
            st["sel"] = (st["sel"] + 1) % n
        elif k in (pygame.K_RETURN, pygame.K_KP_ENTER) and n:
            if self.streaming:
                self.flash("Espera a que termine la respuesta (Esc la detiene).")
                return
            self.chat = st["items"][st["sel"]]
            self.rows_cache = {}
            self.scroll = 0
            self.view = "chat"
        elif k == pygame.K_DELETE and n:
            if st["confirm"]:
                cid = st["items"][st["sel"]]["id"]
                self.store.delete_chat(cid)
                if cid == self.chat.get("id"):
                    self.chat = self._new_chat()
                    self.rows_cache = {}
                st["items"] = self.store.chats()
                st["sel"] = min(st["sel"], len(st["items"]) - 1) if st["items"] else 0
                st["confirm"] = False
            else:
                st["confirm"] = True

    # ------------------------------------------------------------ bucle

    def handle(self, ev):
        if ev.type == pygame.QUIT:
            return False
        if ev.type == pygame.KEYDOWN:
            mods = ev.mod
            ctrl = bool(mods & pygame.KMOD_CTRL) and not (mods & pygame.KMOD_ALT)
            shift = bool(mods & pygame.KMOD_SHIFT)
            if ctrl and net.PYKERNEL:
                self.eat_text = True             # PyKernel también manda TEXTINPUT con Ctrl
            if ctrl and ev.key == pygame.K_q:
                return False
            if self.view == "chat" and ev.key == pygame.K_F2:
                self.open_settings()
            elif self.view == "chat" and ev.key == pygame.K_F3:
                self.open_models()
            elif self.view == "chat" and ev.key == pygame.K_F4:
                self.open_history()
            else:
                getattr(self, "key_" + self.view)(ev, ctrl, shift)
            self.dirty = True
        elif ev.type == pygame.TEXTINPUT:
            if self.eat_text:
                self.eat_text = False
                return True
            if self.view == "chat":
                self.input.insert(ev.text)
            elif self.view == "settings":
                self.type_settings(ev.text)
            elif self.view == "models":
                self.models["filter"].insert(ev.text)
                self.models["sel"] = 0
            self.dirty = True
        elif ev.type == pygame.MOUSEWHEEL:
            self.wheel = True
            self._wheel(ev.y)
        elif ev.type == pygame.MOUSEBUTTONDOWN and ev.button in (4, 5) and not self.wheel:
            self._wheel(1 if ev.button == 4 else -1)
        elif ev.type in (getattr(pygame, "VIDEORESIZE", -1), getattr(pygame, "WINDOWSIZECHANGED", -1)):
            self.screen = pygame.display.get_surface()
            self.rows_cache = {}
            self.dirty = True
        return True

    def _wheel(self, dy):
        if self.view == "chat":
            self.scroll = max(0, self.scroll + 3 * dy)
        elif self.view == "models":
            self.models["sel"] -= dy
        elif self.view == "history" and self.history["items"]:
            self.history["sel"] = max(0, min(len(self.history["items"]) - 1, self.history["sel"] - dy))
        self.dirty = True

    def run(self):
        clock = pygame.time.Clock()
        try:
            while True:
                for ev in pygame.event.get():
                    if not self.handle(ev):
                        return
                if self.notice and net.ticks_ms() > getattr(self, "notice_until", 0):
                    self.notice = ""
                    self.dirty = True
                if self.need_save:
                    self.need_save = False
                    self.save_chat()
                if self.dirty:
                    self.dirty = False
                    self.draw()
                clock.tick(30)
        finally:
            self.stop = True
            self.save_chat()
            pygame.quit()


def main():
    App().run()


if __name__ == "__main__":
    main()
