# Historial de JeanCode

JeanCode 1.0 reúne en una sola versión todo lo que se publicó por partes entre la 0.1 y la 0.4. Las releases antiguas se retiraron de GitHub para que solo quede una descarga oficial. Su código sigue completo en las etiquetas de git (`v0.1.0` … `v0.4.2`), así que cualquier build anterior se puede reconstruir con `git checkout vX.Y.Z && cd desktop && npm ci && npm run dist`.

## Próxima versión (en `main`, ya en la web)

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
