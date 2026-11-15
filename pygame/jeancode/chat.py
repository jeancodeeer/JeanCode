# Peticiones y respuestas del formato de chat de OpenAI, sin red ni pantalla:
# se prueban solas (tests/test_core.py) y funcionan en CPython y en MicroPython.
import json

SYSTEM = ("Eres un asistente de programación dentro de JeanCode. Responde en el idioma del usuario. "
          "Si no sabes algo, dilo; no inventes citas, enlaces ni datos. Muestra los cálculos. "
          "Si la petición es ambigua, pide una aclaración corta. Sin adulación ni sermones.")


def base_url(url):
    url = (url or "").strip()
    while url.endswith("/"):
        url = url[:-1]
    for tail in ("/chat/completions", "/models"):
        if url.endswith(tail):
            url = url[: -len(tail)]
    return url


def headers(key, stream=False):
    h = {"Content-Type": "application/json", "User-Agent": "JeanCode-pygame"}
    if key:
        h["Authorization"] = "Bearer " + key
    if stream:
        h["Accept"] = "text/event-stream"
    return h


def chat_request(ep, messages, system=SYSTEM):
    """(método, URL, cabeceras, cuerpo) de una petición de chat en streaming."""
    msgs = [{"role": "system", "content": system}] if system else []
    for m in messages:
        if m.get("content"):
            msgs.append({"role": m["role"], "content": m["content"]})
    body = {"model": ep.get("model") or "", "messages": msgs, "stream": True}
    return ("POST", base_url(ep.get("url")) + "/chat/completions",
            headers(ep.get("key"), stream=True), json.dumps(body))


def models_request(ep):
    return ("GET", base_url(ep.get("url")) + "/models", headers(ep.get("key")), None)


def parse_models(text):
    data = json.loads(text)
    items = data.get("data", data) if isinstance(data, dict) else data
    out = []
    for m in items or []:
        mid = m.get("id") if isinstance(m, dict) else m
        if mid and mid not in out:
            out.append(str(mid))
    out.sort()
    return out


def sse_line(line):
    """Una línea del streaming -> None, ("text", s), ("think", s), ("done",) o ("error", s)."""
    line = line.strip()
    if not line.startswith("data:"):
        return None
    data = line[5:].strip()
    if data == "[DONE]":
        return ("done",)
    try:
        obj = json.loads(data)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    if obj.get("error"):
        return ("error", error_text(obj))
    choices = obj.get("choices") or []
    if not choices:
        return None
    delta = choices[0].get("delta") or choices[0].get("message") or {}
    text = delta.get("content")
    if text:
        return ("text", text)
    think = delta.get("reasoning_content") or delta.get("reasoning")
    if think:
        return ("think", think)
    return None


def error_text(obj):
    """Mensaje legible de un error de la API (dict o texto JSON)."""
    if isinstance(obj, str):
        try:
            obj = json.loads(obj)
        except ValueError:
            return obj.strip()[:300] or "respuesta vacía"
    if isinstance(obj, list) and obj:
        obj = obj[0]
    if not isinstance(obj, dict):
        return str(obj)[:300]
    err = obj.get("error", obj)
    if isinstance(err, dict):
        return str(err.get("message") or err.get("type") or err)[:300]
    return str(err)[:300]


def status_hint(status):
    return {401: "La clave no es válida o falta (401).",
            403: "La clave no tiene permiso para esto (403).",
            404: "La URL o el modelo no existen (404). Revisa que la URL termine en /v1.",
            429: "Límite de uso alcanzado (429). Espera un poco o cambia de modelo.",
            502: "El servidor no responde (502). Si es Kaggle, la sesión pudo terminar: Run All y URL nueva.",
            503: "El modelo todavía está cargando o está ocupado (503).",
            }.get(status, "Error HTTP %d." % status)


def title_of(messages):
    for m in messages:
        if m.get("role") == "user" and m.get("content"):
            t = " ".join(m["content"].split())
            return t[:48] + ("..." if len(t) > 48 else "")
    return "Conversación nueva"


def wrap(text, cols):
    """Corta el texto en líneas de como mucho `cols` caracteres, por palabras."""
    cols = max(8, cols)
    out = []
    for para in text.replace("\t", "    ").replace("\r", "").split("\n"):
        if not para:
            out.append("")
            continue
        line = ""
        for word in para.split(" "):
            while len(word) > cols:                     # palabra más larga que la línea
                if line:
                    out.append(line)
                    line = ""
                out.append(word[:cols])
                word = word[cols:]
            if not line:
                line = word
            elif len(line) + 1 + len(word) <= cols:
                line += " " + word
            else:
                out.append(line)
                line = word
        out.append(line)
    return out


def wrap_code(text, cols):
    """Como wrap, pero conserva los espacios (la sangría del código importa)."""
    cols = max(8, cols)
    out = []
    for line in text.replace(chr(9), "    ").replace(chr(13), "").split(chr(10)):
        out.append(line[:cols])
        for j in range(cols, len(line), cols):
            out.append(line[j: j + cols])
    return out


def blocks(text):
    """Separa el Markdown en trozos de texto y de código: [(es_codigo, texto), ...]."""
    out, code, buf = [], False, []
    for line in text.split("\n"):
        if line.strip().startswith("```"):
            if buf or code:
                out.append((code, "\n".join(buf)))
            buf, code = [], not code
            continue
        buf.append(line)
    if buf:
        out.append((code, "\n".join(buf)))
    return out
