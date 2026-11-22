// Direcciones de arte para el vídeo HTML. No son plantillas: son el encargo creativo que recibe el modelo
// (paleta, tipografía, composición, lenguaje de movimiento y técnicas), y él escribe la pieza desde cero.

export const HV_STYLES = {
  auto: {
    label: 'Automático', swatch: ['#111', '#888', '#eee'],
    brief: 'Elige tú la dirección de arte que mejor sirva al pedido y comprométete con ella: paleta, tipografía y lenguaje de movimiento propios y coherentes. Evita el aspecto de plantilla corporativa genérica.',
  },
  kinetic: {
    label: 'Tipografía cinética', swatch: ['#0b0b0b', '#f4f1ea', '#ff3b1f'],
    brief: 'Tipografía cinética de festival. El texto ES la imagen: palabras enormes (Anton o Bebas Neue en mayúsculas) que llenan el encuadre, entran por letras o palabras con stagger, se escalan, giran y se recortan con clip-path. Fondo casi negro, texto hueso y un único acento rojo-naranja. Cortes al ritmo, máscaras que revelan, palabras que empujan a otras fuera de cuadro. Cero iconos, cero tarjetas.',
  },
  swiss: {
    label: 'Editorial suizo', swatch: ['#f2efe8', '#141414', '#e63312'],
    brief: 'Diseño editorial suizo. Retícula visible de 12 columnas, alineación a la izquierda, mucho blanco. Fondo papel, texto negro, un rojo puro como acento. Titulares en "IBM Plex Sans Condensed" o "Space Grotesk", números de escena grandes, filetes finos que se dibujan (scaleX desde 0), bloques de color que barren la pantalla. Movimiento preciso y seco: expo.out, nada de rebotes.',
  },
  neon: {
    label: 'Neón synthwave', swatch: ['#0a0420', '#ff2bd6', '#22e4ff'],
    brief: 'Synthwave nocturno. Fondo violeta muy oscuro con degradado, rejilla en perspectiva que avanza hacia el horizonte (transform: perspective + rotateX, animando backgroundPosition), sol de bandas al fondo. Texto con brillo neón (varios text-shadow magenta y cian). Destellos, líneas de escaneo sutiles, parpadeo de neón al encender. Tipografía "Bebas Neue" o "Space Grotesk".',
  },
  brutalist: {
    label: 'Brutalista', swatch: ['#ffe600', '#000000', '#ffffff'],
    brief: 'Brutalismo web. Amarillo chillón, negro y blanco. Bordes negros gruesos (6-10 px), sombras duras desplazadas sin desenfoque, cajas que se superponen torcidas, texto "Archivo Black" enorme, flechas y subrayados gruesos, marquesinas de texto que corren. Movimiento abrupto: steps(), golpes de escala, apariciones sin fundido. Con humor y actitud.',
  },
  luxury: {
    label: 'Lujo / premium', swatch: ['#0d0c0a', '#c9a96e', '#f5efe4'],
    brief: 'Lanzamiento premium, tipo perfume o reloj. Negro cálido, dorado champán y marfil. Serif de alto contraste ("Playfair Display" o "DM Serif Display") con mucho interletraje en los subtítulos en mayúsculas. Composición centrada y simétrica, enorme espacio negativo, líneas doradas finísimas, destello de luz que recorre el texto (degradado animado con background-clip:text). Movimiento lento y suave: sine.inOut, fundidos largos, escalas mínimas.',
  },
  tech: {
    label: 'Producto tech', swatch: ['#05070d', '#7c5cff', '#e8ecf5'],
    brief: 'Keynote de producto tecnológico. Fondo casi negro con un resplandor de color difuminado (radial-gradient grande y desenfocado) que se mueve lento. Tarjetas oscuras con borde de 1 px semitransparente y esquinas redondeadas, interfaces simuladas con CSS (barras, botones, gráficos), cursor que hace clic, números que cuentan. Tipografía "Space Grotesk" y "IBM Plex Mono" para detalles. Transiciones con escala y desenfoque (filter: blur) que se enfoca.',
  },
  data: {
    label: 'Datos animados', swatch: ['#0f1720', '#3dd68c', '#f7b733'],
    brief: 'Infografía animada. Gráficos construidos con SVG o divs: barras que crecen, líneas que se dibujan (stroke-dasharray/stroke-dashoffset), anillos de progreso, contadores que suben con HV.onFrame y toLocaleString. Paleta oscura con 2 colores de datos y gris para ejes. Cada escena: una cifra protagonista grande y su contexto. Si el usuario no da cifras, usa ejemplos plausibles y redondos.',
  },
  retro: {
    label: 'Retro VHS', swatch: ['#1b1530', '#ffcc33', '#ff4f6d'],
    brief: 'Estética VHS de los 80-90. Aberración cromática (text-shadow rojo y cian desplazados), líneas de escaneo, ruido con SVG feTurbulence, temblor de imagen (pequeños saltos de x con steps), marca de tiempo "PLAY ▶" en esquina con IBM Plex Mono, colores saturados y ligeramente lavados, títulos con contorno. Cortes con glitch: franjas horizontales desplazadas con clip-path.',
  },
  pop: {
    label: 'Pop / cómic', swatch: ['#ff5ca8', '#ffd23f', '#2b59ff'],
    brief: 'Pop art y cómic. Colores planos saturados (rosa, amarillo, azul), tramas de puntos (radial-gradient repetido), bocadillos, onomatopeyas, estrellas de explosión con clip-path polygon, contornos negros gruesos. Movimiento elástico y juguetón: back.out y elastic.out, rebotes, pequeñas rotaciones, todo con energía.',
  },
  paper: {
    label: 'Papel recortado', swatch: ['#f3e9d8', '#e76f51', '#2a9d8f'],
    brief: 'Collage de papel recortado. Formas orgánicas con bordes irregulares (SVG path) en capas con sombras suaves que dan profundidad, textura de papel con feTurbulence muy sutil, colores tierra cálidos. Las piezas entran deslizándose como en stop motion (steps(8) o ligeros giros), con parallax entre capas. Tipografía "DM Serif Display" y "Space Grotesk".',
  },
  minimal: {
    label: 'Minimal', swatch: ['#fafafa', '#111111', '#2f6bff'],
    brief: 'Minimalismo absoluto. Fondo blanco roto, una sola tipografía ("IBM Plex Sans" o "Space Grotesk") en dos pesos, un solo color de acento usado una vez por escena. Una idea por pantalla, mucho aire, formas geométricas simples (círculo, línea) que se transforman de una escena a la siguiente como hilo conductor. Movimiento suave y exacto: power3.inOut.',
  },
  cinematic: {
    label: 'Tráiler de cine', swatch: ['#000000', '#d8d2c4', '#8a1c1c'],
    brief: 'Tráiler cinematográfico. Bandas negras (formato 2.39:1 dentro del encuadre), negro profundo, textura de grano (feTurbulence animado con seed por fotograma vía HV.onFrame), destellos de luz anamórficos (degradados horizontales), títulos serif o condensados con mucho interletraje que aparecen desde el negro con desenfoque, fundidos a negro entre escenas, una frase por plano, crescendo final con el título.',
  },
};

export const styleOf = (id) => HV_STYLES[id] || HV_STYLES.auto;
