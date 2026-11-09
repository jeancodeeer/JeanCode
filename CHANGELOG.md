# Historial de JeanCode

JeanCode 1.0 reúne en una sola versión todo lo que se publicó por partes entre la 0.1 y la 0.4. Las releases antiguas se retiraron de GitHub para que solo quede una descarga oficial. Su código sigue completo en las etiquetas de git (`v0.1.0` … `v0.4.2`), así que cualquier build anterior se puede reconstruir con `git checkout vX.Y.Z && cd desktop && npm ci && npm run dist`.

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
