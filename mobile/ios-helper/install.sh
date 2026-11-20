#!/bin/sh
# Instala el ayudante del mini agente de JeanCode en un iPhone con jailbreak (rootless /var/jb o rootful).
# Requisitos (Sileo/Zebra): python3. Ejecútalo como root desde una terminal del iPhone (NewTerm) o por SSH:
#   sudo sh install.sh
set -e
PREFIX=""
[ -d /var/jb ] && PREFIX=/var/jb
PY="$PREFIX/usr/bin/python3"
[ -x "$PY" ] || { echo "Falta python3: instálalo desde Sileo (paquete python3) y vuelve a ejecutar."; exit 1; }
# webfetch usa HTTPS verificado: hacen falta los certificados raíz (paquete ca-certificates de Procursus)
"$PY" -c "import os,ssl; p=ssl.get_default_verify_paths(); raise SystemExit(0 if (p.cafile and os.path.exists(p.cafile)) or (p.capath and os.path.isdir(p.capath)) else 1)" \
  || echo "Aviso: python3 no encuentra certificados raíz; instala «ca-certificates» desde Sileo para que webfetch abra páginas HTTPS."
HERE=$(cd "$(dirname "$0")" && pwd)
install -d "$PREFIX/usr/libexec/jeancode"
install -m 755 "$HERE/jeancode_helper.py" "$PREFIX/usr/libexec/jeancode/jeancode_helper.py"
# pantalla (opcional): compila jeancode-hid en el propio iPhone si hay clang, ldid y un SDK
sh "$HERE/build-hid.sh"
PLIST="$PREFIX/Library/LaunchDaemons/io.github.jeancodeeer.helper.plist"
sed "s#@PREFIX@#$PREFIX#g" "$HERE/io.github.jeancodeeer.helper.plist" > "$PLIST"
chmod 644 "$PLIST"; chown root:wheel "$PLIST"
# el token se crea como el usuario mobile (mismo dueño que el servicio)
su mobile -c "HOME=/var/mobile $PY $PREFIX/usr/libexec/jeancode/jeancode_helper.py --token" > /dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "Ayudante instalado y en marcha. Copia este token en JeanCode → Móvil → Ayudante del iPhone:"
su mobile -c "HOME=/var/mobile $PY $PREFIX/usr/libexec/jeancode/jeancode_helper.py --token"
