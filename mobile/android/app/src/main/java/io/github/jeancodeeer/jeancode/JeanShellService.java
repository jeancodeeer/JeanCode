package io.github.jeancodeeer.jeancode;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.concurrent.TimeUnit;

/**
 * Corre en un proceso aparte con permisos de shell (uid 2000, como `adb shell`), abierto por Shizuku
 * (UserService). Solo la app JeanCode puede hablar con él: Shizuku entrega el binder únicamente a la app que lo pidió
 * y a la que el usuario dio permiso. No escucha en ningún puerto.
 */
public class JeanShellService extends IJeanShell.Stub {
    private static final int MAX_OUT = 512 * 1024;
    private static final int MAX_CHUNK = 256 * 1024;

    public JeanShellService() {}

    @Override
    public void destroy() {
        System.exit(0);
    }

    @Override
    public String exec(String cmd, int timeoutMs) {
        JSONObject r = new JSONObject();
        try {
            Process p = new ProcessBuilder("sh", "-c", cmd).redirectErrorStream(false).start();
            p.getOutputStream().close();
            Reader out = new Reader(p.getInputStream());
            Reader err = new Reader(p.getErrorStream());
            out.start();
            err.start();
            long limit = Math.max(1000, Math.min(timeoutMs, 600000));
            boolean done = p.waitFor(limit, TimeUnit.MILLISECONDS);
            if (!done) p.destroyForcibly();
            out.join(2000);
            err.join(2000);
            r.put("code", done ? p.exitValue() : -1);
            r.put("out", out.text());
            r.put("err", done ? err.text() : err.text() + "\n(tiempo agotado: " + (limit / 1000) + " s)");
        } catch (Exception e) {
            try { r.put("code", -1); r.put("out", ""); r.put("err", "ERROR: " + e.getMessage()); } catch (Exception ignored) { }
        }
        return r.toString();
    }

    @Override
    public long size(String path) {
        File f = new File(path);
        return f.isFile() ? f.length() : -1;
    }

    @Override
    public String readChunk(String path, long offset, int len) {
        int n = Math.max(0, Math.min(len, MAX_CHUNK));
        try (RandomAccessFile f = new RandomAccessFile(path, "r")) {
            f.seek(Math.max(0, offset));
            byte[] buf = new byte[n];
            int got = 0;
            while (got < n) {
                int k = f.read(buf, got, n - got);
                if (k < 0) break;
                got += k;
            }
            return Base64.encodeToString(buf, 0, got, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException("no se pudo leer " + path + ": " + e.getMessage());
        }
    }

    @Override
    public void writeChunk(String path, String b64, boolean append) {
        File f = new File(path);
        File dir = f.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("no se pudo crear " + dir);
        try (FileOutputStream o = new FileOutputStream(f, append)) {
            o.write(Base64.decode(b64, Base64.DEFAULT));
        } catch (Exception e) {
            throw new IllegalStateException("no se pudo escribir " + path + ": " + e.getMessage());
        }
    }

    @Override
    public String screenshot(int maxWidth) {
        try {
            Process p = new ProcessBuilder("screencap", "-p").start();
            p.getOutputStream().close();
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            InputStream in = p.getInputStream();
            for (int k; (k = in.read(buf)) > 0; ) png.write(buf, 0, k);
            p.waitFor(10, TimeUnit.SECONDS);
            Bitmap full = BitmapFactory.decodeByteArray(png.toByteArray(), 0, png.size());
            if (full == null) throw new IllegalStateException("screencap no devolvió una imagen");
            int w = Math.max(240, Math.min(maxWidth, full.getWidth()));
            int h = Math.round(full.getHeight() * (w / (float) full.getWidth()));
            Bitmap small = w == full.getWidth() ? full : Bitmap.createScaledBitmap(full, w, h, true);
            ByteArrayOutputStream jpg = new ByteArrayOutputStream();
            // calidad decreciente hasta caber de sobra en el binder
            for (int q = 75; q >= 35; q -= 10) {
                jpg.reset();
                small.compress(Bitmap.CompressFormat.JPEG, q, jpg);
                if (jpg.size() < 600 * 1024) break;
            }
            JSONObject r = new JSONObject();
            r.put("b64", Base64.encodeToString(jpg.toByteArray(), Base64.NO_WRAP));
            r.put("mime", "image/jpeg");
            r.put("width", w);
            r.put("height", h);
            r.put("realWidth", full.getWidth());
            r.put("realHeight", full.getHeight());
            return r.toString();
        } catch (Exception e) {
            throw new IllegalStateException("captura: " + e.getMessage());
        }
    }

    /** Lee un flujo en segundo plano (si no, un proceso con mucha salida se bloquea). */
    private static class Reader extends Thread {
        private final InputStream in;
        private final ByteArrayOutputStream buf = new ByteArrayOutputStream();

        Reader(InputStream in) { this.in = in; }

        @Override
        public void run() {
            byte[] b = new byte[8192];
            try {
                for (int k; (k = in.read(b)) > 0; ) if (buf.size() < MAX_OUT) buf.write(b, 0, Math.min(k, MAX_OUT - buf.size()));
            } catch (Exception ignored) { }
        }

        String text() { return buf.toString(); }
    }
}
