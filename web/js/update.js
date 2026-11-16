// Aviso de versión nueva en el ESCRITORIO y en el MÓVIL (la web se actualiza sola con el service worker).
// Consulta la última release de GitHub, compara con la versión instalada y elige la descarga de esta
// plataforma. Solo funciones puras aquí; la pantalla la monta app.js.
import { VERSION, isNewer } from './version.js';

/** Plataforma de descarga: 'win' | 'mac' | 'macx' | 'linux' | 'android' | 'ios' | null (web). */
export function platformOf({ desktop = false, capacitor = null, ua = '' } = {}) {
  const native = capacitor && (typeof capacitor.isNativePlatform === 'function' ? capacitor.isNativePlatform() : false);
  if (native) {
    const p = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : '';
    return p === 'android' || p === 'ios' ? p : null;
  }
  if (!desktop) return null;
  if (/Windows/i.test(ua)) return 'win';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac'; // Apple Silicon; los Intel tienen el .dmg x64 en "Todas las descargas"
  if (/Linux|X11/i.test(ua)) return 'linux';
  return null;
}

const ASSET = {
  win: /\.exe$/i, mac: /arm64\.dmg$/i, macx: /x64\.dmg$/i, linux: /\.AppImage$/i,
  android: /\.apk$/i, ios: /\.ipa$/i,
};

/** El archivo de la release para esta plataforma, o null. */
export function pickAsset(assets = [], platform) {
  const re = ASSET[platform];
  return re ? assets.find((a) => re.test(a.name)) || null : null;
}

/** Qué tipo de salto es: 'mayor' (2.0.0), 'menor' (1.3.0) o 'parche' (1.2.3). */
export function changeKind(from, to) {
  const a = String(from).replace(/^v/, '').split('.').map(Number);
  const b = String(to).replace(/^v/, '').split('.').map(Number);
  if ((b[0] || 0) > (a[0] || 0)) return 'mayor';
  if ((b[1] || 0) > (a[1] || 0)) return 'menor';
  return 'parche';
}

export const KIND_TEXT = {
  mayor: 'Versión mayor: cambios grandes',
  menor: 'Versión con novedades',
  parche: 'Versión de correcciones',
};

/**
 * Normaliza la respuesta de /releases/latest. null si no es más nueva, si es borrador/preliminar
 * o si el usuario la omitió.
 */
export function updateFrom(rel, { platform, current = VERSION, skipped = null } = {}) {
  if (!rel || !rel.tag_name || rel.draft || rel.prerelease) return null;
  const version = String(rel.tag_name).replace(/^v/, '');
  if (!isNewer(rel.tag_name, current) || skipped === version) return null;
  const asset = pickAsset(rel.assets || [], platform);
  return {
    version, current, kind: changeKind(current, version),
    notes: String(rel.body || '').trim(),
    date: rel.published_at || null,
    url: asset?.browser_download_url || rel.html_url || null,
    page: rel.html_url || null,
    asset: asset ? { name: asset.name, size: asset.size } : null,
  };
}
