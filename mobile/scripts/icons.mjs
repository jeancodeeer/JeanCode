// Icono y splash de las apps a partir de web/favicon.svg (resources/ -> @capacitor/assets).
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, '..', '..', 'web', 'favicon.svg'));
const res = join(here, '..', 'resources');
await sharp(svg, { density: 1200 }).resize(1024, 1024).png().toFile(join(res, 'icon-only.png'));
await sharp(svg, { density: 1200 }).resize(640, 640).png().toFile(join(res, 'icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#000000' } }).png().toFile(join(res, 'icon-background.png'));
const logo = await sharp(svg, { density: 600 }).resize(512, 512).png().toBuffer();
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#000000' } })
    .composite([{ input: logo, gravity: 'center' }]).png().toFile(join(res, name));
}
console.log('resources/ listos');
