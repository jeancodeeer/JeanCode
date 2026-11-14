# Contribuir a JeanCode

Gracias por querer ayudar. JeanCode es un cliente sin backend: todo lo que hagas debe seguir funcionando sin servidor propio y sin enviar datos a nadie que el usuario no haya elegido.

## Empezar

```bash
python -m http.server 8000 --directory web      # la web, sin paso de build
cd desktop && npm install && npm start          # el escritorio (Electron)
node --test tests/unit.test.mjs                 # pruebas
```

Lee [AGENTS.md](AGENTS.md): son las reglas del proyecto (rutas siempre dentro del espacio de trabajo, permisos antes de escribir o ejecutar, ninguna URL ni clave en los archivos, una sola interfaz en `web/`).

## Antes de abrir un pull request

- Cambios pequeños y con una prueba que los cubra (`tests/unit.test.mjs`, o `tests/computer/` y `tests/mcp/` si tocas esas partes).
- `cd desktop && npm run check` sin errores.
- Si cambia algo visible, añade una línea al [CHANGELOG](CHANGELOG.md).
- Nada de telemetría, analítica ni dependencias que llamen a casa.

## Por dónde empezar

Busca los issues con la etiqueta [`good first issue`](https://github.com/jeancodeeer/JeanCode/labels/good%20first%20issue). Las traducciones de la interfaz y las pruebas en macOS/Linux son especialmente bienvenidas.

Al contribuir aceptas publicar tu aportación bajo la licencia del proyecto ([MIT](LICENSE)).
