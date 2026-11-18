// Empaquetador MP4 mínimo para el vídeo que exporta el modo HTML: una pista de vídeo H.264 o VP9, sin dependencias.
// samples: [{ data: Uint8Array, key: boolean }] en orden. El índice va delante del contenido: se puede reproducir al vuelo.

const utf = (s) => new TextEncoder().encode(s);
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
function join(parts) {
  const size = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const bytes = (a) => (a instanceof Uint8Array ? a : Uint8Array.from(a));
const box = (type, ...parts) => {
  const body = join(parts.map(bytes));
  return join([Uint8Array.from(u32(body.length + 8)), utf(type), body]);
};
const full = (type, version, flags, ...parts) => box(type, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...parts);
const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
const zeros = (n) => new Array(n).fill(0);

function sampleEntry({ codec, width, height, description }) {
  const head = [...zeros(6), ...u16(1), ...zeros(16), ...u16(width), ...u16(height), ...u32(0x480000), ...u32(0x480000), ...u32(0), ...u16(1), ...zeros(32), ...u16(24), ...u16(0xffff)];
  if (codec === 'avc1') return box('avc1', head, box('avcC', description));
  // VP9: perfil 0, 8 bits, 4:2:0, BT.709
  return box('vp09', head, full('vpcC', 1, 0, [0, 40, (8 << 4) | (1 << 1), 1, 1, 1, 0, 0]));
}

/** Devuelve el archivo MP4 completo como Uint8Array. */
export function muxMp4({ codec, width, height, fps, description, samples }) {
  if (!samples.length) throw new Error('no hay fotogramas');
  const timescale = Math.round(fps * 1000);
  const delta = 1000;
  const total = samples.length * delta;
  const ftyp = box('ftyp', utf('isom'), u32(512), utf('isom'), utf('iso2'), utf(codec === 'avc1' ? 'avc1' : 'vp09'), utf('mp41'));
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const moovFor = (offset) => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(total), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(total), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width * 0x10000), u32(height * 0x10000)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(total), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), utf('vide'), zeros(12), utf('JeanCode'), [0]),
        box('minf',
          full('vmhd', 0, 1, zeros(8)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          box('stbl',
            full('stsd', 0, 0, u32(1), sampleEntry({ codec, width, height, description })),
            full('stts', 0, 0, u32(1), u32(samples.length), u32(delta)),
            full('stss', 0, 0, u32(keys.length), keys.flatMap(u32)),
            full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
            full('stsz', 0, 0, u32(0), u32(samples.length), join(samples.map((s) => Uint8Array.from(u32(s.data.length))))),
            full('stco', 0, 0, u32(1), u32(offset)))))));
  const moovSize = moovFor(0).length;
  const moov = moovFor(ftyp.length + moovSize + 8);
  const mdatSize = samples.reduce((s, x) => s + x.data.length, 8);
  return join([ftyp, moov, Uint8Array.from(u32(mdatSize)), utf('mdat'), ...samples.map((s) => s.data)]);
}
