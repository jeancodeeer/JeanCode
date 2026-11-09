// Proveedores que JeanCode sabe conectar (inspirado en la lista de OpenCode) y sus ADAPTADORES.
// Todos hablan la API de chat de OpenAI (/v1/models y /v1/chat/completions), directamente o por su
// capa de compatibilidad, así que la petición normalizada es la de OpenAI y cada adaptador solo
// declara en qué se aparta. El resto de JeanCode nunca pregunta "¿es OpenAI o Groq?": usa adapterOf().
//
// Para agregar un proveedor: una entrada en PROVIDERS. Campos:
//   url, keyHint, keyUrl, note   lo que ve el usuario al conectarlo
//   browser   true si el proveedor permite llamadas desde una página web (CORS); en el escritorio da igual
//   local     corre en la PC del usuario
//   billing   'own' (servidor propio), 'paid' (cobra por uso) o null (desconocido); local => sin coste
//   adapter   solo lo que difiere del estándar (ver DEFAULT_ADAPTER)
import { reportCaps } from './capabilities.js';

/** Comportamiento estándar OpenAI-compatible. */
const DEFAULT_ADAPTER = {
  headers: () => ({}),                 // cabeceras extra (nunca la clave: la pone api.js)
  thinkToggle: false,                  // acepta chat_template_kwargs.enable_thinking
  usageInStream: false,                // devuelve el consumo si se pide stream_options.include_usage
  /** Ajusta el cuerpo normalizado {model, messages, stream, temperature, tools?} para este proveedor. */
  request: (payload) => payload,
  /** Lee GET /models y registra lo que el proveedor informe de cada modelo. Devuelve los ids. */
  models: (json, ep) => {
    const list = json.data || json.models || [];
    if (!Array.isArray(list)) throw new TypeError('la respuesta de /models no trae una lista de modelos');
    return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  },
};

/** OpenRouter informa, por modelo, contexto, precio, modalidades y parámetros aceptados. Se usan tal cual. */
const OPENROUTER_ADAPTER = {
  usageInStream: true,
  headers: () => ({ 'X-Title': 'JeanCode' }),
  models: (json, ep) => (json.data || []).map((m) => {
    const params = new Set(m.supported_parameters || []);
    const prompt = Number(m.pricing?.prompt), completion = Number(m.pricing?.completion);
    reportCaps(ep, m.id, {
      context: m.context_length || m.top_provider?.context_length || null,
      maxOutput: m.top_provider?.max_completion_tokens || null,
      vision: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : null,
      tools: m.supported_parameters ? params.has('tools') : null,
      structured: m.supported_parameters ? (params.has('structured_outputs') || params.has('response_format')) : null,
      chat: Array.isArray(m.architecture?.output_modalities) ? m.architecture.output_modalities.includes('text') : null,
      price: Number.isFinite(prompt) && Number.isFinite(completion) ? { prompt, completion } : null,
    });
    return m.id;
  }),
};

/** Jean-API-Generator (llama-server, o su router en :8899 que informa el contexto real de cada puerto). */
const JEAN_ADAPTER = {
  thinkToggle: true,
  models: (json, ep) => (json.data || []).map((m) => {
    // contexto CONFIGURADO en llama-server (-c), no el de entrenamiento: es el límite real
    // Medido en vivo: serve.sh pide -c 131072 pero llama-server lo limita al del modelo (Marvel: 32768).
    // Por eso solo cuenta lo que informa el servidor (el router, o /props de un puerto suelto en api.js).
    const ctx = m.jean?.context_length;
    if (ctx) reportCaps(ep, m.id, { context: ctx });
    return m.id;
  }).filter(Boolean),
};

const USAGE = { usageInStream: true };

export const PROVIDERS = [
  { id: 'jean', name: 'Jean-API-Generator', url: '', keyHint: 'tu JEAN_API_KEY', keyUrl: 'https://github.com/jeancodeeer/Jean-API-Generator', browser: true, billing: 'own', adapter: JEAN_ADAPTER, note: 'Tu propio Codespace con Grey, Marvel y Fénix. Usa la URL del puerto 8899 (router).' },
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', browser: true, billing: 'paid', adapter: USAGE },
  { id: 'anthropic', name: 'Anthropic', url: 'https://api.anthropic.com/v1', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', browser: false, billing: 'paid', note: 'Usa su capa compatible con OpenAI. En la web puede bloquearse: usa el escritorio.' },
  { id: 'gemini', name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey', browser: true, billing: 'paid' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys', browser: true, billing: 'paid', adapter: OPENROUTER_ADAPTER, note: 'Cientos de modelos con una sola clave. Informa precio y contexto de cada uno.' },
  { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1', keyHint: 'gsk_…', keyUrl: 'https://console.groq.com/keys', browser: true, billing: 'paid', adapter: USAGE },
  { id: 'huggingface', name: 'Hugging Face (Inference Providers)', url: 'https://router.huggingface.co/v1', keyHint: 'hf_…', keyUrl: 'https://huggingface.co/settings/tokens', browser: true, billing: 'paid', adapter: USAGE },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', keyHint: 'sk-…', keyUrl: 'https://platform.deepseek.com/api_keys', browser: false, billing: 'paid', adapter: USAGE },
  { id: 'mistral', name: 'Mistral', url: 'https://api.mistral.ai/v1', keyHint: 'clave de Mistral', keyUrl: 'https://console.mistral.ai/api-keys', browser: false, billing: 'paid', adapter: USAGE },
  { id: 'xai', name: 'xAI (Grok)', url: 'https://api.x.ai/v1', keyHint: 'xai-…', keyUrl: 'https://console.x.ai', browser: false, billing: 'paid', adapter: USAGE },
  { id: 'together', name: 'Together AI', url: 'https://api.together.xyz/v1', keyHint: 'clave de Together', keyUrl: 'https://api.together.ai/settings/api-keys', browser: true, billing: 'paid', adapter: USAGE },
  { id: 'fireworks', name: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1', keyHint: 'fw_…', keyUrl: 'https://fireworks.ai/account/api-keys', browser: true, billing: 'paid', adapter: USAGE },
  { id: 'cerebras', name: 'Cerebras', url: 'https://api.cerebras.ai/v1', keyHint: 'csk-…', keyUrl: 'https://cloud.cerebras.ai', browser: true, billing: 'paid', adapter: USAGE },
  { id: 'ollama', name: 'Ollama (local)', url: 'http://localhost:11434/v1', keyHint: 'cualquier texto', keyUrl: 'https://ollama.com', browser: true, local: true, note: 'En la web, Ollama debe permitir el origen: OLLAMA_ORIGINS=*' },
  { id: 'lmstudio', name: 'LM Studio (local)', url: 'http://localhost:1234/v1', keyHint: 'cualquier texto', keyUrl: 'https://lmstudio.ai', browser: true, local: true },
  { id: 'custom', name: 'Otra API compatible con OpenAI', url: '', keyHint: 'clave', keyUrl: '', browser: true, billing: null },
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

/** Proveedor de un endpoint guardado (los de versiones anteriores eran todos Jean). */
export const providerOf = (ep) => providerById(ep?.provider || 'jean');

/** Adaptador completo (estándar + lo propio del proveedor). */
export const adapterOf = (ep) => ({ ...DEFAULT_ADAPTER, ...(providerOf(ep).adapter || {}) });

/** Solo los servidores Jean (llama.cpp) aceptan chat_template_kwargs para encender/apagar el razonamiento. */
export const supportsThinkToggle = (ep) => adapterOf(ep).thinkToggle;

/** Proveedores que devuelven el consumo de tokens en streaming si se pide stream_options.include_usage. */
export const wantsStreamUsage = (ep) => adapterOf(ep).usageInStream;

/** Servidores locales que JeanCode prueba al pulsar "Detectar modelos de esta PC". */
export const LOCAL_CANDIDATES = [
  { provider: 'ollama', label: 'Ollama', url: 'http://localhost:11434/v1' },
  { provider: 'lmstudio', label: 'LM Studio', url: 'http://localhost:1234/v1' },
  { provider: 'custom', label: 'llama.cpp (llama-server)', url: 'http://localhost:8080/v1' },
  { provider: 'custom', label: 'vLLM / text-generation-webui', url: 'http://localhost:8000/v1' },
  { provider: 'jean', label: 'Jean-API-Generator local', url: 'http://localhost:8888/v1' },
  { provider: 'custom', label: 'Jan', url: 'http://localhost:1337/v1' },
];

/** Modelos de código recomendados para instalar con Ollama (nombre exacto de `ollama pull`). */
export const OLLAMA_SUGGESTED = [
  { name: 'qwen2.5-coder:7b', note: '4.7 GB · buen equilibrio para código' },
  { name: 'qwen2.5-coder:1.5b', note: '1 GB · PCs con poca RAM' },
  { name: 'llama3.2:3b', note: '2 GB · chat general rápido' },
  { name: 'deepseek-coder-v2:16b', note: '8.9 GB · más capaz, necesita 16 GB de RAM' },
];
