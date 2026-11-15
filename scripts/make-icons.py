#!/usr/bin/env python3
"""Genera todos los iconos de JeanCode desde una sola marca: una J de bloques y un cursor de terminal.

    python scripts/make-icons.py

Escribe:
  web/favicon.svg                      favicon y logo de la interfaz (vectorial)
  web/icons/icon-192.png, icon-512.png icono de la web instalable (PWA)
  web/icons/maskable-512.png           icono adaptable de Android para la PWA (zona segura)
  mobile/resources/icon-only.png       icono de Android/iOS (Capacitor Assets)
  mobile/resources/icon-foreground.png icono adaptable de Android: primer plano
  mobile/resources/icon-background.png icono adaptable de Android: fondo
  mobile/resources/splash.png, splash-dark.png  pantalla de arranque
  desktop/build/icon.png               icono del instalador y de la ventana (electron-builder)
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INK, PAPER = (255, 255, 255, 255), (0, 0, 0, 255)

# Marca en una rejilla de 64: J (barra superior, asta, base y remate) + cursor de bloque.
GRID = 64
RECTS = [
    (14, 12, 42, 20),   # barra superior de la J
    (28, 12, 36, 52),   # asta
    (14, 44, 36, 52),   # base
    (14, 36, 22, 52),   # remate izquierdo
    (42, 42, 50, 52),   # cursor
]


def svg():
    rects = "".join(f'<rect x="{a}" y="{b}" width="{c - a}" height="{d - b}"/>' for a, b, c, d in RECTS)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GRID} {GRID}">'
            f'<rect width="{GRID}" height="{GRID}" fill="#000"/><g fill="#fff">{rects}</g></svg>\n')


def draw(size, mark=1.0, bg=PAPER):
    """Icono cuadrado de `size` px; la marca ocupa la fracción `mark` del lado (centrada)."""
    img = Image.new("RGBA", (size, size), bg)
    d = ImageDraw.Draw(img)
    scale = size * mark / GRID
    off = (size - GRID * scale) / 2
    for a, b, c, e in RECTS:
        d.rectangle([off + a * scale, off + b * scale, off + c * scale - 1, off + e * scale - 1], fill=INK)
    return img


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    print("  ", os.path.relpath(path, ROOT))


def main():
    with open(os.path.join(ROOT, "web", "favicon.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write(svg())
    print("   web/favicon.svg")
    save(draw(192), "web", "icons", "icon-192.png")
    save(draw(512), "web", "icons", "icon-512.png")
    save(draw(512, mark=0.62), "web", "icons", "maskable-512.png")          # zona segura del 80 %
    save(draw(1024), "mobile", "resources", "icon-only.png")
    save(draw(1024, mark=0.56, bg=(0, 0, 0, 0)), "mobile", "resources", "icon-foreground.png")
    save(Image.new("RGBA", (1024, 1024), PAPER), "mobile", "resources", "icon-background.png")
    splash = draw(2732, mark=0.18)
    save(splash, "mobile", "resources", "splash.png")
    save(splash, "mobile", "resources", "splash-dark.png")
    save(draw(1024), "desktop", "build", "icon.png")


if __name__ == "__main__":
    main()
