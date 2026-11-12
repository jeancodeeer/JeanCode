# Las 100 quejas habituales sobre los chats de IA, y JeanCode

Estado de cada mejora de la lista. **Hecho** = implementado y probado en la app; **Ya estaba** = existía antes; **No aplica** = depende de un servicio con cuentas, planes o servidores que JeanCode no tiene (es un cliente local sin backend); **Pendiente** = tiene sentido pero aún no está.

| # | Mejora | Estado | Dónde / cómo |
|---|---|---|---|
| 1 | Mostrar incertidumbre, fuente en afirmaciones fácticas | Hecho | Principios de respuesta en el prompt (`web/js/quality.js`) |
| 2 | Verificar que las citas existan | Hecho | Botón «Verificar enlaces» en cada respuesta: ✓ responde · ⚠ no responde (nunca hacia la red local, sin parámetros ni redirecciones) |
| 3 | Avisos médicos/legales y derivación | Hecho | Principios de respuesta: una vez, sin sermón |
| 4 | Cálculos con herramienta | Hecho / parcial | El prompt exige mostrar el cálculo; el agente lo ejecuta con `run_command` |
| 5 | Fecha de corte | Hecho | Fecha de hoy en el prompt + aviso de datos que pueden estar desactualizados |
| 6 | Coherencia con el historial | Hecho (prompt) | No hay un verificador automático aparte |
| 7 | Resumen con fuente por punto | Pendiente | |
| 8 | Ejecutar el código antes de entregarlo | Ya estaba | Diagnósticos tras cada edición del agente |
| 9 | Traducciones con variantes | Hecho (prompt) | |
| 10 | Decir "no sé" | Hecho (prompt) | Entrenar los modelos Jean en abstención: plan de entrenamiento |
| 11 | Pedir aclaración si es ambiguo | Hecho (prompt) | |
| 12 | Utilidad sobre apariencia | Hecho (prompt) | |
| 13 | Menos adulación, franqueza ajustable | Hecho | Ajustes → Comportamiento → Franqueza |
| 14–15 | Control de longitud en ambos sentidos | Hecho | Ajustes → Longitud (corta / según la tarea / larga) |
| 16 | Explicar rechazos con alternativa | Hecho (prompt) | |
| 17 | Menos sermones | Hecho (prompt) | |
| 18 | Reinyectar instrucciones fijadas | Ya estaba | Reglas fijadas en cada envío, también tras compactar |
| 19 | Avisar de cambios de modelo | Hecho | Aviso cuando un proveedor añade o retira modelos |
| 20 | Variar el formato | Hecho (prompt) | |
| 21 | Resumen progresivo visible y editable | Ya estaba | Compactación con el resumen visible |
| 22–23 | Panel de memoria, memoria opt-in | Ya estaba | No hay memoria oculta: solo AGENTS.md y reglas fijadas, que escribes tú |
| 24 | Compactar en vez de bloquear | Hecho | Se resume sola al 85 % (desactivable) y muestra el resumen |
| 25 | Indicador de contexto | Ya estaba | Con la ventana real de cada modelo |
| 26 | Espacios por proyecto | Hecho / parcial | Las conversaciones del agente llevan su carpeta |
| 27 | Notas fijadas | Ya estaba | Reglas fijadas |
| 28 | Resumen de reentrada | Hecho | "Resumir dónde nos quedamos" al abrir una conversación de hace días |
| 29–30 | Menús simples, modelo mental único | Hecho / parcial | Paleta de comandos con todas las acciones (Ctrl+Shift+P) |
| 31 | "Regenerar con…" | Hecho | Otra vez, más corta, más detallada, más sencilla, revisar errores, con otro modelo |
| 32 | Ramas navegables | Hecho / parcial | Versiones ‹ 1/3 › de cada respuesta regenerada |
| 33 | Búsqueda de texto completo | Hecho | Buscador del historial (Ctrl+Shift+F) |
| 34 | Organización | Hecho | Fijar y archivar conversaciones (sin carpetas) |
| 35 | Copiar como Markdown, texto o CSV | Hecho | Botones en cada respuesta y en cada tabla |
| 36 | Tablas y código que desbordan | Hecho | Desplazamiento horizontal y AMPLIAR en código largo |
| 37 | Scroll que salta | Ya estaba | Solo sigue el final si ya estabas abajo |
| 38 | Parar conservando lo generado | Ya estaba | |
| 39 | Paleta de comandos | Hecho | Ctrl+Shift+P |
| 40 | Contraste | Ya estaba | Paleta con contraste AA (DESIGN.md) |
| 41 | Paridad en móvil | Parcial | El agente y el control del equipo necesitan escritorio |
| 42 | Exportar Markdown, PDF, JSON | Hecho | `/export md · json · pdf` y paleta |
| 43 | Respuestas lentas | Hecho | Contador "esperando al modelo… N s" y sugerencia de uno más rápido |
| 44 | Voz | No aplica | JeanCode no tiene voz |
| 45, 47 | Virtualizar mensajes, menos RAM | Hecho | Se pintan los 60 últimos; "Mostrar anteriores" |
| 46 | Menos peticiones de red | Ya estaba | Historial en IndexedDB agrupado; apps conectadas en diferido |
| 48, 90 | Reanudar un streaming cortado | Hecho | Se conserva lo recibido y "Continuar la respuesta" |
| 49 | Errores con causa y acción | Ya estaba | Diagnóstico por tipo de error y `/doctor` |
| 50 | Estado del servicio | Ya estaba | Estado por conexión y `/doctor` |
| 51, 53, 55, 56, 57 | Planes, cobros, pruebas | No aplica | JeanCode es gratis y no tiene cuentas ni planes |
| 52 | Medidor de consumo | Ya estaba | Tokens por respuesta y coste de la sesión |
| 54 | Estimar antes de enviar | Hecho | "≈ N tokens · $x" junto al campo de texto |
| 58, 99 | Qué modelo respondió | Hecho | Etiqueta del modelo en cada respuesta (también si el respaldo cambió de modelo) |
| 59, 60, 62, 64 | Entrenamiento, retención, enlaces, inicio de sesión | No aplica / ya estaba | Sin servidor ni cuentas: todo queda en tu equipo y "Borrar todo" lo borra |
| 61 | Datos sensibles antes de enviar | Hecho | Aviso con claves, tokens, contraseñas, tarjetas (Luhn) e IBAN si van a un modelo remoto |
| 63 | Cifrado del historial | Pendiente | Las claves sí van cifradas en el escritorio |
| 65 | Contenido no confiable | Ya estaba | Datos ≠ órdenes en el prompt del agente |
| 66 | Confirmación en acciones | Ya estaba | Permisos por herramienta, apps y control del equipo |
| 67–74 | Archivos, PDFs, imágenes, documentos | Ya estaba / parcial | Skills de PDF, Word, Excel y PowerPoint; el resto no aplica (no genera imágenes) |
| 75–78 | Búsqueda web | No aplica | JeanCode no tiene buscador propio; `webfetch` pide permiso con la URL |
| 79 | Estado de las integraciones | Ya estaba | Ajustes → Apps con estado y error de cada conexión |
| 80 | OAuth que caduca | Ya estaba | El SDK de MCP renueva el token con el refresh token |
| 81 | Resultados de herramientas resumidos | Ya estaba | Línea plegable por herramienta |
| 82 | Bucles de herramientas | Ya estaba | Detector de bucles y límite de pasos |
| 83 | Diagnóstico de conexión | Ya estaba | Probar conexión y `/doctor` |
| 84 | Proxy que almacena el streaming | Hecho | Se detecta cuando la respuesta llega de golpe y se avisa |
| 85 | Navegadores antiguos | Hecho | Mensaje claro en vez de una página en blanco |
| 86–89 | Docker, MongoDB, SSL, voz | No aplica | |
| 91, 93, 95 | Cola local, memoria de GPU, recomendador | Ya estaba / parcial | Hugging Face indica si un GGUF cabe en la RAM; sugerencias de Ollama |
| 92, 94 | Errores de carga y plantillas | Ya estaba | Mensajes por tipo de error |
| 96 | Lectores de pantalla y streaming | Hecho | La respuesta se marca ocupada mientras llega y se anuncia al terminar |
| 97 | Localización | Pendiente | La interfaz está en español |
| 98 | Voz | No aplica | |
| 100 | Registro de cambios en la app | Hecho | Más → Novedades; se abre solo tras actualizar |
