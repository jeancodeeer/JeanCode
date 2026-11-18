// Banda sonora del vídeo HTML: música y efectos sintetizados aquí mismo, sin muestras ni derechos de terceros.
// Sale siempre igual para el mismo vídeo: el ruido usa una semilla fija.
const NOTE = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const MUSIC = {
  drive: { bpm: 120, root: 45, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], kick: 1, bass: 0.9, pad: 0.26, arp: 0, hat: 0.3, wave: 'sawtooth' },
  tech: { bpm: 120, root: 43, chords: [[0, 3, 7], [0, 3, 8], [-2, 3, 7], [-4, 0, 5]], kick: 0.85, bass: 0.7, pad: 0.2, arp: 0.34, hat: 0.34, wave: 'square' },
  bounce: { bpm: 120, root: 48, chords: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [7, 11, 14]], kick: 0.9, bass: 0.8, pad: 0.16, arp: 0.3, hat: 0.26, wave: 'square' },
  elegant: { bpm: 120, root: 50, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]], kick: 0, bass: 0.45, pad: 0.34, arp: 0.3, hat: 0, wave: 'triangle' },
  opium: { bpm: 120, root: 37, chords: [[0, 3, 7], [0, 3, 8], [-2, 1, 5], [-4, -1, 3]], kick: 1, bass: 1, pad: 0.3, arp: 0.16, hat: 0.42, wave: 'sawtooth', halfTime: true },
  warm: { bpm: 120, root: 46, chords: [[0, 4, 7], [-5, -1, 2], [-3, 0, 4], [5, 9, 12]], kick: 0.4, bass: 0.55, pad: 0.36, arp: 0.2, hat: 0.1, wave: 'triangle' },
};

/** Lo que el sonido necesita saber de una composición. null si no lleva. */
export function soundOf(html) {
  const tag = String(html).match(/<[^>]*data-composition-id[^>]*>/i)?.[0] || '';
  const music = tag.match(/data-music\s*=\s*"([^"]*)"/i)?.[1] || '';
  if (!music || music === 'none') return null;
  const cues = (tag.match(/data-cues\s*=\s*"([^"]*)"/i)?.[1] || '').split(',').map(Number).filter((x) => Number.isFinite(x) && x > 0);
  const riser = Number(tag.match(/data-riser\s*=\s*"([^"]*)"/i)?.[1]) || 0;
  // data-hush="0-2,28.5-30": tramos en los que la base calla
  const hush = (tag.match(/data-hush\s*=\s*"([^"]*)"/i)?.[1] || '').split(',').map((r) => r.trim().split('-').map(Number)).filter((r) => r.length === 2 && r.every(Number.isFinite) && r[1] > r[0]);
  return { music: MUSIC[music] ? music : 'drive', cues, riser, hush };
}

function noiseBuffer(ctx, seconds = 1) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2f6e2b1;
  for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
  return buf;
}

/** Renderiza la pista completa. → AudioBuffer estéreo a 48 kHz */
export async function renderSoundtrack({ music = 'drive', cues = [], duration, riser = 0, hush = [] }) {
  const cfg = MUSIC[music] || MUSIC.drive;
  const ctx = new OfflineAudioContext(2, Math.ceil(48000 * duration), 48000);
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14; master.ratio.value = 6; master.attack.value = 0.004; master.release.value = 0.18;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, 0);
  out.gain.linearRampToValueAtTime(0.62, 0.08);
  out.gain.setValueAtTime(0.62, Math.max(0.1, duration - 0.9));
  out.gain.linearRampToValueAtTime(0, duration);
  // la base calla en un tramo (la tensión antes del golpe); los efectos siguen sonando
  const bed = ctx.createGain();
  bed.gain.setValueAtTime(1, 0);
  for (const [from, to] of [...hush].sort((a, b) => a[0] - b[0])) {
    if (from <= 0) bed.gain.setValueAtTime(0.04, 0);
    else { bed.gain.setValueAtTime(1, Math.max(0, from - 0.02)); bed.gain.linearRampToValueAtTime(0.04, from); }
    bed.gain.setValueAtTime(0.04, to - 0.01);
    bed.gain.linearRampToValueAtTime(1, to);
  }
  bed.connect(master);
  master.connect(out).connect(ctx.destination);
  const noise = noiseBuffer(ctx);
  const beat = 60 / cfg.bpm;
  const bar = beat * 4;

  const tone = (type, freq, at, len, gain, cutoff = 0) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + Math.min(0.012, len / 4)); g.gain.exponentialRampToValueAtTime(0.0008, at + len);
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f).connect(g); } else o.connect(g);
    g.connect(bed); o.start(at); o.stop(at + len + 0.02);
  };
  const burst = (at, len, gain, type, from, to, toBed = false) => {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = 0.9; f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(to, at + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0008, at); g.gain.exponentialRampToValueAtTime(gain, at + len * 0.72); g.gain.exponentialRampToValueAtTime(0.0008, at + len);
    s.connect(f).connect(g).connect(toBed ? bed : master); s.start(at, (at * 7.3) % 0.9); s.stop(at + len + 0.02);
  };

  const bars = Math.ceil(duration / bar);
  for (let b = 0; b < bars; b++) {
    const chord = cfg.chords[b % cfg.chords.length];
    const t0 = b * bar;
    for (const n of chord) if (cfg.pad) { tone('sawtooth', NOTE(cfg.root + 24 + n), t0, bar * 1.05, cfg.pad * 0.1, 1500); tone('triangle', NOTE(cfg.root + 24 + n) * 1.004, t0, bar * 1.05, cfg.pad * 0.12); }
    for (let s = 0; s < 16; s++) {
      const at = t0 + (s * beat) / 4;
      if (at >= duration) break;
      if (cfg.kick && (cfg.halfTime ? [0, 6, 10].includes(s) : s % 4 === 0)) { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(44, at + 0.11); g.gain.setValueAtTime(cfg.kick * 0.9, at); g.gain.exponentialRampToValueAtTime(0.001, at + (cfg.halfTime ? 0.5 : 0.26)); o.connect(g).connect(bed); o.start(at); o.stop(at + 0.55); }
      if (cfg.halfTime && s === 8) burst(at, 0.2, 0.42, 'bandpass', 1900, 1300, true); // caja a medio compás
      if (cfg.bass && s % 2 === 0 && s % 8 !== 6) tone(cfg.wave, NOTE(cfg.root + chord[0] - (cfg.root > 47 ? 12 : 0)), at, beat * 0.46, cfg.bass * 0.2, 520);
      if (cfg.hat && (cfg.halfTime ? s % 2 === 0 || (b % 2 === 1 && s > 11) : s % 4 === 2)) burst(at, 0.05, cfg.hat * 0.3, 'highpass', 7600, 9000, true);
      if (cfg.arp && s % 2 === 1) tone('triangle', NOTE(cfg.root + 36 + chord[((s - 1) / 2) % chord.length]), at, beat * 0.5, cfg.arp * 0.15);
    }
  }
  // efectos en cada cambio de escena: barrido antes del corte y golpe sobre él
  for (const c of cues) {
    if (c <= 0.3 || c >= duration) continue;
    burst(c - 0.34, 0.42, 0.34, 'bandpass', 500, 5200);
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(110, c); o.frequency.exponentialRampToValueAtTime(36, c + 0.28);
    g.gain.setValueAtTime(0.75, c); g.gain.exponentialRampToValueAtTime(0.001, c + 0.42);
    o.connect(g).connect(master); o.start(c); o.stop(c + 0.45);
  }
  if (riser > 1.5) {
    burst(riser - 1.5, 1.5, 0.55, 'bandpass', 300, 8000);
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(70, riser - 1.5); o.frequency.exponentialRampToValueAtTime(620, riser);
    g.gain.setValueAtTime(0.001, riser - 1.5); g.gain.exponentialRampToValueAtTime(0.16, riser - 0.03); g.gain.linearRampToValueAtTime(0, riser);
    o.connect(g).connect(master); o.start(riser - 1.5); o.stop(riser + 0.02);
  }
  return ctx.startRendering();
}

/** Comprime la pista: AAC si el dispositivo puede y Opus si no. → { codec, sampleRate, channels, description, samples } | null */
export async function encodeSoundtrack(buffer) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, box] of [['mp4a.40.2', 'mp4a'], ['opus', 'Opus']]) {
    const config = { codec, sampleRate: buffer.sampleRate, numberOfChannels: 2, bitrate: 160000 };
    const ok = await AudioEncoder.isConfigSupported(config).catch(() => null);
    if (!ok?.supported) continue;
    const samples = [];
    let description = null;
    let failure = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({ data, key: true, duration: Math.max(1, Math.round((chunk.duration || 0) * buffer.sampleRate / 1e6)) });
        const d = meta?.decoderConfig?.description;
        if (d) description = new Uint8Array(d.buffer || d, d.byteOffset || 0, d.byteLength);
      },
      error: (e) => { failure = e; },
    });
    enc.configure(config);
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const size = 4096;
    for (let i = 0; i < buffer.length; i += size) {
      const n = Math.min(size, buffer.length - i);
      const planar = new Float32Array(n * 2);
      planar.set(L.subarray(i, i + n), 0);
      planar.set(R.subarray(i, i + n), n);
      const data = new AudioData({ format: 'f32-planar', sampleRate: buffer.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i * 1e6) / buffer.sampleRate), data: planar });
      enc.encode(data);
      data.close();
    }
    await enc.flush();
    enc.close();
    if (!failure && samples.length) return { codec: box, sampleRate: buffer.sampleRate, channels: 2, description, samples };
  }
  return null;
}
