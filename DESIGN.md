---
name: JeanCode
description: Cliente de los modelos Jean — chat, proyectos completos y un agente en tu PC. Taller de noche, no un tablero.
colors:
  night: "#000000"
  raise: "#0b0b0b"
  raise-2: "#141414"
  bone-ink: "#f2f1ec"
  smoke: "#a3a29b"
  ash: "#7f7e78"
  line: "#232323"
  line-2: "#3a3a38"
  line-3: "#5c5b57"
  ok: "#cfe8b8"
  bad: "#ff8a80"
typography:
  display:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.12em"
  code:
    fontFamily: "IBM Plex Mono, ui-monospace, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: "0px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  tap: "44px"
components:
  button-primary:
    backgroundColor: "{colors.bone-ink}"
    textColor: "{colors.night}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-default:
    backgroundColor: "transparent"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.smoke}"
    rounded: "{rounded.none}"
  input:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
    height: "42px"
  mode-active:
    backgroundColor: "{colors.bone-ink}"
    textColor: "{colors.night}"
    typography: "{typography.label}"
  panel:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.none}"
    padding: "24px"
---

# Design System: JeanCode

## Overview

**Creative North Star: "Taller de noche, no un tablero"**

Un banco de trabajo a oscuras: negro puro, tinta color hueso y estructura dibujada con líneas de 1 px. La herramienta se calla para que hable el trabajo, la conversación, el código y los archivos. Hay poca decoración y cada borde separa algo de verdad. El carácter viene de tres cosas: el wordmark JEANCODE en tinta con textura de fotocopia, el grano constante sobre toda la pantalla y el bloque invertido que marca la acción y la selección.

Es OPIUM más neobrutalismo más minimalismo funcional: oscuro, experimental y rebelde, pero de uso profesional. La densidad es la de una herramienta de trabajo, no la de una landing. En móvil todo se maneja con una mano, con controles de 44 px y sin scroll horizontal.

**Key Characteristics:**
- Negro puro (#000) de fondo, sin grises azulados ni cremas.
- El blanco sólido solo aparece en la acción, la selección y el foco.
- Estructura con líneas de 1 px; cero radios.
- IBM Plex en tres voces: Condensed para títulos, Sans para texto y Mono para etiquetas y código.
- Grano de fotocopia constante al 6 % y el wordmark con filtro xerox.

## Colors

Monocromo estricto: negro, hueso y cuatro grises de estructura. El verde y el rojo pálidos solo indican estado.

### Primary
- **Tinta hueso** (bone-ink): texto principal, y como relleno es la firma (botón primario, modo activo, fila seleccionada, etiqueta «TÚ»).

### Neutral
- **Noche** (night): fondo de la app y texto sobre bloques invertidos.
- **Relieve** (raise) / **Relieve 2** (raise-2): paneles, campos, burbuja del usuario; hover de filas.
- **Humo** (smoke): texto secundario, contraste 8:1 sobre negro.
- **Ceniza** (ash): texto terciario, metadatos y placeholders, 5:1.
- **Línea** (line): divisores estructurales.
- **Línea 2** (line-2): borde de controles en reposo.
- **Línea 3** (line-3): borde en hover.
- **OK** / **Error** (ok / bad): estado de la conexión, mensajes de error. Nunca como decoración.

### Named Rules
**The One Light Rule.** El relleno sólido de tinta hueso significa «esto es lo activo o lo que harás». Si dos cosas sin relación compiten con un bloque invertido en la misma pantalla, una sobra.

**The Status-Only Color Rule.** El verde y el rojo solo dicen el estado (conectado o error). Nunca tiñen superficies ni títulos.

## Typography

**Display Font:** IBM Plex Sans Condensed (con Arial Narrow)
**Body Font:** IBM Plex Sans (con system-ui)
**Label/Mono Font:** IBM Plex Mono (con ui-monospace, Consolas)

**Character:** grotesca condensada en mayúsculas para títulos, con aire de ficha técnica de moda de los años noventa, y Plex Sans de lectura tranquila para el texto. Mono para todo lo que es dato.

### Hierarchy
- **Wordmark** (700, SVG a 380 de tamaño de fuente escalado al ancho): solo en el splash y en el rail. Contorno fantasma más tinta con filtro xerox.
- **Display** (700, 24px, 1, mayúsculas): títulos de paneles (AJUSTES, DESCARGAR).
- **Title** (600, 15px, 1.2): subtítulos dentro de paneles.
- **Body** (400, 15px, 1.6): conversación y explicaciones, con un máximo de 760px de columna.
- **Label** (500, 11px, tracking 0.12em, mayúsculas): rol del mensaje, secciones del rail, cabecera de bloques de código.
- **Code** (400, 13px, 1.6): visor, bloques de código, URLs y claves.

### Named Rules
**The Data Wears Mono Rule.** URLs, claves, rutas, nombres de modelo y contadores van en Plex Mono; la prosa nunca.

## Layout

En escritorio: un rail de 360px a la izquierda (marca, modos, conversaciones, Más/Ajustes) y el área principal con barra superior (migas y selector de modelo). La conversación va centrada a 760px y el compositor anclado abajo con el mismo ancho. En el modo CODE la pantalla se parte en conversación (38 %, mínimo 300px) y archivos (árbol de 200px más visor).

Espaciado en pasos de 4/8: 4, 8, 12, 16, 24, 32 y 48px.

Responsive:
- Hasta 980px, CODE apila la conversación sobre los archivos.
- Hasta 860px, el rail pasa a cajón (86vw como máximo, 320px) con fondo oscurecido, los diálogos ocupan toda la pantalla con la cabecera fija, los controles miden 44px y los inputs 16px para evitar el zoom de iOS.
- En móvil, CODE es una sola columna con scroll: la conversación (46vh como máximo), una tira de árbol de 132px y el visor de 64vh.

### Named Rules
**The No Sideways Rule.** Ninguna pantalla desplaza en horizontal a 390px. El código largo se desplaza dentro de su bloque, nunca la página.

## Elevation & Depth

Plano por defecto. La profundidad viene de capas tonales (night → raise → raise-2) y del fondo oscurecido al 78 % detrás de los diálogos. No hay sombras difusas. La única sombra es estructural: la sombra hueca desplazada del botón primario.

### Shadow Vocabulary
- **Sombra hueca** (`box-shadow: 4px 4px 0 -1px #000, 4px 4px 0 0 #f2f1ec`): solo en la acción primaria. Al pasar el cursor crece a 6px con un translate de -1px; al pulsar se hunde a 0 con un translate de 3px.

### Named Rules
**The Flat-By-Default Rule.** Los paneles, menús y tarjetas usan un borde de 1px y nada más. Una sombra difusa sobre un borde fino es ruido.

## Shapes

Ángulos rectos en todo (0px de radio). Los bordes son de 1px. El hueco del logo es un cuadrado con borde discontinuo y una cruz, a la espera del icono definitivo.

## Components

### Buttons
- **Shape:** rectos (0px), 40px de alto (44px en móvil).
- **Primary:** bloque de tinta hueso con texto negro de peso 600 y la sombra hueca. Hover en blanco puro.
- **Default:** transparente con borde line-2; en hover, borde line-3 y fondo raise-2.
- **Quiet:** solo texto humo subrayado, para acciones secundarias como «Usar modelos de esta PC».
- **Icon:** 40px (44px en móvil), trazo de 1.75 con terminación cuadrada; el borde aparece en hover.

### Inputs / Fields
- **Style:** fondo raise, borde line-2, 0px de radio, 42px de alto.
- **Focus:** el borde pasa a tinta hueso, sin halo.
- **Error:** el mensaje va debajo en rojo pálido; el campo no cambia de color.

### Navigation
- **Modos (CHAT/CODE/AGENTE):** segmentos mono en mayúsculas; el activo es un bloque invertido.
- **Pestañas de paneles:** Plex Sans de 14px con subrayado de 2px en la activa y scroll horizontal oculto.
- **Conversaciones:** filas con un filete de 2px a la izquierda en la seleccionada.
- **Móvil:** cajón lateral con botón cerrar, fondo oscurecido y Esc.

### Mensajes
- **Usuario:** etiqueta «TÚ» invertida y burbuja raise con borde line-2.
- **Jean:** etiqueta mono en ceniza y texto libre sin caja; el razonamiento va plegado.

## Do's and Don'ts

### Do:
- **Do** reservar el relleno de tinta hueso para lo activo, lo seleccionado o la acción primaria.
- **Do** separar con líneas de 1px de los tonos line, line-2 y line-3.
- **Do** usar iconos SVG del sprite (trazo de 1.75, cuadrado), nunca glifos de texto.
- **Do** mantener 44px de área táctil y 16px de fuente en los inputs por debajo de 860px.
- **Do** respetar prefers-reduced-motion: las transiciones son de 150 a 260ms con `cubic-bezier(.16,1,.3,1)`.

### Don't:
- **Don't** usar radios, degradados ni sombras difusas.
- **Don't** escribir «jeancode» en minúscula: el nombre es JeanCode y el wordmark JEANCODE.
- **Don't** añadir colores de acento; verde y rojo solo para estado.
- **Don't** sobrecargar: si una pantalla tiene más de un bloque invertido sin relación, quita uno.
