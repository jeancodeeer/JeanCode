# Mini agente del móvil

El agente de JeanCode trabajando **dentro del teléfono**: lee y escribe archivos, ejecuta comandos y, en Android,
maneja la pantalla (abrir apps, tocar, deslizar, escribir, capturas). Usa el modelo que tengas conectado en la app.
Pestaña **Móvil**, solo en las apps de Android e iOS (la web no puede hacer nada de esto).

Una app normal no tiene permiso para ejecutar comandos ni tocar la pantalla. Por eso hace falta un **ayudante con
privilegios** en el propio teléfono:

| | AYUDANTE | QUÉ PUEDE |
|---|---|---|
| **Android** (modo desarrollador) | [Shizuku](https://github.com/RikkaApps/Shizuku): abre para JeanCode un proceso con permisos de *shell* (como `adb shell`) | archivos (almacenamiento compartido), comandos (`pm`, `am`, `dumpsys`, `settings get`…), pantalla (`uiautomator`, `input`, `screencap`) |
| **iPhone** (jailbreak) | `mobile/ios-helper/jeancode_helper.py`, un servicio local de Python, y `jeancode-hid` para la pantalla | archivos y comandos como el usuario `mobile`; pantalla **experimental** (capturas, toques, deslizar, teclas, abrir apps) |

## Android

1. **Modo desarrollador**: Ajustes → Información del teléfono → toca 7 veces *Número de compilación*. Después, en
   *Opciones de desarrollador*, activa **Depuración inalámbrica**.
2. Instala **Shizuku** (Google Play o GitHub) y pulsa **Iniciar** (vía depuración inalámbrica). Hay que repetirlo
   tras cada reinicio del teléfono.
3. En JeanCode → **Móvil** → **Dar permiso en Shizuku** y acéptalo.
4. Elige la carpeta de trabajo (por defecto `/sdcard/JeanCode`) y, si quieres, **Controlar la pantalla**.

El proceso con permisos de shell no escucha en ningún puerto: Shizuku solo entrega su conexión a la app a la que diste
permiso. Puedes quitar el permiso en Shizuku cuando quieras.

## iPhone con jailbreak

1. Instala **python3** desde Sileo o Zebra (Procursus).
2. Copia la carpeta `mobile/ios-helper` al iPhone y, como root (NewTerm o SSH): `sudo sh install.sh`. Funciona con
   jailbreaks *rootless* (`/var/jb`) y *rootful*. Se queda en marcha con `launchd`.
3. El instalador imprime un **token**: pégalo en JeanCode → **Móvil**.

### Pantalla del iPhone (experimental)

iOS no trae ninguna forma de tocar la pantalla ni de hacer capturas desde un comando. Con jailbreak se hace con
APIs privadas, como `simulatetouch` y los grabadores de pantalla: `jeancode-hid.m` inyecta toques, deslizamientos y
teclas con IOKit (`IOHIDEventSystemClient`) y captura la pantalla con `CARenderServerRenderDisplay`. Las apps se
abren con `uiopen`.

- `install.sh` lo **compila en el propio iPhone** (`build-hid.sh`) si tienes **clang**, **ldid** (Procursus) y un
  **SDK de iOS** (por ejemplo, el de Theos en `/var/mobile/theos/sdks`), y lo firma con `jeancode-hid.entitlements`.
  Si falta algo, lo dice y el agente funciona sin pantalla.
- iOS no deja leer los controles de otras apps sin un tweak, así que el agente trabaja **con capturas**: hace falta un
  modelo que vea imágenes. `type_text` solo escribe ASCII.
- **No está probado en un iPhone real** (no se puede compilar para iOS desde Windows). Si `jeancode-hid size` falla,
  el agente recibe el motivo. Si los toques no llegan, prueba a ejecutar el ayudante como root (`UserName root` en el
  plist).

El ayudante escucha solo en `127.0.0.1:47322`, exige el token (32 bytes aleatorios, archivo con permisos 600) y
rechaza peticiones de páginas web. `sudo sh uninstall.sh` lo quita.

## Cómo trabaja

- Es el **mismo agente que el del PC**, con las mismas herramientas de archivos y comandos (y las de pantalla en
  Android). Sabe en qué teléfono está y qué no debe tocar.
- **Permisos**: *Preguntar todo* (cada escritura y comando pide permiso) o *Editar sin preguntar* (los comandos siguen
  preguntando). Los comandos destructivos preguntan siempre, también los del teléfono: desinstalar o borrar datos de
  apps (`pm uninstall`, `pm clear`), reiniciar, `setprop`, ajustes de seguridad o red, bloqueo, administración del
  dispositivo y servicios de iOS (`launchctl unload`…).
- **Archivos**: siempre dentro de la carpeta de trabajo; las rutas del modelo nunca se interpretan como comandos.
  Borrar mueve a `.papelera` dentro de esa carpeta.
- **Pantalla** (Android): `inspect_screen` lista los controles con sus coordenadas (uiautomator), `screenshot` manda una
  captura reducida si tu modelo ve imágenes, y toca, desliza, escribe y abre apps con `input`, `am` y `monkey`. En el
  iPhone (experimental), solo con capturas. Activar **Controlar la pantalla** ya autoriza lo de riesgo bajo y medio
  (tocar, deslizar, abrir apps, atrás/inicio); lo de riesgo alto pregunta siempre. Mientras el agente maneja otras apps,
  JeanCode queda en segundo plano y, si necesita preguntarte algo, vuelve al frente.
- **Procesos en segundo plano** (`start_process`, `process_output`, `stop_process`): servidores o *watchers* en su propio
  grupo de procesos (`setsid`), con la salida en `.jeancode-proc/` dentro de la carpeta de trabajo. Como mucho 4 a la vez.
- **`webfetch`** con la red nativa de la app (sin CORS), igual que en el PC: pide permiso con la URL y no abre direcciones
  locales ni de redes privadas.

## Código

- `web/js/mobile/device.js`: el ayudante de cada plataforma (`exec`, `readFile`, `writeFile`, `screenshot`).
- `web/js/mobile/shim.js`: el "escritorio" que ve el agente (archivos y comandos) y la pantalla de Android.
- `web/js/mobile/agent-ui.js`: la pestaña Móvil.
- Android: `JeanDevicePlugin.java` (plugin de Capacitor) y `JeanShellService.java` + `IJeanShell.aidl` (proceso con
  permisos de shell vía Shizuku).
- iPhone: `mobile/ios-helper/`.
- Pruebas: bloque «móvil» de `tests/unit.test.mjs` (incluye el ayudante de Python de verdad).
