// Imágenes adjuntas a un mensaje. Se guardan en este dispositivo y solo viajan al modelo que elijas, si puede verlas.
export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 1568; // más grande no mejora lo que ve el modelo y cuesta más tokens
const KEEP_RECENT = 4; // mensajes con imagen que se reenvían; los anteriores quedan como texto

export const ATTACH_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Motivo por el que no se puede adjuntar este archivo, o ''. */
export function rejectReason(file, count) {
  if (count >= MAX_ATTACHMENTS) return `Puedes adjuntar hasta ${MAX_ATTACHMENTS} imágenes por mensaje.`;
  if (!ATTACH_TYPES.includes(file.type)) return 'Solo se pueden adjuntar imágenes PNG, JPG, WEBP o GIF.';
  if (file.size > MAX_ATTACH_BYTES) return 'La imagen pasa de 20 MB.';
  return '';
}

/** Medidas finales: nunca se amplía y se conserva la proporción. */
export function fitSide(width, height, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Reduce la imagen si hace falta. Un PNG pequeño se queda como está para no perder texto nítido. */
export async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = fitSide(img.naturalWidth, img.naturalHeight);
    if (size.width === img.naturalWidth && file.size < 3 * 1024 * 1024 && file.type !== 'image/gif') return { blob: file, mime: file.type, ...size };
    const c = document.createElement('canvas');
    c.width = size.width; c.height = size.height;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('no se pudo leer la imagen'))), 'image/jpeg', 0.88));
    return { blob, mime: 'image/jpeg', ...size };
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Mensajes para la API. Los que llevan imágenes pasan al formato multimodal; solo los más recientes reenvían sus imágenes.
 * load(id) → dataURL | null.
 */
export async function withImages(messages, load) {
  const withAtt = messages.flatMap((m, i) => (m.attachments?.length ? [i] : []));
  const recent = new Set(withAtt.slice(-KEEP_RECENT));
  return Promise.all(messages.map(async (m, i) => {
    const base = { role: m.role, content: m.content };
    if (!m.attachments?.length) return base;
    if (!recent.has(i)) return { ...base, content: `${m.content}\n(el usuario adjuntó ${m.attachments.length === 1 ? 'una imagen' : `${m.attachments.length} imágenes`})`.trim() };
    const urls = (await Promise.all(m.attachments.map(load))).filter(Boolean);
    if (!urls.length) return base;
    return { role: m.role, content: [{ type: 'text', text: m.content }, ...urls.map((url) => ({ type: 'image_url', image_url: { url } }))] };
  }));
}

/** ¿El proveedor rechazó el mensaje porque el modelo no ve imágenes? */
export const refusedImages = (e) => (e?.status === 400 || e?.status === 422) && /image|vision|multi-?modal|image_url|content.*(array|list|string)/i.test(`${e.detail || ''} ${e.message || ''}`);
