// Retoque local de imágenes: todo ocurre en este dispositivo, sin gastar nada del proveedor.

/**
 * Ajusta píxeles RGBA en su sitio. brightness, contrast, saturation y warmth van de -100 a 100 (0 = sin cambio).
 * El alfa no se toca.
 */
export function applyAdjust(data, { brightness = 0, contrast = 0, saturation = 0, warmth = 0 } = {}) {
  const b = brightness * 1.28;
  const c = contrast >= 0 ? 1 + contrast / 50 : 1 + contrast / 100;
  const s = 1 + saturation / 100;
  const w = warmth * 0.3;
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], bl = data[i + 2];
    r = (r - 128) * c + 128 + b + w;
    g = (g - 128) * c + 128 + b;
    bl = (bl - 128) * c + 128 + b - w;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    data[i] = clamp(y + (r - y) * s);
    data[i + 1] = clamp(y + (g - y) * s);
    data[i + 2] = clamp(y + (bl - y) * s);
  }
  return data;
}

/** Rectángulo de recorte dentro de la imagen, respetando la proporción pedida ('free' = libre). */
export function cropRect(a, b, width, height, ratio = 'free') {
  const x0 = Math.max(0, Math.min(a.x, b.x)), y0 = Math.max(0, Math.min(a.y, b.y));
  let w = Math.min(width, Math.max(a.x, b.x)) - x0;
  let h = Math.min(height, Math.max(a.y, b.y)) - y0;
  if (ratio !== 'free') {
    const [rw, rh] = String(ratio).split(':').map(Number);
    if (w / h > rw / rh) w = (h * rw) / rh; else h = (w * rh) / rw;
  }
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(w), height: Math.round(h) };
}

export function canvasOf(width, height) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}
export const canvasBlob = (canvas, type = 'image/png', quality = 0.92) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no se pudo crear la imagen'))), type, quality);
});
export async function canvasFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = canvasOf(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
export function rotated(src, dir = 1) {
  const c = canvasOf(src.height, src.width);
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate((dir * Math.PI) / 2);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
export function flipped(src, horizontal = true) {
  const c = canvasOf(src.width, src.height);
  const x = c.getContext('2d');
  x.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height);
  x.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  x.drawImage(src, 0, 0);
  return c;
}
export function cropped(src, r) {
  const c = canvasOf(r.width, r.height);
  c.getContext('2d').drawImage(src, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  return c;
}
/** Copia ajustada, a tamaño completo. */
export function adjusted(src, values) {
  const c = canvasOf(src.width, src.height);
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  applyAdjust(d.data, values);
  x.putImageData(d, 0, 0);
  return c;
}
/** Máscara para la API: opaca lo que se conserva y transparente lo que se repinta (el formato de OpenAI). */
export function maskFrom(paint) {
  const c = canvasOf(paint.width, paint.height);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(paint, 0, 0);
  return c;
}
/** Imagen para enviar como referencia: como mucho `max` px de lado y sin pasar de unos MB. */
export async function referenceDataUrl(blob, max = 2048) {
  const src = await canvasFromBlob(blob);
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = canvasOf(src.width * k, src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL(blob.type === 'image/png' && k === 1 && blob.size < 4e6 ? 'image/png' : 'image/jpeg', 0.92);
}
