// Proveedores de modelos que JeanCode sabe conectar (inspirado en la lista de OpenCode).
// Todos hablan la API de chat de OpenAI (/v1/models y /v1/chat/completions), directamente o
// por su capa de compatibilidad. "browser": si el proveedor permite llamadas desde una página web
// (CORS). En el escritorio no importa: las peticiones salen del proceso principal.
export const PROVIDERS = [
  { id: 'jean', name: 'Jean-API-Generator', url: '', keyHint: 'tu JEAN_API_KEY', keyUrl: 'https://github.com/jeancodeeer/Jean-API-Generator', browser: true, note: 'Tu propio Codespace con Grey, Marvel y Fénix.' },
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', browser: true },
  { id: 'anthropic', name: 'Anthropic', url: 'https://api.anthropic.com/v1', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', browser: false, note: 'Usa su capa compatible con OpenAI. En la web puede bloquearse: usa el escritorio.' },
  { id: 'gemini', name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey', browser: true },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys', browser: true, note: 'Cientos de modelos con una sola clave.' },
  { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai/v1', keyHint: 'gsk_…', keyUrl: 'https://console.groq.com/keys', browser: true },
  { id: 'huggingface', name: 'Hugging Face (Inference Providers)', url: 'https://router.huggingface.co/v1', keyHint: 'hf_…', keyUrl: 'https://huggingface.co/settings/tokens', browser: true },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', keyHint: 'sk-…', keyUrl: 'https://platform.deepseek.com/api_keys', browser: false },
  { id: 'mistral', name: 'Mistral', url: 'https://api.mistral.ai/v1', keyHint: 'clave de Mistral', keyUrl: 'https://console.mistral.ai/api-keys', browser: false },
  { id: 'xai', name: 'xAI (Grok)', url: 'https://api.x.ai/v1', keyHint: 'xai-…', keyUrl: 'https://console.x.ai', browser: false },
  { id: 'together', name: 'Together AI', url: 'https://api.together.xyz/v1', keyHint: 'clave de Together', keyUrl: 'https://api.together.ai/settings/api-keys', browser: true },
  { id: 'fireworks', name: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1', keyHint: 'fw_…', keyUrl: 'https://fireworks.ai/account/api-keys', browser: true },
  { id: 'cerebras', name: 'Cerebras', url: 'https://api.cerebras.ai/v1', keyHint: 'csk-…', keyUrl: 'https://cloud.cerebras.ai', browser: true },
  { id: 'ollama', name: 'Ollama (local)', url: 'http://localhost:11434/v1', keyHint: 'cualquier texto', keyUrl: 'https://ollama.com', browser: true, local: true, note: 'En la web, Ollama debe permitir el origen: OLLAMA_ORIGINS=*' },
  { id: 'lmstudio', name: 'LM Studio (local)', url: 'http://localhost:1234/v1', keyHint: 'cualquier texto', keyUrl: 'https://lmstudio.ai', browser: true, local: true },
  { id: 'custom', name: 'Otra API compatible con OpenAI', url: '', keyHint: 'clave', keyUrl: '', browser: true },
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

/** Proveedor de un endpoint guardado (los de versiones anteriores eran todos Jean). */
export const providerOf = (ep) => providerById(ep?.provider || 'jean');

/** Solo los servidores Jean (llama.cpp) aceptan chat_template_kwargs para encender/apagar el razonamiento. */
export const supportsThinkToggle = (ep) => providerOf(ep).id === 'jean';

/** Proveedores que devuelven el consumo de tokens en streaming si se pide stream_options.include_usage. */
const USAGE_IN_STREAM = new Set(['openai', 'openrouter', 'groq', 'together', 'fireworks', 'deepseek', 'cerebras', 'mistral', 'xai', 'huggingface']);
export const wantsStreamUsage = (ep) => USAGE_IN_STREAM.has(providerOf(ep).id);

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
