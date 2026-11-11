# Historial de JeanCode

JeanCode 1.0 reúne en una sola versión todo lo que se publicó por partes entre la 0.1 y la 0.4. Las releases antiguas se retiraron de GitHub para que solo quede una descarga oficial. Su código sigue completo en las etiquetas de git (`v0.1.0` … `v0.4.2`), así que cualquier build anterior se puede reconstruir con `git checkout vX.Y.Z && cd desktop && npm ci && npm run dist`.

## Próxima versión (en `main`, ya en la web)

**Optimización (medida)**
- **Historial en IndexedDB** en lugar de localStorage. Antes cada mensaje reescribía todas las conversaciones (con 60 conversaciones del agente, 11 MB por guardado) y, al pasar el límite de ~5 MB del navegador, el historial dejaba de guardarse sin avisar. Ahora cada conversación se guarda aparte, solo si cambió, agrupando los guardados seguidos: 3,7 ms por guardado y 50 guardados durante una respuesta = 1 escritura. Las capturas de pantalla viejas y el prompt del sistema no se guardan y los resultados antiguos de herramientas se recortan. La migración desde localStorage es automática y, si algo falla al guardar, se avisa.
- **Arranque del escritorio**: el SDK de MCP se cargaba al abrir la app (0,5 s en caliente, 3,8 s en frío) aunque no usaras ninguna app conectada; ahora se carga la primera vez que se usa (14 ms). Las apps conectadas se activan 3 s después de abrir, sin competir con el arranque.

**Control de la PC más fiable para modelos pequeños**
- `click_element` y `set_text` por **nombre** (sin tildes ni mayúsculas); los campos sin nombre se encuentran por su etiqueta vecina; si no existe, el error sugiere los controles que sí hay.
- **OCR de Windows**: `read_text` lee el texto de cualquier app (aunque no exponga controles) y `click_text` hace clic sobre un texto visible; sin necesidad de un modelo con visión. Amplía la imagen hasta ×3 para leer palabras sueltas de botones.
- `wait_for` espera a que aparezca un texto en vez de esperar a ciegas.
- Cada acción informa qué **cambió** en la ventana (qué apareció y qué desapareció), para verificar sin adivinar.

**100 skills y automatizaciones como en Claude Code**
- **Catálogo de 100 skills** (Skills → Catálogo): Word, PDF, Excel y PowerPoint; TDD, depuración y planes; revisión de código; React, Next.js, Python, Go y Rust; APIs y bases de datos; DevOps; seguridad (Trail of Bits); IA y Hugging Face; análisis de datos. Elegidas de repositorios con licencia abierta y descargadas de GitHub al instalarlas, con sus scripts. Las 100 se comprobaron instalándolas.
- **Hooks** como los de Claude Code: `session_start`, `user_prompt`, `pre_tool`, `post_tool`, `post_edit`, `stop` y `post_turn`, con filtro por herramienta, JSON por la entrada estándar, bloqueo con código de salida 2 o decisión en JSON. Hooks globales en Ajustes.
- **Tareas programadas** (Más → Automatizaciones): el agente trabaja solo cada cierto tiempo o a una hora; lo que necesitaría permiso se deniega y se informa.
- **`/loop 10m <mensaje>`** repite un mensaje cada intervalo.
- Guía: `docs/automations.md`.

**Conexiones con otras apps (MCP)**
- **Ajustes → Apps**: 41 conexiones comprobadas en vivo. Google (Gmail, Drive, Calendar, Docs, Sheets, Slides, Chat, Tasks, Keep, Meet) con su servidor oficial; GitHub; Notion, Linear, Jira/Confluence, Asana, Sentry, Figma, Canva, Supabase, Neon, Netlify, Zapier, Stripe, PayPal y más; y servidores locales (carpetas, memoria, navegador Playwright, Chrome DevTools, Git).
- Mismo estándar que Claude Code (MCP, SDK oficial): servidores remotos con OAuth (se autoriza en el navegador, con PKCE) o token, y servidores locales. También se puede añadir cualquier otro servidor MCP.
- El agente recibe las herramientas como `mcp__app__herramienta`; cada uso pide permiso (con «permitir siempre» por herramienta) y en PLAN solo se usan las de solo lectura. Tokens cifrados con el llavero del sistema.
- Guía: `docs/apps.md`.

**Relay propio sin Codespace:** un Cloudflare Worker gratis (`relay/`) hace de relay CORS para la web y el móvil cuando no usas Jean-API-Generator.

**Apps de iOS y Android, y APIs que bloquean el navegador**
- **Apps de iOS y Android:** la misma web empaquetada con Capacitor (`mobile/`). Cada release incluye un APK de Android (firmado con clave de depuración) y un IPA de iOS sin firmar, para instalar con AltStore o Sideloadly.
- **CORS resuelto sin terceros:** en la web, los proveedores que rechazan llamadas desde páginas (NVIDIA NIM, SambaNova, DeepSeek, Mistral…) pasan por el relay `/relay/` de tu propio Jean-API-Generator, con streaming. En el móvil, si no hay relay, se usa la red nativa del teléfono. Un fallo por CORS de un proveedor desconocido se detecta, se reintenta y se recuerda.
- **Web móvil:** áreas seguras (muesca y barra inferior) en la pantalla de inicio y en los paneles.
- **Arreglo:** con solo proveedores de catálogo grande (NVIDIA, OpenRouter) y ningún modelo fijado, el selector decía «SIN CONEXIÓN»; ahora ofrece elegir entre sus modelos.

## 1.1.0 — 10 de noviembre de 2026

**Más proveedores y un agente que se revisa solo**
- **16 proveedores nuevos**, con URLs comprobadas en vivo:
  - NVIDIA NIM, SambaNova, DeepInfra, Hyperbolic, Novita, Nebius, Chutes, SiliconFlow e Inference.net;
  - Moonshot (Kimi), Z.ai (GLM), Alibaba Qwen, MiniMax y Cohere;
  - Scaleway e IONOS (UE);
  - LiteLLM como pasarela local hacia Azure, Bedrock o Vertex.
- **Detectar modelos de esta PC** prueba también text-generation-webui, KoboldCpp y LiteLLM.
- **Diagnósticos tipo LSP (escritorio):**
  - Tras cada escritura, el agente recibe los errores de sintaxis del archivo con su línea y los corrige.
  - Cubre JS (CommonJS y módulos ES), JSON, Python, PowerShell, Bash y Go, solo con analizadores del sistema. No ejecuta nada del proyecto, así que abrir un repositorio no confiable es seguro.
  - La herramienta `diagnostics` con `deep` añade TypeScript, ESLint y `tsc` del propio proyecto. Como eso ejecuta código del repositorio, pide permiso igual que un comando y está prohibido en modo Plan.
  - Nunca escribe en la carpeta. Se desactiva en Ajustes → Comportamiento.
- **La ventana de contexto es la del modelo:** el medidor y el aviso de compactar ya no suponen 128k para todos. Si `/models` informa la ventana (SambaNova, vLLM, LM Studio, Jean…), se usa esa; `/compact` recorta según esa ventana.
- **`/context`:** qué se envía exactamente al modelo (prompt del sistema completo, herramientas, historial, tokens de cada parte).
- **`/doctor`:** conexiones, modelo, ventana, carpeta, memoria, hooks, skills y control del equipo en una sola comprobación, con el remedio de cada fallo.
- **Coste de la sesión** cuando el proveedor informa precios (p. ej. OpenRouter).
- **Traza por subagente:** pasos, herramientas, errores, tokens y tiempo.

**Control del equipo (escritorio, Windows)** · ver `docs/computer-control.md`
- **El agente opera la PC de verdad:**
  - Ve la pantalla o lee los controles de las ventanas con UI Automation; así funciona también con modelos sin visión, como Jean.
  - Mueve el ratón, hace clic, arrastra, escribe, pulsa atajos, cambia de ventana y abre aplicaciones.
  - Lo hace en el ciclo observar → decidir → actuar → verificar.
- **Permisos por riesgo:** bajo (se permite), medio (una vez por tarea) y alto (siempre). Los comandos destructivos preguntan aunque estén permitidos y borrar va a la papelera.
- **Control visible y parada inmediata:** barra flotante, línea de estado, PAUSAR, DETENER, Esc y `Ctrl+Alt+Q`. Detener corta la acción en curso, la cola y los comandos con todos sus subprocesos.
- **Protecciones:** no opera la ventana de JeanCode (comprueba el dueño real de la ventana bajo el punto), nunca escribe contraseñas, redacta los secretos visibles y JeanCode queda fuera de las capturas.
- **Registro de acciones** sin el texto tecleado (Ajustes → Equipo).
- **Terminal y procesos:** servidores en segundo plano (`start_process`, `process_output`, `stop_process`); mover y renombrar archivos; cancelar o agotar el tiempo de un comando mata todo su árbol (antes quedaban procesos huérfanos).
- **Pruebas reales** en Windows (`tests/computer/control.test.mjs`) y de permisos del agente (`tests/unit.test.mjs`).

**Capa de APIs inteligente (fase 3)**
- **Registro de capacidades** (`web/js/capabilities.js`): un solo sitio dice qué sabe hacer cada modelo (chat, código, herramientas, visión, salida estructurada, embeddings, contexto, local o remoto, coste).
  - Primero cuenta lo que informa el endpoint: OpenRouter da contexto, precio y parámetros por modelo; `llama-server` y el router de Jean dan el contexto configurado real.
  - Después lo aprendido en uso y, al final, una tabla conservadora por familia de modelo. Lo que no se sabe queda como «desconocido».
  - Los modelos que no son de chat (embeddings, audio, imagen) ya no aparecen en el selector.
- **Adaptadores de proveedor** (`providers.js`): cada proveedor declara solo en qué se aparta del estándar OpenAI (cabeceras, parámetros, lectura de /models, tipo de coste). Agregar un proveedor es agregar una entrada.
- **Enrutado por modo** (chat, code y agente, cada uno con lo suyo): AUTO, un modelo fijo o una conexión fija.
  - AUTO explica su elección y descarta conexiones caídas, modelos sin herramientas para el agente y modelos sin contexto suficiente.
  - AUTO no usa modelos de pago salvo que lo permitas.
- **Tarjeta de ruta** junto al selector: API, MODELO, ESTADO y ENRUTADO, más qué puede hacer, contexto, coste (el precio solo si el proveedor lo informa), descartes agrupados y respaldo.
- **Respaldo configurable:**
  - Opciones: ninguno, el mismo modelo por otra conexión, tu cadena (hasta 3 modelos, p. ej. otro proveedor y luego uno local) o cualquier modelo local o propio.
  - Nunca pasa solo a un modelo de pago que no hayas elegido.
  - Solo actúa antes del primer token y ante errores de disponibilidad.
- **Salud real:** cada fallo tiene un tipo y un mensaje con qué hacer: inaccesible, clave inválida (también los 400 de Gemini y xAI), modelo inexistente, tiempo agotado, límite de uso, proveedor caído o respuesta que no es OpenAI-compatible. PROBAR hace una comprobación completa; en proveedores de pago pregunta antes de gastar ~1 token.
- **Generador de conexiones:**
  - Valida URL, autenticación y formato.
  - Corrige solo lo seguro: Ollama sin `/v1`, la capa OpenAI de Gemini y Anthropic, rutas de petición pegadas en la URL.
  - Rechaza Azure OpenAI nativo con una explicación.
  - CONFIG exporta curl y OpenCode con la clave como variable de entorno.
- **Catálogos grandes:** con más de 30 modelos (OpenRouter, 461), el selector muestra solo los que fijes con un buscador que enseña contexto, herramientas y precio. AUTO y el respaldo solo usan esos.
- **Observabilidad:** cada respuesta lleva su RUTA (petición → router → proveedor → modelo → respuesta, con tiempos y primer token), sin claves y sin el nombre del Codespace.
- **Límites de tiempo** hasta la primera respuesta: 2 min en APIs remotas y 15 min en CPU (Jean y local), en la web y en el escritorio.
- **Seguridad:**
  - El token de HF en el escritorio va cifrado con el llavero del sistema.
  - Sin llavero, las claves ya no se escriben en claro y el archivo de configuración queda solo para tu usuario.
  - Los errores que repiten parte de la clave se enmascaran.
- **Arreglos:**
  - Ollama y LM Studio (sin clave) no se podían agregar: un `required` en el campo de la clave bloqueaba el formulario.
  - Las URL tipo `localhost:11434` daban un error nativo en inglés.

- **Enrutador de APIs** (`web/js/router.js`), separado de la interfaz y de la ejecución (`api.js`):
  - **Validación antes de conectar:** URL, http frente a https, clave vacía o con espacios, clave pegada en la URL y duplicados. Si la URL es de otro proveedor, corrige el proveedor.
  - **AUTO en el selector:** chat y code empiezan por Grey; el agente, por Marvel. Las conexiones caídas se saltan.
  - **Respaldo configurable** (apagado, el mismo modelo por otra conexión o cualquier otro modelo). Solo actúa antes del primer token y solo ante errores de disponibilidad.
  - **Salud por conexión:** latencia, último error y qué puerto del Codespace está caído y por qué.
  - **Registro de conexión** sin claves en Ajustes → Datos.
- **Router del Codespace:** basta con la URL del puerto 8899 de Jean-API-Generator, que trae todos sus modelos, incluidos los cargados desde Hugging Face. Si conectas por el 8888, JeanCode descubre el router solo. Cada modelo aparece una vez.
- **El panel de Hugging Face** encuentra el control también cuando conectas por el router.
- **Errores según el proveedor** (antes todo hablaba de «JEAN_API_KEY»), con el mensaje real del servidor.
- **Ajuste automático:** si un proveedor rechaza `temperature`, `stream_options` o `chat_template_kwargs`, se reintenta sin ese parámetro.
- **Límites de tiempo** al listar modelos y en las peticiones del escritorio. Antes, un servidor colgado bloqueaba la interfaz.
- **Service worker:** revalida los archivos propios para que, justo después de publicar, nunca se mezclen módulos de dos versiones.

## 1.0.0 — versión consolidada

- **Diseño «taller de noche»:** negro puro, tinta hueso y líneas de 1 px. Hay menos carga visual y la adaptación móvil es real: cajón lateral, diálogos a pantalla completa, controles de 44 px y ningún scroll horizontal. El sistema está documentado en `DESIGN.md`.
- **Una sola versión:** `web/js/version.js` es la fuente. `scripts/version.mjs` la propaga a escritorio y al service worker, y CI rechaza cualquier copia que no coincida.
- **Versión visible:** aparece en el splash y en «Sobre JeanCode». La app de escritorio avisa cuando hay una release más nueva.
- **Pruebas unitarias** (`tests/unit.test.mjs`) en CI: archivos de CODE, rutas seguras, llamadas a herramientas, diff, escape de markdown, ZIP, proveedores y límite del espacio de trabajo.
- **Instaladores más fiables:** el workflow reintenta la descarga de Electron, que fue lo que hizo fallar la 0.4.2.
- **Menos duplicación:** la búsqueda y el glob del agente comparten un único recorrido de archivos. La búsqueda sigue sin seguir enlaces simbólicos.

## Lo que aportó cada build anterior (todo incluido en 1.0)

| Etiqueta | Aporte |
|---|---|
| v0.1.0 / v0.1.1 | Cliente web y de escritorio, modos CHAT/CODE/AGENTE, splash para tu propia API, primeros instaladores (en la 0.1.0 el empaquetado del escritorio falló; la 0.1.1 lo corrigió). |
| v0.2.0 | Primer rediseño, llamadas a herramientas nativas, botón RAZONAR. |
| v0.2.1 | Selector con todos los modelos del servidor (Grey, Marvel, Fénix), no solo el primer puerto. |
| v0.3.0 | Otras APIs (router de proveedores al estilo OpenCode) y panel de Hugging Face para cargar modelos en el Codespace. |
| v0.4.0 | Arreglos inspirados en las quejas sobre Claude Code y OpenCode: checkpoints y «volver aquí», permitir siempre, hooks con confianza, consumo visible, compactación, modelos locales (Ollama, LM Studio…). |
| v0.4.1 | Lista de permitidos endurecida frente a saltos de línea y metacaracteres. |
| v0.4.2 | Coincidencia exacta de comandos y checkpoints de git endurecidos. Sus instaladores nunca se publicaron porque falló la descarga de Electron en CI; el código está en 1.0. |
