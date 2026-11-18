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
| NVIDIA (build.nvidia.com) | `ai.api.nvidia.com/v1/genai/<modelo>`: FLUX.1 dev, schnell y Kontext, FLUX.2 klein, FLUX.3, Stable Diffusion 3.5, Qwen-Image | No: sus modelos hospedados de vídeo no tienen una API pública documentada |
| Hugging Face | `hf-inference/models/<modelo>` | No |
| Alibaba (DashScope) | Qwen-Image | Wan |
| Z.ai | GLM-Image | CogVideoX |
| OpenRouter | `/images` | `/videos` |
| xAI | `/images/generations`, `/images/edits` | `/videos/generations` |
| Together | `/images/generations` | `/v2/videos` |
| SiliconFlow | `/images/generations` | `/video/submit` |
| Google Gemini | Interactions API | Veo (`predictLongRunning`) |
| MiniMax | `/image_generation` | `/v2/video_generation` |
| Cualquier otra API compatible con OpenAI (DeepInfra, Nebius, LiteLLM, servidor propio…) | `/images/generations` | `/videos` (crear, consultar, descargar) |

Un modelo que no aparezca en la lista se añade con «Escribir otro modelo…» en el selector del estudio.

## Vídeo con HTML

La pestaña **HTML** del estudio crea vídeo sin un modelo de vídeo: tu modelo de chat escribe una composición animada y
este dispositivo la convierte en MP4 fotograma a fotograma. También funciona con `/videohtml`, pidiéndolo en el chat, con
la herramienta `render_html_video` del agente y, si no tienes ningún modelo de vídeo, al pedir un vídeo en el chat.

- **Formato:** el de [HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache-2.0): raíz con
  `data-composition-id`, clips con `data-start` y `data-duration`, y una línea `gsap.timeline({ paused: true })` registrada
  en `window.__timelines`. Sus skills se pueden instalar como plugin desde Ajustes.
- **Motor propio:** JeanCode no descarga GSAP ni Chrome. `jcHvRuntime` trae un reloj virtual y la parte de la API de
  timeline que usan estas composiciones. El mismo instante da siempre el mismo fotograma.
- **Aislamiento:** la composición corre en un iframe sin origen y sin red. No ve tus claves ni tu historial.
- **Límites:** sale sin sonido, hasta 120 s, y no puede incluir vídeos dentro. Safari no permite leer este tipo de dibujo:
  en iPhone se puede previsualizar, pero hay que exportar desde el escritorio, Android, Chrome o Edge.

## Seguridad

- La clave solo se envía al origen de la API. Una URL de descarga en otro dominio nunca la recibe.
- Un proveedor remoto no puede hacer que la app lea tu red local (`fetchMediaBlob` en `web/js/api.js`). En el escritorio y en
  Android se comprueba el DNS de cada salto y la conexión va a esa IP. En la web y en iPhone, las URL ajenas se piden como
  cualquier página: el navegador impide leer una red privada, y el destino final también se comprueba.
- El agente pide permiso en cada generación, con el modelo y el prompt a la vista; en PLAN no puede generar.
- `writeBinary` no sale de la carpeta de trabajo y nunca pisa un archivo que ya exista.

## Código

- `web/js/media/engine.js`: qué modelos sirven, qué admite cada uno, formato de cada proveedor y detección en el chat.
- `web/js/media/service.js`: biblioteca (IndexedDB), trabajos y vídeos en curso.
- `web/js/media/studio.js` y `edit.js`: la pestaña Imagen y el retoque local.
- `web/js/media/htmlvideo.js`, `htmlrender.js`, `htmlstudio.js` y `mp4.js`: el vídeo con HTML.
- Pruebas: bloque «imagen y vídeo» de `tests/unit.test.mjs`.
