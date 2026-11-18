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
| OpenAI | `/images/generations`, `/images/edits` con máscara | No: cerró su API de vídeo el 24-09-2026 |
| OpenRouter | `/images` | `/videos` |
| xAI | `/images/generations`, `/images/edits` | `/videos/generations` |
| Together | `/images/generations` | `/v2/videos` |
| SiliconFlow | `/images/generations` | `/video/submit` |
| Google Gemini | Interactions API | Veo (`predictLongRunning`) |
| MiniMax | `/image_generation` | `/v2/video_generation` |
| Servidor propio, LiteLLM u otra API | `/images/generations` de OpenAI | `/videos` (crear, consultar, descargar) |

Un modelo que no aparezca en la lista se añade con «Escribir otro modelo…» en el selector del estudio.

## Seguridad

- La clave solo se envía al origen de la API. Una URL de descarga en otro dominio nunca la recibe, y un proveedor remoto
  no puede hacer que la app lea tu red local (`fetchMediaBlob` en `web/js/api.js`).
- El agente pide permiso en cada generación, con el modelo y el prompt a la vista; en PLAN no puede generar.
- `writeBinary` no sale de la carpeta de trabajo y nunca pisa un archivo que ya exista.

## Código

- `web/js/media/engine.js`: qué modelos sirven, qué admite cada uno, formato de cada proveedor y detección en el chat.
- `web/js/media/service.js`: biblioteca (IndexedDB), trabajos y vídeos en curso.
- `web/js/media/studio.js` y `edit.js`: la pestaña Imagen y el retoque local.
- Pruebas: bloque «imagen y vídeo» de `tests/unit.test.mjs`.
