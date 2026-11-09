# Product

<!-- impeccable:product-schema 1 -->

> Escrito sin entrevista: el usuario pidió trabajar de forma autónoma sin pedir aprobación por cada detalle (2026-11-09). Lo marcado *(inferido)* sale del código y de sus mensajes, no de una confirmación explícita.

## Platform

web

(La app de escritorio es Electron y reutiliza la misma interfaz web; la versión móvil es la web responsive.)

## Users

Programadores y vibecoders hispanohablantes que prefieren una interfaz gráfica antes que una terminal para trabajar con modelos de lenguaje. Llegan con su propia API (un Codespace de Jean-API-Generator, un proveedor como OpenAI/OpenRouter/Groq, o modelos locales con Ollama/LM Studio) y quieren chatear, generar proyectos descargables o dejar que un agente trabaje en una carpeta de su PC. Usan la web en el móvil con frecuencia *(confirmado por capturas del usuario desde un iPhone)*.

## Product Purpose

JeanCode es el cliente de los modelos Jean (Grey, Marvel, Fénix) y de otras APIs compatibles con OpenAI. Tres modos: CHAT (conversación), CODE (genera proyectos completos descargables en .zip, sin tocar la PC) y AGENT (solo escritorio: agente al estilo Claude Code dentro de una carpeta, con permisos, checkpoints, subagentes, skills y hooks). Éxito: que alguien sin terminal pueda conectar su API en un minuto y producir código útil.

## Positioning

- Sin servidor ni cuenta: cada usuario trae su API; JeanCode no ve sus datos ni sus claves.
- Puente directo con Jean-API-Generator: detecta sus puertos, carga modelos de Hugging Face en el Codespace y se conecta a Fénix.
- Corrige quejas concretas de Claude Code y OpenCode (compactación transparente, consumo visible, checkpoints que cubren comandos, permisos por comando exacto, interfaz sin CDN).

## Operating Context

- Web en GitHub Pages (https://jeancodeeer.github.io/JeanCode/), instalable como PWA y usable sin conexión.
- Escritorio Electron (Windows, macOS, Linux) desde GitHub Releases.
- Los modelos Jean corren en CPU (Codespace de 16 GB): las respuestas son lentas; el interruptor RAZONAR existe por eso.

## Capabilities and Constraints

- Ninguna URL ni clave en el repositorio; todo se guarda en el equipo del usuario (en escritorio, cifrado con el llavero del sistema).
- `web/` es la única interfaz; `desktop/` la copia. Cualquier rediseño vale para las dos.
- Funcionalidades que no se pueden perder: splash de conexión con proveedores y modelos locales, selector de modelos agrupado, CHAT/CODE/AGENT, comandos `/`, menciones `@`, medidor de contexto, RAZONAR, panel de Hugging Face, sección Fénix, ajustes (conexiones, modelos locales, estilo, reglas fijadas, comandos permitidos), skills, descargas, info del repo, ayuda.
- Logo pendiente: hay huecos marcados hasta que el usuario suba uno (`BRAND.logo` en `web/js/config.js`).

## Brand Commitments

- Nombre: **JeanCode** (estilizado así; el usuario rechazó «jeancode» en minúsculas).
- Dirección visual pedida explícitamente por el usuario: estética **OPIUM** (oscura, experimental, industrial, rebelde, vanguardista) + **neobrutalismo** (geometrías contundentes, contrastes marcados) + **minimalismo funcional** (menos ruido, mejor jerarquía). Fondo negro con títulos y detalles blancos. Tipografías **IBM Plex** «inspiradas en Yeezy». No debe parecer una plantilla SaaS genérica.
- El usuario dijo que le gusta el **relleno con ruido** del wordmark y el **grano de fondo**.
- El usuario dijo que el diseño actual es **demasiado cargado y abrumador**, y que en el móvil se desborda.

## Evidence on Hand

- Capturas del usuario: splash en escritorio (título desbordado, superado) y en iPhone (formulario desbordado hacia la derecha, marco cortado).
- No hay testimonios, clientes, métricas de uso ni logo: no inventarlos.

## Product Principles

1. Primero el trabajo: la pantalla principal es el cliente; todo lo demás es secundario y se alcanza sin estorbar.
2. Una sola decisión por pantalla: menos controles visibles a la vez, más por contexto.
3. Transparencia: lo que hace el modelo o el agente (consumo, permisos, cambios) siempre a la vista, nunca escondido.
4. Tu equipo, tus datos: nada sale del dispositivo salvo hacia la API que el usuario eligió.
5. Funciona en el móvil con una mano tanto como en un escritorio.

## Accessibility & Inclusion

Interfaz en español. Contraste alto por la dirección en blanco y negro; respetar `prefers-reduced-motion`, foco visible y objetivos táctiles de al menos 44 px en móvil *(inferido de la petición de usabilidad móvil)*.
