// Copia la interfaz web (../web) dentro de la app de escritorio (app/). Una sola fuente de UI.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'web');
const dst = join(here, '..', 'app');
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`web -> app: ${dst}`);
