#!/bin/sh
# Quita el ayudante del mini agente de JeanCode.  sudo sh uninstall.sh
PREFIX=""
[ -d /var/jb ] && PREFIX=/var/jb
PLIST="$PREFIX/Library/LaunchDaemons/io.github.jeancodeeer.helper.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$PREFIX/usr/libexec/jeancode" /var/mobile/Library/JeanCode/helper-token
echo "Ayudante desinstalado."
