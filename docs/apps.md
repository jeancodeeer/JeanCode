# Conexiones con otras apps (MCP)

JeanCode de escritorio conecta el agente con tus apps mediante **MCP** (Model Context Protocol), el mismo estándar que usa Claude Code. Cada conexión añade herramientas al agente con el nombre `mcp__<app>__<herramienta>`.

**Ajustes → Apps** trae un catálogo de 41 conexiones. Todas se comprobaron en vivo (noviembre de 2026):

| TIPO | CÓMO SE CONECTA | EJEMPLOS |
|---|---|---|
| **Sin cuenta** | un clic | DeepWiki, Context7, Cloudflare Docs, Hugging Face |
| **Un clic + autorizar** | se abre el navegador y autorizas en la web del servicio (OAuth con registro automático) | Notion, Linear, Jira/Confluence, Asana, Sentry, Figma, Canva, Supabase, Neon, Netlify, Zapier, PayPal… |
| **Con token** | pegas un token del servicio | GitHub (token personal), Stripe (clave restringida) |
| **Google** | tu propio cliente de Google Cloud, una vez (abajo) | Gmail, Drive, Calendar, Docs, Sheets, Slides, Chat, Tasks, Keep, Meet |
| **En esta PC** | un programa local (`npx`/`uvx`) que confirmas al añadirlo | carpetas, memoria, navegador Playwright, Chrome DevTools, Git, Fetch |

En **Otro servidor MCP** puedes añadir cualquiera: una URL `https://…/mcp` (con token opcional) o un comando local.

## Seguridad

- Cada uso de una herramienta **pide permiso** y muestra exactamente qué se enviará. Puedes marcar «permitir siempre» por herramienta.
- En modo **PLAN** y en subagentes de solo lectura solo se usan herramientas que el servidor declara de solo lectura.
- Tokens OAuth, tokens y cabeceras se guardan **cifrados** con el llavero del sistema (`mcp.json` en la carpeta de datos de JeanCode). Sin llavero no se escriben en disco.
- La autorización OAuth usa PKCE y `state`, y vuelve a `http://127.0.0.1:33418/oauth/callback` (solo tu PC).
- Lo que devuelve una app son **datos**: el agente tiene instrucciones de no obedecer órdenes que aparezcan en un correo, un documento o una issue.
- Los servidores locales solo se añaden desde Ajustes, nunca desde un archivo del proyecto.

## Google

Google publica servidores MCP oficiales (`gmailmcp.googleapis.com`, `drivemcp…`, `calendarmcp…`, etc.), pero su OAuth no permite el registro automático: cada usuario necesita un cliente propio, gratis, que se crea una vez y sirve para las diez apps.

1. En [Google Cloud Console](https://console.cloud.google.com/), crea un proyecto (o usa uno).
2. **APIs y servicios → Biblioteca**: activa las APIs de las apps que vayas a usar (Gmail API, Google Drive API, Google Calendar API…).
3. **Pantalla de consentimiento de OAuth**: tipo *Externo*, en modo *Prueba*, y añádete como **usuario de prueba**.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → App de escritorio**. Copia el ID y el secreto.
5. En JeanCode: **Ajustes → Apps → Gmail (o la que quieras) → Añadir**, pega el ID y el secreto, y autoriza en el navegador.

Mientras la app de Google Cloud esté en modo *Prueba*, solo los usuarios de prueba pueden autorizarla, y Google puede pedir volver a autorizar cada 7 días.

## Para desarrolladores

- Cliente: `desktop/lib/mcp.js` (SDK oficial `@modelcontextprotocol/sdk`), transportes Streamable HTTP y stdio.
- Catálogo: `web/js/connectors.js` (una entrada por conexión).
- Pruebas reales con servidores hechos con el SDK: `node --test tests/mcp/mcp.test.mjs`.
