# Proveedores: la misma lista que la web (web/js/providers.js).
# Todos hablan el formato de chat de OpenAI (/chat/completions y /models);
# Anthropic y Gemini por su capa compatible con OpenAI.

PROVIDERS = [
    # (id, nombre, URL base, pista de la clave, dónde se saca la clave)
    ("jean", "Jean-API-Generator", "", "tu JEAN_API_KEY", "github.com/jeancodeeer/Jean-API-Generator"),
    ("openai", "OpenAI", "https://api.openai.com/v1", "sk-...", "platform.openai.com/api-keys"),
    ("anthropic", "Anthropic", "https://api.anthropic.com/v1", "sk-ant-...", "console.anthropic.com/settings/keys"),
    ("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "AIza...", "aistudio.google.com/apikey"),
    ("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "sk-or-...", "openrouter.ai/keys"),
    ("groq", "Groq", "https://api.groq.com/openai/v1", "gsk_...", "console.groq.com/keys"),
    ("huggingface", "Hugging Face", "https://router.huggingface.co/v1", "hf_...", "huggingface.co/settings/tokens"),
    ("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "sk-...", "platform.deepseek.com/api_keys"),
    ("mistral", "Mistral", "https://api.mistral.ai/v1", "clave de Mistral", "console.mistral.ai/api-keys"),
    ("xai", "xAI (Grok)", "https://api.x.ai/v1", "xai-...", "console.x.ai"),
    ("together", "Together AI", "https://api.together.xyz/v1", "clave de Together", "api.together.ai/settings/api-keys"),
    ("fireworks", "Fireworks", "https://api.fireworks.ai/inference/v1", "fw_...", "fireworks.ai/account/api-keys"),
    ("cerebras", "Cerebras", "https://api.cerebras.ai/v1", "csk-...", "cloud.cerebras.ai"),
    ("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "nvapi-...", "build.nvidia.com/settings/api-keys"),
    ("sambanova", "SambaNova", "https://api.sambanova.ai/v1", "clave de SambaNova", "cloud.sambanova.ai/apis"),
    ("deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai", "clave de DeepInfra", "deepinfra.com/dash/api_keys"),
    ("hyperbolic", "Hyperbolic", "https://api.hyperbolic.xyz/v1", "clave de Hyperbolic", "app.hyperbolic.xyz/settings"),
    ("novita", "Novita AI", "https://api.novita.ai/v3/openai", "sk_...", "novita.ai/settings/key-management"),
    ("nebius", "Nebius Token Factory", "https://api.tokenfactory.nebius.com/v1", "clave de Nebius", "tokenfactory.nebius.com"),
    ("chutes", "Chutes", "https://llm.chutes.ai/v1", "cpk_...", "chutes.ai/app/api"),
    ("siliconflow", "SiliconFlow", "https://api.siliconflow.com/v1", "sk-...", "cloud.siliconflow.com/account/ak"),
    ("inference", "Inference.net", "https://api.inference.net/v1", "clave de Inference.net", "inference.net/dashboard/api-keys"),
    ("moonshot", "Moonshot (Kimi)", "https://api.moonshot.ai/v1", "sk-...", "platform.moonshot.ai/console/api-keys"),
    ("zai", "Z.ai (GLM)", "https://api.z.ai/api/paas/v4", "clave de Z.ai", "z.ai/manage-apikey/apikey-list"),
    ("dashscope", "Alibaba Qwen (DashScope)", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "sk-...", "modelstudio.console.alibabacloud.com"),
    ("minimax", "MiniMax", "https://api.minimax.io/v1", "clave de MiniMax", "www.minimax.io/platform"),
    ("cohere", "Cohere", "https://api.cohere.ai/compatibility/v1", "clave de Cohere", "dashboard.cohere.com/api-keys"),
    ("scaleway", "Scaleway (UE)", "https://api.scaleway.ai/v1", "clave secreta de Scaleway", "console.scaleway.com/iam/api-keys"),
    ("ionos", "IONOS AI (UE)", "https://openai.inference.de-txl.ionos.com/v1", "token de IONOS", "dcd.ionos.com"),
    ("litellm", "LiteLLM proxy (local)", "http://localhost:4000/v1", "clave del proxy", "docs.litellm.ai"),
    ("ollama", "Ollama (local)", "http://localhost:11434/v1", "cualquier texto", "ollama.com"),
    ("lmstudio", "LM Studio (local)", "http://localhost:1234/v1", "cualquier texto", "lmstudio.ai"),
    ("custom", "Otra API compatible con OpenAI", "", "clave", ""),
]

NOTES = {
    "jean": "Tu propia API gratis en Kaggle: pega la URL que te da el notebook (termina en /v1).",
    "anthropic": "Usa su capa compatible con OpenAI.",
    "gemini": "Tiene plan gratis con límites (Google AI Studio).",
    "groq": "Tiene plan gratis con límites por minuto y por día.",
    "cerebras": "Tiene plan gratis con límites diarios.",
    "mistral": "Tiene plan gratis de prueba con límites.",
    "huggingface": "Las cuentas gratis traen un pequeño crédito mensual.",
    "sambanova": "Pide un método de pago antes de la primera petición.",
    "cohere": "La clave de prueba es gratis, con límites y solo para uso no comercial.",
    "ollama": "En PyKernel, localhost es la máquina donde corre el puente.",
}


def index_of(pid):
    for i, p in enumerate(PROVIDERS):
        if p[0] == pid:
            return i
    return 0


def by_id(pid):
    return PROVIDERS[index_of(pid)]
