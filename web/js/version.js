// Versión de JeanCode. Fuente única: la cambia `node scripts/version.mjs X.Y.Z`
// (también actualiza desktop/package.json y la caché del service worker).
export const VERSION = '1.0.0';

/** true si la etiqueta `tag` (p. ej. "v1.2.0") es más nueva que `current`. */
export function isNewer(tag, current = VERSION) {
  const p = (v) => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [a, b] = [p(tag), p(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
