// Versión única de JeanCode.
//   node scripts/version.mjs           comprueba que todas las copias coinciden (CI)
//   node scripts/version.mjs 1.1.0     cambia la versión en todos los sitios
//   node scripts/version.mjs --tag v1.1.0   además exige que la etiqueta coincida (workflow de release)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const f = (p) => join(root, p);
const SEMVER = /^\d+\.\d+\.\d+$/;

const sources = {
  'web/js/version.js': {
    get: (s) => s.match(/export const VERSION = '([^']+)'/)?.[1],
    set: (s, v) => s.replace(/export const VERSION = '[^']+'/, `export const VERSION = '${v}'`),
  },
  'web/sw.js': {
    get: (s) => s.match(/const CACHE = 'jeancode-([^']+)'/)?.[1],
    set: (s, v) => s.replace(/const CACHE = 'jeancode-[^']+'/, `const CACHE = 'jeancode-${v}'`),
  },
  'desktop/package.json': {
    get: (s) => JSON.parse(s).version,
    set: (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`),
  },
  'desktop/package-lock.json': {
    get: (s) => { const j = JSON.parse(s); return j.version === j.packages?.['']?.version ? j.version : `${j.version}≠${j.packages?.['']?.version}`; },
    // solo las dos primeras apariciones: la raíz y packages[""]
    set: (s, v) => { let n = 0; return s.replace(/("version":\s*")[^"]+(")/g, (m, a, b) => (n++ < 2 ? `${a}${v}${b}` : m)); },
  },
};

const args = process.argv.slice(2);
const tagAt = args.indexOf('--tag');
const tag = tagAt >= 0 ? args.splice(tagAt, 2)[1] : null;
const next = args[0];

if (next) {
  if (!SEMVER.test(next)) { console.error(`versión inválida: ${next} (usa X.Y.Z)`); process.exit(1); }
  for (const [p, src] of Object.entries(sources)) writeFileSync(f(p), src.set(readFileSync(f(p), 'utf8'), next));
}

const found = Object.fromEntries(Object.entries(sources).map(([p, src]) => [p, src.get(readFileSync(f(p), 'utf8'))]));
const values = new Set(Object.values(found));
for (const [p, v] of Object.entries(found)) console.log(`${v}\t${p}`);
if (values.size !== 1 || ![...values][0] || !SEMVER.test([...values][0])) { console.error('las versiones no coinciden'); process.exit(1); }
const version = [...values][0];
if (tag && tag.replace(/^v/, '') !== version) { console.error(`la etiqueta ${tag} no coincide con la versión ${version}`); process.exit(1); }
console.log(`JeanCode ${version} ✓`);
