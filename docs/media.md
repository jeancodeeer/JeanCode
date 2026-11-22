# Imagen y vídeo

JeanCode genera imagen y vídeo con los modelos de tus propias conexiones. Hay tres formas de pedirlo y las tres usan el
mismo servicio (`web/js/media/service.js`), así que todo termina en la misma galería, guardada solo en este dispositivo.

| Dónde | Cómo | Para qué |
|---|---|---|
| **Pestaña Imagen** | Estudio con todos los controles | Trabajar el prompt y editar el resultado |
| **Chat** | «genera una imagen de…», «hazla más azul», «anímala», `/imagen …`, `/video …` | Algo rápido sin salir de la conversación |
| **Agente** | Herramientas `generate_image` y `generate_video` | Recursos para un proyecto: el archivo queda en la carpeta de trabajo |

## El estudio

- **Prompt libre o guiado** (sujeto, acción, lugar, estilo, luz, cámara, paleta, detalles), estilos de un clic, «Mejorar
  prompt» con tu modelo de chat (se puede deshacer) y variantes con llaves: `un coche {rojo|azul}` genera una por opción.
- **Solo los controles que admite el modelo elegido**: proporción, resolución, duración, cantidad, referencias, primer y
  último fotograma, sonido, lo que hay que evitar, semilla, pasos, fidelidad, calidad y fondo transparente.
- **Edición**: retocar con IA (pintando la zona si el modelo admite máscara), ajustar brillo, contraste, saturación y
  temperatura, recortar, girar y voltear. Lo local no gasta nada. Cada cambio se guarda como otra versión.
- **De imagen a vídeo**: «Animar» usa la imagen como primer fotograma; en un vídeo, «Fotograma» captura el instante actual.
- Un vídeo sigue en marcha aunque cierres la app: al volver se retoma y se descarga solo.

## Proveedores

| Proveedor | Imagen | Vídeo |
|---|---|---|
| OpenAI | `/images/generations`, `/images/edits` con máscara (familia gpt-image) | `/videos`: la API oficial cerró el 24-09-2026, pero el formato sigue activo para pasarelas compatibles |
| NVIDIA (build.nvidia.com) | `ai.api.nvidia.com/v1/genai/<modelo>`: FLUX.3 klein, FLUX.1 dev, FLUX.1 schnell y FLUX.2 klein, comprobados con la API real. No admite semilla ni editar imágenes propias | No: ninguna ruta de vídeo responde |
| Hugging Face | `hf-inference/models/<modelo>` | No |
| Alibaba (DashScope) | Qwen-Image | Wan |
| Z.ai | GLM-Image | CogVideoX |
| OpenRouter | `/images` | `/videos` |
| xAI | `/images/generations`, `/images/edits` | `/videos/generations` |
| Together | `/images/generations` | `/v2/videos` |
| SiliconFlow | `/images/generations` | `/video/submit` |
| Google Gemini | Interactions API | Veo (`predictLongRunning`) |
| MiniMax | `/image_generation` | `/v2/video_generation` |
| fal.ai | Cola de `queue.fal.run` | Cola de `queue.fal.run` (añade el modelo a mano) |
| Replicate | Predicciones | Predicciones (añade el modelo a mano) |
| Black Forest Labs | FLUX.2 | No |
| Recraft | `/images/generations` | No |
| Luma | Photon | Ray |
| Stable Diffusion WebUI y Forge, en tu PC | `txt2img` e `img2img` con tus checkpoints | No |
| ComfyUI, en tu PC | Flujo estándar con tus checkpoints | No |
| Cualquier otra API compatible con OpenAI (DeepInfra, Nebius, LiteLLM, servidor propio…) | `/images/generations` | `/videos` (crear, consultar, descargar) |

Un modelo que no aparezca en la lista se añade con «Escribir otro modelo…» en el selector del estudio.

## Vídeo con HTML

La pestaña **HTML** del estudio crea vídeo sin un modelo de vídeo y este dispositivo lo convierte en MP4 fotograma a
fotograma. También funciona con `/videohtml`, pidiéndolo en el chat, con la herramienta `render_html_video` del agente y,
si no tienes ningún modelo de vídeo, al pedir un vídeo en el chat.

- **Desde cero, como un estudio:** el modelo de lenguaje que elijas (mejor cuanto más potente: Claude, GPT, Gemini,
  Qwen Coder, DeepSeek…) primero idea un plan creativo (concepto, paleta, tipografía y escenas con sus tiempos) y luego
  escribe toda la animación en HTML, CSS y JS. La app revisa cómo queda renderizada (texto que se sale, se pisa o no se
  lee) y le pide corregirlo una vez.
- **Estilos:** Automático, Tipografía cinética, Editorial suizo, Neón synthwave, Brutalista, Lujo, Producto tech, Datos
  animados, Retro VHS, Pop/cómic, Papel recortado, Minimal y Tráiler de cine. No son plantillas: son el encargo de dirección
  de arte que recibe el modelo.
- **Técnicas:** línea de tiempo estilo GSAP, `@keyframes` de CSS, `<canvas>` y SVG con `HV.onFrame(t)`. Todo corre sobre un
  reloj virtual, así que el mismo instante da siempre el mismo fotograma.
- **Retocar:** «Pedir cambios» modifica la pieza; «Otra versión» la reescribe desde cero con el mismo pedido y estilo.
- **Sonido:** música y efectos sintetizados en el dispositivo, sin muestras de terceros, con los cortes sobre el pulso.

- **Formato:** el de [HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache-2.0): raíz con
  `data-composition-id`, clips con `data-start` y `data-duration`, y una línea `gsap.timeline({ paused: true })` registrada
  en `window.__timelines`. Sus skills se pueden instalar como plugin desde Ajustes.
- **Motor propio:** JeanCode no descarga GSAP ni Chrome. `jcHvRuntime` trae un reloj virtual y la parte de la API de
  timeline que usan estas composiciones. El mismo instante da siempre el mismo fotograma.
- **Aislamiento:** la composición corre en un iframe sin origen y sin red. No ve tus claves ni tu historial.
- **Tipografías:** Anton, Bebas Neue, Archivo Black, Playfair Display, DM Serif Display y Space Grotesk (SIL OFL), incluidas
  en la app.
- **Límites:** hasta 120 s y sin vídeos dentro de la composición.
- **Safari e iPhone:** Safari no deja leer un lienzo donde se dibujó HTML, así que allí JeanCode usa su propio dibujo:
  recorre la composición y pinta cajas, degradados, bordes, sombras, texto (también con degradado y brillo), SVG,
  `<canvas>`, recortes (`clip-path`), opacidad y transformaciones. No dibuja `filter` (desenfoque) ni efectos 3D.
  El sonido depende de que el navegador pueda codificar audio; si no, el vídeo sale sin sonido.

## Modelos locales

- **Ollama** va por su API propia (`/api/chat`): JeanCode pide el contexto que necesita la conversación, por escalones y sin
  pasar del máximo del modelo. Por la API compatible con OpenAI se quedaría en 4096 tokens en la mayoría de equipos.
- **Ollama y LM Studio** informan del contexto real, las herramientas y la visión de cada modelo.
- **Agente:** con un modelo local usa menos herramientas e instrucciones más cortas, y los subagentes van de uno en uno.
- **Detectar modelos de esta PC** también encuentra Stable Diffusion WebUI, Forge y ComfyUI.

## Seguridad

- La clave solo se envía al origen de la API. Una URL de descarga en otro dominio nunca la recibe.
- Un proveedor remoto no puede hacer que la app lea tu red local (`fetchMediaBlob` en `web/js/api.js`). En el escritorio y en
  Android se comprueba el DNS de cada salto y la conexión va a esa IP. En la web y en iPhone, una URL ajena no sigue
  redirecciones: si la tiene, el resultado se muestra por su enlace sin que la app lea la respuesta.
- El agente pide permiso en cada generación, con el modelo y el prompt a la vista; en PLAN no puede generar.
- `writeBinary` no sale de la carpeta de trabajo y nunca pisa un archivo que ya exista.

## Código

- `web/js/media/engine.js`: qué modelos sirven, qué admite cada uno, formato de cada proveedor y detección en el chat.
- `web/js/media/service.js`: biblioteca (IndexedDB), trabajos y vídeos en curso.
- `web/js/media/studio.js` y `edit.js`: la pestaña Imagen y el retoque local.
- `web/js/media/htmlstyles.js`: direcciones de arte. `htmlaudio.js`: banda sonora.
- `web/js/media/htmlvideo.js`, `htmlrender.js`, `htmlstudio.js` y `mp4.js`: motor, exportación y pestaña HTML.
- Pruebas: bloque «imagen y vídeo» de `tests/unit.test.mjs`.
