// Servicio con permisos de shell que abre Shizuku para el mini agente del móvil.
// Todo lo que cruza el binder son textos pequeños (límite de ~1 MB por llamada): los archivos van por trozos.
package io.github.jeancodeeer.jeancode;

interface IJeanShell {
    // Shizuku llama a este código de transacción para cerrar el servicio
    void destroy() = 16777114;

    // ejecuta `sh -c cmd`: JSON { code, out, err } (salida recortada a 512 KB)
    String exec(String cmd, int timeoutMs) = 1;

    // tamaño en bytes, o -1 si no existe / no es un archivo
    long size(String path) = 2;

    // trozo de un archivo en base64 (len <= 256 KB)
    String readChunk(String path, long offset, int len) = 3;

    // escribe (o añade) un trozo en base64; crea las carpetas que falten
    void writeChunk(String path, String b64, boolean append) = 4;

    // captura de pantalla reducida a maxWidth, en JPEG: JSON { b64, mime, width, height, realWidth, realHeight }
    String screenshot(int maxWidth) = 5;
}
