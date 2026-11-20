#!/bin/sh
# Compila y firma jeancode-hid (pantalla del iPhone) en el propio iPhone. Lo llama install.sh; también se puede
# ejecutar solo:  sudo sh build-hid.sh
# Necesita (Sileo/Zebra, repositorio de Procursus): clang, ldid y un SDK de iOS (p. ej. el de Theos en ~/theos/sdks).
PREFIX=""
[ -d /var/jb ] && PREFIX=/var/jb
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$PREFIX/usr/libexec/jeancode/jeancode-hid"
command -v clang >/dev/null 2>&1 || { echo "Pantalla: falta clang (instálalo desde Sileo); el agente funcionará sin controlar la pantalla."; exit 0; }
command -v ldid >/dev/null 2>&1 || { echo "Pantalla: falta ldid (instálalo desde Sileo); el agente funcionará sin controlar la pantalla."; exit 0; }
SDK=""
for d in "$PREFIX"/usr/share/SDKs/iPhoneOS*.sdk /var/mobile/theos/sdks/iPhoneOS*.sdk /var/theos/sdks/iPhoneOS*.sdk /var/jb/var/mobile/theos/sdks/iPhoneOS*.sdk; do
  [ -d "$d" ] && SDK="$d"
done
[ -n "$SDK" ] || { echo "Pantalla: no encuentro un SDK de iOS (instala uno de Theos en /var/mobile/theos/sdks); el agente funcionará sin controlar la pantalla."; exit 0; }
echo "Compilando jeancode-hid con $SDK…"
install -d "$PREFIX/usr/libexec/jeancode"
clang -fobjc-arc -O2 -isysroot "$SDK" -arch arm64 -miphoneos-version-min=14.0 \
  -framework Foundation -framework UIKit -framework CoreGraphics -framework ImageIO -framework IOSurface \
  -o "$OUT" "$HERE/jeancode-hid.m" || { echo "Pantalla: no compiló (mira el error de arriba); el agente funcionará sin controlar la pantalla."; exit 0; }
ldid -S"$HERE/jeancode-hid.entitlements" "$OUT" || { echo "Pantalla: no se pudo firmar con ldid."; rm -f "$OUT"; exit 0; }
chmod 755 "$OUT"
if "$OUT" size >/dev/null 2>&1; then echo "Pantalla: lista ($("$OUT" size))."; else echo "Pantalla: compilado, pero no arranca en esta versión de iOS: $("$OUT" size 2>&1 | head -n 2)"; fi
