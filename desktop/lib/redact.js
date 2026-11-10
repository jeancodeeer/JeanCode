// Redacción de secretos en el proceso principal (registros, observaciones de pantalla, salidas de comandos).
// La interfaz web tiene la misma regla en web/js/router.js (redact): el renderer no puede importar CommonJS.
// Si cambias una, cambia la otra.
const PREFIXES = /\b(sk-(?:ant-|or-|proj-)?|hf_|gsk_|xai-|fw_|csk-|jean_|jeantest_|AIza|ghp_|gho_|ghs_|github_pat_|nvapi-|glpat-|xox[abpr]-)[A-Za-z0-9_-]{6,}/g;

function redact(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')
    .replace(PREFIXES, '$1***')
    .replace(/([?&](?:key|api_key|token|access_token|password|pwd)=)[^&\s]+/gi, '$1***')
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)\S+/gi, '$1***')
    .replace(/\b[A-Za-z0-9]{32,}\b/g, '***');
}

module.exports = { redact };
