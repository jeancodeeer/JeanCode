// Catálogo de conexiones con otras apps (servidores MCP). Comprobado en vivo en noviembre de 2026:
// cada servidor remoto respondió a "initialize" y los marcados oauth publican registro dinámico
// de clientes (se conectan con un clic: se abre el navegador para autorizar).
//
// auth:
//   none    sin cuenta
//   oauth   OAuth con registro automático: un clic, se autoriza en el navegador
//   token   una clave/token del servicio, enviada como cabecera (tokenHeader)
//   google  OAuth de Google: hace falta un cliente "App de escritorio" propio de Google Cloud (una vez)
//   local   programa en esta PC (npx/uvx); env = variables que pide
export const CATEGORIES = ['Google', 'Código', 'Trabajo', 'Diseño', 'Pagos y ventas', 'Datos e infraestructura', 'Investigación', 'En esta PC'];

const g = (id, name, desc, scopes) => ({ id, name, category: 'Google', type: 'http', auth: 'google', url: `https://${id}mcp.googleapis.com/mcp/v1`, desc, scopes });

export const CONNECTORS = [
  // ---------------------------------------------------------------- Google (servidores oficiales)
  g('gmail', 'Gmail', 'Buscar, leer y redactar correos y borradores.'),
  g('drive', 'Google Drive', 'Buscar y leer archivos de tu Drive.'),
  g('calendar', 'Google Calendar', 'Ver y crear eventos, consultar disponibilidad.'),
  g('docs', 'Google Docs', 'Leer y editar documentos.'),
  g('sheets', 'Google Sheets', 'Leer y escribir hojas de cálculo.'),
  g('slides', 'Google Slides', 'Leer y crear presentaciones.'),
  g('chat', 'Google Chat', 'Leer y enviar mensajes en espacios de Chat.'),
  g('tasks', 'Google Tasks', 'Listas de tareas.'),
  g('keep', 'Google Keep', 'Notas de Keep.'),
  g('meet', 'Google Meet', 'Reuniones de Meet.'),

  // ---------------------------------------------------------------- código
  { id: 'github', name: 'GitHub', category: 'Código', type: 'http', auth: 'token', url: 'https://api.githubcopilot.com/mcp/', tokenHeader: 'Authorization', tokenPrefix: 'Bearer ', tokenHint: 'token personal (github_pat_… o ghp_…)', tokenUrl: 'https://github.com/settings/personal-access-tokens', desc: 'Repos, issues, pull requests, Actions y código. Servidor oficial de GitHub.' },
  { id: 'sentry', name: 'Sentry', category: 'Código', type: 'http', auth: 'oauth', url: 'https://mcp.sentry.dev/mcp', desc: 'Errores y rendimiento de tus apps.' },
  { id: 'netlify', name: 'Netlify', category: 'Código', type: 'http', auth: 'oauth', url: 'https://mcp.netlify.com/mcp', desc: 'Sitios, despliegues y configuración.' },
  { id: 'deepwiki', name: 'DeepWiki', category: 'Código', type: 'http', auth: 'none', url: 'https://mcp.deepwiki.com/mcp', desc: 'Pregunta por cualquier repositorio público de GitHub.' },
  { id: 'context7', name: 'Context7', category: 'Código', type: 'http', auth: 'none', url: 'https://mcp.context7.com/mcp', desc: 'Documentación al día de miles de librerías.' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', category: 'Código', type: 'http', auth: 'none', url: 'https://docs.mcp.cloudflare.com/mcp', desc: 'Documentación de Cloudflare.' },

  // ---------------------------------------------------------------- trabajo
  { id: 'notion', name: 'Notion', category: 'Trabajo', type: 'http', auth: 'oauth', url: 'https://mcp.notion.com/mcp', desc: 'Buscar, leer y escribir páginas y bases de datos.' },
  { id: 'linear', name: 'Linear', category: 'Trabajo', type: 'http', auth: 'oauth', url: 'https://mcp.linear.app/mcp', desc: 'Issues, proyectos y ciclos.' },
  { id: 'atlassian', name: 'Jira y Confluence', category: 'Trabajo', type: 'http', auth: 'oauth', url: 'https://mcp.atlassian.com/v1/mcp', desc: 'Atlassian: issues de Jira y páginas de Confluence.' },
  { id: 'asana', name: 'Asana', category: 'Trabajo', type: 'http', auth: 'oauth', url: 'https://mcp.asana.com/v2/mcp', desc: 'Tareas y proyectos.' },
  { id: 'intercom', name: 'Intercom', category: 'Trabajo', type: 'http', auth: 'oauth', url: 'https://mcp.intercom.com/mcp', desc: 'Conversaciones y contactos de soporte.' },
  { id: 'zapier', name: 'Zapier', category: 'Trabajo', type: 'http', auth: 'oauth', url: 'https://mcp.zapier.com/api/mcp/mcp', desc: 'Miles de apps a través de tus acciones de Zapier.' },

  // ---------------------------------------------------------------- diseño
  { id: 'figma', name: 'Figma', category: 'Diseño', type: 'http', auth: 'oauth', url: 'https://mcp.figma.com/mcp', desc: 'Diseños, componentes y variables.' },
  { id: 'canva', name: 'Canva', category: 'Diseño', type: 'http', auth: 'oauth', url: 'https://mcp.canva.com/mcp', desc: 'Diseños de Canva.' },
  { id: 'webflow', name: 'Webflow', category: 'Diseño', type: 'http', auth: 'oauth', url: 'https://mcp.webflow.com/mcp', desc: 'Sitios y CMS de Webflow.' },
  { id: 'wix', name: 'Wix', category: 'Diseño', type: 'http', auth: 'oauth', url: 'https://mcp.wix.com/mcp', desc: 'Sitios de Wix.' },

  // ---------------------------------------------------------------- pagos
  { id: 'stripe', name: 'Stripe', category: 'Pagos y ventas', type: 'http', auth: 'token', url: 'https://mcp.stripe.com', tokenHeader: 'Authorization', tokenPrefix: 'Bearer ', tokenHint: 'clave restringida (rk_…), mejor en modo prueba', tokenUrl: 'https://dashboard.stripe.com/apikeys', desc: 'Clientes, pagos y facturas.' },
  { id: 'paypal', name: 'PayPal', category: 'Pagos y ventas', type: 'http', auth: 'oauth', url: 'https://mcp.paypal.com/mcp', desc: 'Pedidos, facturas y transacciones.' },
  { id: 'square', name: 'Square', category: 'Pagos y ventas', type: 'http', auth: 'oauth', url: 'https://mcp.squareup.com/mcp', desc: 'Pagos, catálogo e inventario.' },

  // ---------------------------------------------------------------- datos
  { id: 'supabase', name: 'Supabase', category: 'Datos e infraestructura', type: 'http', auth: 'oauth', url: 'https://mcp.supabase.com/mcp', desc: 'Bases de datos Postgres, tablas y funciones.' },
  { id: 'neon', name: 'Neon', category: 'Datos e infraestructura', type: 'http', auth: 'oauth', url: 'https://mcp.neon.tech/mcp', desc: 'Postgres serverless: ramas y consultas.' },
  { id: 'prisma', name: 'Prisma Postgres', category: 'Datos e infraestructura', type: 'http', auth: 'oauth', url: 'https://mcp.prisma.io/mcp', desc: 'Bases de datos de Prisma.' },

  // ---------------------------------------------------------------- investigación
  { id: 'huggingface', name: 'Hugging Face', category: 'Investigación', type: 'http', auth: 'none', url: 'https://huggingface.co/mcp', desc: 'Buscar modelos, datasets, Spaces y papers.' },

  // ---------------------------------------------------------------- en esta PC (servidores de referencia)
  { id: 'filesystem', name: 'Archivos (otra carpeta)', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2.2.0', '{carpeta}'], ask: { carpeta: 'carpeta a la que dar acceso' }, desc: 'Acceso a una carpeta distinta de la de trabajo.' },
  { id: 'memory', name: 'Memoria', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory@2.1.0'], desc: 'Un grafo de conocimiento que el agente recuerda entre sesiones.' },
  { id: 'thinking', name: 'Razonamiento por pasos', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking@2.1.1'], desc: 'Ayuda a modelos pequeños a pensar problemas en varios pasos.' },
  { id: 'playwright', name: 'Navegador (Playwright)', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'npx', args: ['-y', '@playwright/mcp@0.0.85'], desc: 'Abre y controla un navegador: navegar, rellenar, capturar.' },
  { id: 'chrome-devtools', name: 'Chrome DevTools', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.12.0'], desc: 'Depurar páginas en Chrome: consola, red, rendimiento.' },
  { id: 'fetch', name: 'Fetch (web a Markdown)', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'uvx', args: ['mcp-server-fetch'], needs: 'uv (Python)', desc: 'Descarga páginas web y las convierte a Markdown.' },
  { id: 'git', name: 'Git', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'uvx', args: ['mcp-server-git'], needs: 'uv (Python)', desc: 'Historial, diffs y ramas de repositorios locales.' },
  { id: 'time', name: 'Hora y zonas horarias', category: 'En esta PC', type: 'stdio', auth: 'local', command: 'uvx', args: ['mcp-server-time'], needs: 'uv (Python)', desc: 'Hora actual y conversiones entre zonas.' },
];

export const connectorById = (id) => CONNECTORS.find((c) => c.id === id);

/** Definición para guardar en el escritorio a partir de una entrada del catálogo y lo que pidió la interfaz. */
export function definitionFor(c, { token = '', clientId = '', clientSecret = '', answers = {} } = {}) {
  const def = { name: c.name, type: c.type, preset: c.id };
  if (c.type === 'http') {
    def.url = c.url;
    if (c.auth === 'token') {
      if (!token.trim()) throw new Error(`hace falta el ${c.tokenHint || 'token'}`);
      def.headers = { [c.tokenHeader || 'Authorization']: `${c.tokenPrefix ?? 'Bearer '}${token.trim()}` };
    }
    if (c.auth === 'google') {
      if (!clientId.trim()) throw new Error('hace falta el ID de cliente de Google (tipo «App de escritorio»)');
      def.clientId = clientId.trim();
      def.clientSecret = clientSecret.trim() || undefined;
    }
  } else {
    def.command = c.command;
    def.args = c.args.map((a) => a.replace(/\{(\w+)\}/g, (_, k) => {
      const v = String(answers[k] || '').trim();
      if (!v) throw new Error(`falta: ${c.ask?.[k] || k}`);
      return v;
    }));
  }
  return def;
}
