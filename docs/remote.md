# Control remoto: maneja el agente del PC desde el móvil

Como Remote Control de Claude Code: el agente sigue trabajando **en tu PC** (tus archivos, tus comandos, tus
modelos) y desde el móvil —la web de JeanCode o la app de Android/iOS— ves sus conversaciones en vivo, le escribes,
lo paras, cambias entre PLAN y BUILD o los permisos, y **apruebas o rechazas sus diálogos de permiso**. Lo que
respondas primero, en el PC o en el móvil, es lo que vale.

## Activarlo

1. En el PC: **Ajustes → Comportamiento → Control desde el móvil** → *Permitir el control desde móviles emparejados*.
2. **Emparejar un móvil** muestra un QR (y un enlace). Escanéalo con la cámara del móvil —abre JeanCode web— o, en la
   app, **PC → Escanear QR** (o pega el enlace). El código sirve una vez y caduca a los 10 minutos.
3. El PC te pregunta si aceptas ese móvil. Al aceptar, el móvil recibe **su propia clave** y se conecta solo.
   En el móvil no hace falta configurar ninguna API: el modelo es el del PC.

Los móviles emparejados aparecen en el mismo apartado, con su estado (Wi-Fi, P2P, relay) y un botón **Quitar** que
revoca su clave al instante.

## Cómo se conecta

| CAMINO | CUÁNDO | POR DÓNDE PASAN LOS DATOS |
|---|---|---|
| **Wi-Fi directa** | móvil y PC en la misma red | directamente del móvil al PC (`ws://IP-del-PC:47321`) |
| **P2P (WebRTC)** | desde fuera de casa | directamente entre los dos; el Worker solo presenta a uno al otro |
| **Relay** | si la red bloquea WebRTC | a través de **tu** Worker de Cloudflare |

El móvil prueba primero la Wi-Fi (todas las IPs del PC a la vez) y, si no, entra por el Worker e intenta subir a
P2P; si no lo consigue en unos segundos, se queda en relay. Para usarlo desde fuera necesitas desplegar el Worker de
[`relay/`](../relay/README.md) (gratis) y poner su URL en el PC.

En la **web** (https) los navegadores no dejan abrir la conexión directa a la IP del PC, así que la web usa siempre
el camino de internet; las **apps** de Android e iOS sí usan la Wi-Fi directa.

## Seguridad

- **Cifrado de extremo a extremo** (AES-256-GCM con claves derivadas por HKDF). Ni la Wi-Fi, ni el Worker, ni los
  servidores STUN pueden leer ni falsificar nada. Cada conexión intercambia nonces nuevos y cada mensaje lleva un
  número de secuencia: un mensaje grabado no se puede repetir, ni reenviar en otra conexión, ni devolver al revés.
- **Una clave por móvil**, guardada cifrada en el PC (llavero del sistema). En el móvil se guarda en el
  almacenamiento de la app o del navegador. Quitar un móvil en el PC lo deja fuera para siempre.
- **El código de emparejamiento** es de un solo uso, caduca a los 10 minutos y, aun así, el PC pide confirmación.
  Solo se puede aceptar en el PC, nunca desde otro móvil. El enlace se borra del historial del móvil al usarlo.
- **El Worker** solo ve un identificador de sala derivado de la clave (no la clave) y marcos cifrados. Exige tu
  `RELAY_KEY` para entrar (va dentro del código de emparejamiento); sin ella configurada, el control remoto no se abre.
- **El móvil tiene los mismos límites que tú en el PC**: los permisos, los comandos destructivos que siempre preguntan,
  los hooks… nada cambia por manejarlo a distancia.
- El servidor de la Wi-Fi solo escucha mientras el control remoto está activado. Una conexión que no se identifica
  con una clave válida en 8 segundos se cierra; como mucho 8 móviles, 4 conexiones sin identificar y 3 por dirección,
  2 MB por mensaje. La primera vez Windows puede preguntar si permites que JeanCode use la red privada: acéptalo para la
  conexión directa.
- Solo funciona con JeanCode abierto en el PC.

## Protocolo

Ya dentro de la sesión cifrada (`web/js/remote/host.js`):

- móvil → PC: `pair`, `state`, `threads`, `open {id}`, `send {text, thread}`, `stop`, `new`, `perm {value}`,
  `agent {value}`, `answer {id, value}`
- PC → móvil: `paired`, `state`, `threads`, `thread`, `event {ev}` (respuesta en curso, herramientas, tareas,
  avisos), `confirm` / `confirm-done`, `error`

## Código

- `web/js/remote/crypto.js`: claves, sesión cifrada, código de emparejamiento.
- `web/js/remote/link.js`: transportes (Wi-Fi, relay, WebRTC) y el saludo; `HostAcceptor` en el PC.
- `web/js/remote/host.js`: lado PC (emparejar, salas, órdenes, diálogos de permiso compartidos).
- `web/js/remote/phone.js`: lado móvil (pestaña **PC**).
- `desktop/lib/remote-lan.js`: servidor WebSocket de la Wi-Fi (no descifra nada).
- `relay/worker.js` (`RemoteRoom`): sala de encuentro y relay en Cloudflare.
- Pruebas: bloque «remoto» de `tests/unit.test.mjs`.
