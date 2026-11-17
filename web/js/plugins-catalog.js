// Plugins con formato de Claude Code (.claude-plugin/plugin.json + skills/, agents/, commands/).
// Se instalan bajo demanda desde su repositorio (clon superficial): JeanCode no los redistribuye.
// De cada plugin solo se usa el texto; sus hooks, servidores MCP y scripts no se ejecutan.
export const PLUGIN_CATALOG = [
  {
    id: 'ecc', name: 'ECC · Everything Claude Code', repo: 'affaan-m/ECC', license: 'MIT',
    desc: 'Arnés de ingeniería completo: más de 300 skills (TDD, revisión, seguridad, lenguajes y frameworks), 72 subagentes especializados (planner, code-reviewer, security-reviewer…) y 98 comandos (/ecc:plan, /ecc:tdd…).',
  },
  {
    id: 'egm', name: 'EGM · Elephant-Goldfish Model', repo: 'google/elephant-goldfish-model', license: 'Apache-2.0',
    desc: 'De Google. El "elefante" (con contexto) desarrolla la idea y escribe el documento de diseño; los "peces" (subagentes sin la conversación previa) lo revisan con ojos nuevos. Skills egm-brainstorm, egm-draft, egm-review, egm-resolve…',
  },
];

export const pluginUrl = (c) => `https://github.com/${c.repo}.git`;
