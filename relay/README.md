# Relay CORS propio (Cloudflare Workers, gratis)

Algunas APIs (NVIDIA NIM, SambaNova, DeepSeek, Mistral, xAI, Scaleway…) rechazan las llamadas que salen de una página web. La app de escritorio no tiene ese problema, y si conectas tu **Jean-API-Generator** su router (puerto 8899) ya hace de relay. Si no lo usas, este Worker de ~80 líneas hace lo mismo en **tu** cuenta de Cloudflare: nadie más ve tus peticiones.

## Tres pasos

```bash
cd relay
npx wrangler deploy                 # te pide iniciar sesión en Cloudflare la primera vez
npx wrangler secret put RELAY_KEY   # inventa una clave larga y pégala
```

`wrangler deploy` imprime la URL (`https://jeancode-relay.<tu-usuario>.workers.dev`). En JeanCode web o en el móvil: **Ajustes → Conexiones → Relay para APIs que bloquean la web**, pega la URL y la `RELAY_KEY`.

Sin terminal: en el panel de Cloudflare, **Workers → Create → Hello World**, pega `worker.js`, guarda y añade la variable secreta `RELAY_KEY` en **Settings → Variables**.

## Qué hace y qué no

- Solo reenvía a una lista fija de proveedores conocidos (la misma que el Generator). Para una API propia, añade su host a la variable `RELAY_HOSTS`.
- Solo https, sin seguir redirecciones, sin guardar nada. La clave del proveedor viaja sin tocarse; tu `RELAY_KEY` no se reenvía.
- Mantiene el streaming: las respuestas llegan poco a poco igual que en directo.
- El plan gratuito de Workers da 100 000 peticiones al día.
