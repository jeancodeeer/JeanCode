**CODE: pestaña EJECUTAR (web, móvil y escritorio)**
- La antigua «Vista previa» ahora es **EJECUTAR** y corre el **proyecto entero**, no un archivo suelto: una página HTML carga sus CSS (con `@import` y `url()`), sus JS clásicos y módulos ES encadenados, `fetch()`/XHR de archivos del proyecto (JSON, texto…), SVG, `localStorage` (se conserva entre ejecuciones) y los enlaces a otras páginas del proyecto.
- Lenguajes en el navegador y el móvil: HTML, JavaScript tipo Node (`require` de los archivos del proyecto, `fs`, `path`, `readline`…), Python (Pyodide, con `import` de tus módulos, `open()` de tus archivos, `input()` y paquetes de `requirements.txt` cuando se puede), Batch (`.bat`/`.cmd` con un intérprete propio: echo, set /a /p, if, for, goto, call, choice, pause…), Markdown y SVG.
- En el escritorio, además, se ejecuta con el programa de tu PC (Python, Node, TypeScript, cmd, PowerShell, bash, Ruby, PHP, Lua, Perl, R, Go, Java, C, C++, Rust, Dart, Swift…) sobre una copia temporal del proyecto, siempre pidiendo permiso. Selector PC/Navegador cuando hay las dos opciones; si falta el programa, se usa el navegador.
- Selector del archivo de entrada; abrir `styles.css` o `app.js` mantiene la página que los usa. Consola con los `console.log` y errores (con `archivo:línea`), Reiniciar y Detener.
- Todo corre aislado (iframe con origen opaco): el código del proyecto no ve tus claves ni tu historial.

**Aviso de versión nueva (escritorio y móvil)**
- Al abrir la app, al volver a ella y cada 6 horas se comprueba la última versión publicada. Si hay una nueva aparece una pantalla con el número (1.2.3, 1.3.0…), si es de correcciones, de novedades o mayor, las novedades y el botón para descargar el archivo de tu plataforma (.exe, .dmg, .AppImage, .apk o .ipa). «Más tarde» vuelve a avisar al día siguiente; «Omitir esta versión» no vuelve a avisar de esa. La web no lo necesita: se actualiza sola.

**Modo de razonamiento según el modelo**
- El botón RAZONAR es ahora un selector con lo que admite el modelo elegido: Normal y Pensar (Jean, Qwen), o Esfuerzo bajo/medio/alto (OpenAI o-series y GPT-5 —también «mínimo»—, gpt-oss, Gemini 2.5, Grok 3 mini, Claude con razonamiento, OpenRouter). Se recuerda por modelo. Los modelos que razonan siempre (DeepSeek R1…) lo indican.

**Respuestas que aparecen poco a poco**
- El texto se muestra palabra a palabra a ritmo constante, aunque el proveedor lo mande a trozos o de golpe (sin animación si el sistema pide movimiento reducido).
- El razonamiento se ve en directo («PENSANDO… 3,2 s»), se pliega solo al empezar la respuesta y queda como «RAZONÓ 4,1 s».
- Agente: cada herramienta aparece en cuanto empieza, con el comando (`$ npm test`) o el archivo, un indicador mientras corre, la duración y ✓/✕ al terminar. En CODE, el archivo que se está escribiendo dice «escribiendo… N líneas».
