// Copia web/ (la única interfaz de JeanCode) a www/, que es lo que Capacitor mete en las apps.
import { cpSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', '..', 'web');
const www = join(here, '..', 'www');
rmSync(www, { recursive: true, force: true });
cpSync(web, www, { recursive: true, filter: (src) => !src.endsWith('sw.js') }); // sin service worker en la app
const v = readFileSync(join(web, 'js', 'version.js'), 'utf8').match(/VERSION\s*=\s*'([^']+)'/)?.[1];
console.log(`web -> www (JeanCode ${v})`);
