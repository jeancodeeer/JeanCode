// Servidor MCP mínimo para las pruebas (SDK oficial). stdio por defecto; "http <puerto>" para Streamable HTTP.
const path = require('node:path');
const http = require('node:http');
const req = (m) => require(path.join(__dirname, '..', '..', 'desktop', 'node_modules', m));
const { McpServer } = req('@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
const { StdioServerTransport } = req('@modelcontextprotocol/sdk/dist/cjs/server/stdio.js');
const { StreamableHTTPServerTransport } = req('@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js');
const { z } = req('zod');

function build() {
  const s = new McpServer({ name: 'eco', version: '1.0.0' });
  s.registerTool('echo', { description: 'Devuelve el texto', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
    async ({ text }) => ({ content: [{ type: 'text', text: `eco: ${text}` }] }));
  s.registerTool('add_issue', { description: 'Crea una incidencia (escribe)', inputSchema: { title: z.string() } },
    async ({ title }) => ({ content: [{ type: 'text', text: `creada: ${title}` }] }));
  s.registerTool('boom', { description: 'Siempre falla', inputSchema: {} },
    async () => ({ isError: true, content: [{ type: 'text', text: 'algo salió mal' }] }));
  return s;
}

if (process.argv[2] === 'http') {
  const token = process.env.ECO_TOKEN;
  http.createServer(async (rq, rs) => {
    if (token && rq.headers.authorization !== `Bearer ${token}`) { rs.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(); return; }
    let body = '';
    rq.on('data', (c) => { body += c; });
    rq.on('end', async () => {
      const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await build().connect(t);
      await t.handleRequest(rq, rs, body ? JSON.parse(body) : undefined);
    });
  }).listen(Number(process.argv[3]), '127.0.0.1', () => process.stdout.write('ready\n'));
} else {
  build().connect(new StdioServerTransport());
}
