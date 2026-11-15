# Ajustes e historial en archivos JSON.
#   CPython:  ~/.jeancode/pygame/      PyKernel: /disk/jeancode/ (o /jeancode/ si no hay disco)
# La clave se guarda en texto plano en este archivo, solo en tu equipo.
import json
import os

MAX_CHATS = 60


def _exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def _mkdirs(path):
    parts = path.replace("\\", "/").split("/")
    cur = ""
    for i, p in enumerate(parts):
        cur = p if i == 0 else cur + "/" + p
        if cur and not _exists(cur):
            try:
                os.mkdir(cur, 0o700) if hasattr(os, "chmod") else os.mkdir(cur)
            except OSError:
                pass


def data_dir():
    try:
        import _kernel  # noqa: F401
        return "/disk/jeancode" if _exists("/disk") else "/jeancode"
    except ImportError:
        pass
    home = os.environ.get("JEANCODE_HOME") or os.path.join(os.path.expanduser("~"), ".jeancode", "pygame")
    return home


class Store:
    def __init__(self, root=None):
        self.root = root or data_dir()
        _mkdirs(self.root)
        if hasattr(os, "chmod"):
            try:
                os.chmod(self.root, 0o700)
            except OSError:
                pass

    def _path(self, name):
        return self.root + "/" + name

    def _load(self, name, default):
        try:
            with open(self._path(name)) as f:
                return json.loads(f.read())
        except (OSError, ValueError):
            return default

    def _save(self, name, obj):
        tmp, final = self._path(name + ".tmp"), self._path(name)
        if hasattr(os, "replace"):                   # CPython: solo el dueño puede leerlo (lleva la clave)
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(obj))
            os.replace(tmp, final)
            return
        with open(tmp, "w") as f:                    # PyKernel (MicroPython): un solo usuario
            f.write(json.dumps(obj))
        try:
            os.remove(final)
        except OSError:
            pass
        os.rename(tmp, final)

    def settings(self):
        s = self._load("settings.json", {})
        ep = s.get("endpoint") or {}
        for k, v in (("provider", "jean"), ("url", ""), ("key", ""), ("model", "")):
            ep.setdefault(k, v)
        s["endpoint"] = ep
        return s

    def save_settings(self, s):
        self._save("settings.json", s)

    def chats(self):
        chats = self._load("chats.json", [])
        return chats if isinstance(chats, list) else []

    def save_chat(self, chat):
        chats = [c for c in self.chats() if c.get("id") != chat["id"]]
        if chat.get("messages"):
            chats.insert(0, chat)
        self._save("chats.json", chats[:MAX_CHATS])

    def delete_chat(self, cid):
        self._save("chats.json", [c for c in self.chats() if c.get("id") != cid])
