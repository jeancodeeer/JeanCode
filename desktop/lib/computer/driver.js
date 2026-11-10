// Driver del sistema operativo para el control del equipo. Un proceso por sesión, con protocolo
// JSON por líneas. Hoy: Windows (PowerShell + user32 SendInput + UI Automation). En otros sistemas
// el control de ratón/teclado no está disponible (isSupported() lo dice) y JeanCode no lo simula.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SUPPORTED = process.platform === 'win32';

/** Ruta real del script: dentro de un .asar PowerShell no puede leerlo, se usa la copia desempaquetada. */
function scriptPath() {
  const p = path.join(__dirname, 'win-driver.ps1');
  const unpacked = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : p;
}

class Driver {
  constructor({ timeoutMs = 20000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.buf = '';
    this.ready = null;
    this.screen = null;
  }

  static isSupported() { return SUPPORTED; }

  start() {
    if (!SUPPORTED) return Promise.reject(new Error(`el control de ratón y teclado aún no está disponible en ${os.type()}`));
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath()], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;
      let stderr = '';
      const failStart = setTimeout(() => { reject(new Error('el driver no arrancó a tiempo')); this.stop(); }, 30000);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        this.buf += chunk;
        let nl;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, nl).trim();
          this.buf = this.buf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.id === 0) { clearTimeout(failStart); this.screen = msg.result.screen; resolve(msg.result); continue; }
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'error del driver'));
        }
      });
      proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
      proc.on('exit', (code) => {
        clearTimeout(failStart);
        const err = new Error(`el driver de Windows se cerró (código ${code})${stderr ? ': ' + stderr.trim().split('\n').pop() : ''}`);
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
        this.pending.clear();
        this.proc = null;
        this.ready = null;
        reject(err);
      });
    });
    return this.ready;
  }

  /** Envía una orden y espera su respuesta. Un driver colgado se reinicia en la siguiente orden. */
  async call(cmd, args = {}, timeoutMs = this.timeoutMs) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`la orden "${cmd}" no respondió en ${Math.round(timeoutMs / 1000)} s`));
        this.stop(); // estado desconocido: se reinicia limpio
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch { /* ya terminó */ } }
    this.proc = null;
    this.ready = null;
  }
}

module.exports = { Driver, SUPPORTED };
