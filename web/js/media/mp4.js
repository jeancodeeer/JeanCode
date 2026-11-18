// Empaquetador MP4 mínimo para el vídeo que exporta el modo HTML: vídeo H.264 o VP9 y, si lo hay, sonido AAC u Opus.
// video.samples y audio.samples: [{ data: Uint8Array, key: boolean, duration? }] en orden.
// El índice va delante del contenido: el archivo se puede reproducir mientras se descarga.

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
const table = (values) => { const out = new Uint8Array(values.length * 4); new DataView(out.buffer).setUint32(0, 0); values.forEach((v, i) => out.set(u32(v), i * 4)); return out; };

function videoEntry({ codec, width, height, description }) {
  const head = [...zeros(6), ...u16(1), ...zeros(16), ...u16(width), ...u16(height), ...u32(0x480000), ...u32(0x480000), ...u32(0), ...u16(1), ...zeros(32), ...u16(24), ...u16(0xffff)];
  if (codec === 'avc1') return box('avc1', head, box('avcC', description));
  // VP9: perfil 0, 8 bits, 4:2:0, BT.709
  return box('vp09', head, full('vpcC', 1, 0, [0, 40, (8 << 4) | (1 << 1), 1, 1, 1, 0, 0]));
}

/** Descriptor de AAC (ISO 14496-1) con la configuración que da el codificador. */
function esds(asc) {
  const tag = (t, ...p) => { const b = join(p.map(bytes)); return join([Uint8Array.from([t, 0x80, 0x80, 0x80, b.length]), b]); };
  const dec = tag(4, [0x40, 0x15, 0, 0, 0], u32(160000), u32(160000), tag(5, asc));
  return full('esds', 0, 0, tag(3, u16(1), [0], dec, tag(6, [2])));
}
function audioEntry({ codec, sampleRate, channels, description }) {
  const head = [...zeros(6), ...u16(1), ...zeros(8), ...u16(channels), ...u16(16), ...zeros(4), ...u16(sampleRate), ...u16(0)];
  if (codec === 'mp4a') return box('mp4a', head, esds(description || new Uint8Array([0x11, 0x90])));
  return box('Opus', head, box('dOps', [0, channels], u16(312), u32(sampleRate), u16(0), [0]));
}

function track({ id, kind, timescale, entry, samples, deltas, width = 0, height = 0, offset, movieScale }) {
  const total = deltas.reduce((a, b) => a + b, 0);
  const runs = [];
  for (const d of deltas) { const last = runs[runs.length - 1]; if (last && last[1] === d) last[0]++; else runs.push([1, d]); }
  const keys = kind === 'video' ? samples.flatMap((s, i) => (s.key ? [i + 1] : [])) : null;
  return box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(Math.round((total / timescale) * movieScale)), zeros(8), u16(0), u16(0), u16(kind === 'audio' ? 0x100 : 0), u16(0), MATRIX, u32(width * 0x10000), u32(height * 0x10000)),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(total), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), utf(kind === 'video' ? 'vide' : 'soun'), zeros(12), utf('JeanCode'), [0]),
      box('minf',
        kind === 'video' ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4)),
        box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
        box('stbl',
          full('stsd', 0, 0, u32(1), entry),
          full('stts', 0, 0, u32(runs.length), table(runs.flat())),
          ...(keys ? [full('stss', 0, 0, u32(keys.length), table(keys))] : []),
          full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
          full('stsz', 0, 0, u32(0), u32(samples.length), table(samples.map((s) => s.data.length))),
          full('stco', 0, 0, u32(1), u32(offset))))));
}

/** Devuelve el archivo MP4 completo como Uint8Array. audio es opcional. */
export function muxMp4({ codec, width, height, fps, description, samples, audio = null }) {
  if (!samples.length) throw new Error('no hay fotogramas');
  const videoScale = Math.round(fps * 1000);
  const movieScale = 1000;
  const duration = Math.round((samples.length / fps) * movieScale);
  const ftyp = box('ftyp', utf('isom'), u32(512), utf('isom'), utf('iso2'), utf(codec === 'avc1' ? 'avc1' : 'vp09'), utf('mp41'));
  const moovFor = (vOffset, aOffset) => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(movieScale), u32(duration), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(audio ? 3 : 2)),
    track({ id: 1, kind: 'video', timescale: videoScale, entry: videoEntry({ codec, width, height, description }), samples, deltas: samples.map(() => 1000), width, height, offset: vOffset, movieScale }),
    ...(audio ? [track({ id: 2, kind: 'audio', timescale: audio.sampleRate, entry: audioEntry(audio), samples: audio.samples, deltas: audio.samples.map((s) => s.duration), offset: aOffset, movieScale })] : []));
  const moovSize = moovFor(0, 0).length;
  const videoSize = samples.reduce((s, x) => s + x.data.length, 0);
  const audioSize = audio ? audio.samples.reduce((s, x) => s + x.data.length, 0) : 0;
  const first = ftyp.length + moovSize + 8;
  const moov = moovFor(first, first + videoSize);
  return join([ftyp, moov, Uint8Array.from(u32(videoSize + audioSize + 8)), utf('mdat'), ...samples.map((s) => s.data), ...(audio ? audio.samples.map((s) => s.data) : [])]);
}
