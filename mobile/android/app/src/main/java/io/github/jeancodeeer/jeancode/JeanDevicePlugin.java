package io.github.jeancodeeer.jeancode;

import android.content.ComponentName;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.IBinder;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import rikka.shizuku.Shizuku;

/**
 * Mini agente del móvil en Android: con Shizuku (que se activa una vez por reinicio con la depuración inalámbrica
 * del modo desarrollador) abre JeanShellService con permisos de shell y le pasa los comandos, archivos y capturas.
 * Sin Shizuku o sin tu permiso, nada de esto funciona: la app normal no tiene esos permisos.
 */
@CapacitorPlugin(name = "JeanDevice")
public class JeanDevicePlugin extends Plugin {
    private static final String SHIZUKU_PKG = "moe.shizuku.privileged.api";
    private static final int REQUEST = 4242;
    private static final int CHUNK = 192 * 1024;

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile IJeanShell shell;
    private volatile CountDownLatch bound = new CountDownLatch(1);
    private PluginCall pendingPermission;
    private Shizuku.UserServiceArgs args;

    private final ServiceConnection conn = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            if (binder != null && binder.pingBinder()) shell = IJeanShell.Stub.asInterface(binder);
            bound.countDown();
        }
        @Override public void onServiceDisconnected(ComponentName name) { shell = null; }
    };

    private final Shizuku.OnRequestPermissionResultListener permissionListener = (code, result) -> {
        if (code != REQUEST || pendingPermission == null) return;
        JSObject r = new JSObject();
        r.put("granted", result == PackageManager.PERMISSION_GRANTED);
        pendingPermission.resolve(r);
        pendingPermission = null;
    };

    @Override
    public void load() {
        boolean debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        args = new Shizuku.UserServiceArgs(new ComponentName(getContext().getPackageName(), JeanShellService.class.getName()))
            .daemon(false).processNameSuffix("jeanshell").debuggable(debuggable).version(1);
        Shizuku.addRequestPermissionResultListener(permissionListener);
    }

    @Override
    protected void handleOnDestroy() {
        Shizuku.removeRequestPermissionResultListener(permissionListener);
        try { if (shell != null) Shizuku.unbindUserService(args, conn, true); } catch (Exception ignored) { }
        pool.shutdownNow();
    }

    private boolean installed() {
        try { getContext().getPackageManager().getPackageInfo(SHIZUKU_PKG, 0); return true; } catch (Exception e) { return false; }
    }
    private boolean running() { try { return Shizuku.pingBinder(); } catch (Exception e) { return false; } }
    private boolean granted() {
        try { return running() && !Shizuku.isPreV11() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED; } catch (Exception e) { return false; }
    }

    /** Abre (una vez) el servicio con permisos de shell. */
    private IJeanShell shell() throws Exception {
        IJeanShell s = shell;
        if (s != null && s.asBinder().pingBinder()) return s;
        if (!running()) throw new IllegalStateException("Shizuku no está en marcha: ábrelo y pulsa «Iniciar» (depuración inalámbrica).");
        if (!granted()) throw new IllegalStateException("JeanCode no tiene permiso de Shizuku: pulsa «Dar permiso» en Móvil.");
        bound = new CountDownLatch(1);
        Shizuku.bindUserService(args, conn);
        if (!bound.await(15, TimeUnit.SECONDS) || shell == null) throw new IllegalStateException("el servicio de shell no arrancó");
        return shell;
    }

    /** Ejecuta en segundo plano y responde o rechaza la llamada. */
    private interface Job { JSObject run() throws Exception; }
    private void async(PluginCall call, Job job) {
        pool.execute(() -> {
            try { call.resolve(job.run()); } catch (Exception e) { call.reject(e.getMessage() != null ? e.getMessage() : e.toString()); }
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("installed", installed());
        r.put("running", running());
        r.put("granted", granted());
        int uid = -1;
        try { if (running()) uid = Shizuku.getUid(); } catch (Exception ignored) { }
        r.put("uid", uid); // 2000 = shell (depuración), 0 = root
        r.put("ready", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (granted()) { JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return; }
        if (!running()) { call.reject("Shizuku no está en marcha: ábrelo y pulsa «Iniciar»."); return; }
        pendingPermission = call;
        Shizuku.requestPermission(REQUEST);
    }

    @PluginMethod
    public void exec(PluginCall call) {
        String cmd = call.getString("cmd", "");
        int timeout = call.getInt("timeout", 120000);
        async(call, () -> JSObject.fromJSONObject(new JSONObject(shell().exec(cmd, timeout))));
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String path = call.getString("path", "");
        long max = call.getInt("maxBytes", 4 * 1024 * 1024);
        async(call, () -> {
            IJeanShell s = shell();
            long size = s.size(path);
            if (size < 0) throw new IllegalStateException("no existe el archivo " + path);
            if (size > max) throw new IllegalStateException("archivo de más de " + (max / 1048576) + " MB; usa un comando");
            ByteArrayOutputStream all = new ByteArrayOutputStream((int) size);
            for (long off = 0; off < size; off += CHUNK) all.write(Base64.decode(s.readChunk(path, off, CHUNK), Base64.DEFAULT));
            JSObject r = new JSObject();
            r.put("b64", Base64.encodeToString(all.toByteArray(), Base64.NO_WRAP));
            return r;
        });
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path", "");
        String b64 = call.getString("b64", "");
        async(call, () -> {
            IJeanShell s = shell();
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            // a un temporal y luego se renombra: nunca queda un archivo a medias
            String tmp = path + ".jeancode-tmp";
            if (data.length == 0) s.writeChunk(tmp, "", false);
            for (int off = 0; off < data.length; off += CHUNK) {
                int n = Math.min(CHUNK, data.length - off);
                s.writeChunk(tmp, Base64.encodeToString(data, off, n, Base64.NO_WRAP), off > 0);
            }
            JSONObject mv = new JSONObject(s.exec("mv -f '" + tmp.replace("'", "'\\''") + "' '" + path.replace("'", "'\\''") + "'", 20000));
            if (mv.optInt("code", -1) != 0) throw new IllegalStateException("no se pudo guardar " + path + ": " + mv.optString("err"));
            JSObject r = new JSObject();
            r.put("ok", true);
            return r;
        });
    }

    /** DNS del teléfono para webfetch: todas las direcciones del nombre (se rechaza si alguna es privada). */
    @PluginMethod
    public void resolve(PluginCall call) {
        String host = call.getString("host", "");
        async(call, () -> {
            com.getcapacitor.JSArray list = new com.getcapacitor.JSArray();
            for (java.net.InetAddress a : java.net.InetAddress.getAllByName(host)) list.put(a.getHostAddress());
            JSObject r = new JSObject();
            r.put("addresses", list);
            return r;
        });
    }

    private static final int MAX_FETCH = 5 * 1024 * 1024;
    private static final java.util.regex.Pattern IP_LITERAL = java.util.regex.Pattern.compile("^([0-9]{1,3}([.][0-9]{1,3}){3}|[0-9a-fA-F:.]*:[0-9a-fA-F:.]*)$");
    private final okhttp3.OkHttpClient http = new okhttp3.OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false) // webfetch sigue y comprueba cada redirección
        .proxy(java.net.Proxy.NO_PROXY) // con un proxy, el que resolvería el nombre sería él
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(40, TimeUnit.SECONDS)
        .build();

    /**
     * GET para webfetch conectando SOLO a las IP que la app ya comprobó (no vuelve a preguntar al DNS, así que un
     * DNS que cambie de respuesta no cuela una dirección privada). TLS sigue verificando el certificado con el nombre.
     * No sigue redirecciones. → { status, location, type, text }
     */
    @PluginMethod
    public void fetch(PluginCall call) {
        String url = call.getString("url", "");
        com.getcapacitor.JSArray list = call.getArray("addresses", new com.getcapacitor.JSArray());
        async(call, () -> {
            okhttp3.HttpUrl u = okhttp3.HttpUrl.parse(url);
            if (u == null || !(u.scheme().equals("http") || u.scheme().equals("https"))) throw new IllegalArgumentException("solo http y https");
            java.util.List<java.net.InetAddress> pinned = new java.util.ArrayList<>();
            for (int i = 0; i < list.length(); i++) {
                String ip = list.getString(i);
                // solo IP literales: getByName con una IP no consulta el DNS
                if (!IP_LITERAL.matcher(ip).matches()) throw new IllegalArgumentException("dirección no válida: " + ip);
                pinned.add(java.net.InetAddress.getByName(ip));
            }
            if (pinned.isEmpty()) throw new IllegalArgumentException("sin direcciones comprobadas");
            final String host = u.host();
            okhttp3.OkHttpClient client = http.newBuilder().dns(h -> {
                if (!h.equalsIgnoreCase(host)) throw new java.net.UnknownHostException("nombre no comprobado: " + h);
                return pinned;
            }).build();
            okhttp3.Request req = new okhttp3.Request.Builder().url(u).header("User-Agent", "JeanCode").header("Accept", "*/*").get().build();
            try (okhttp3.Response res = client.newCall(req).execute()) {
                JSObject r = new JSObject();
                r.put("status", res.code());
                r.put("location", res.header("Location", ""));
                r.put("type", res.header("Content-Type", ""));
                okhttp3.ResponseBody body = res.body();
                String text = "";
                if (body != null) {
                    okio.BufferedSource src = body.source();
                    src.request(MAX_FETCH); // como mucho 5 MB (ya descomprimido por OkHttp)
                    long n = Math.min(src.getBuffer().size(), MAX_FETCH);
                    text = src.getBuffer().readString(n, java.nio.charset.StandardCharsets.UTF_8);
                }
                r.put("text", text);
                return r;
            }
        });
    }

    @PluginMethod
    public void screenshot(PluginCall call) {
        int maxWidth = call.getInt("maxWidth", 720);
        async(call, () -> JSObject.fromJSONObject(new JSONObject(shell().screenshot(maxWidth))));
    }
}
