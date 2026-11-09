// Configuración sin URLs privadas ni claves. El dueño del repo se deduce de la URL de
// GitHub Pages (<owner>.github.io/<repo>/); los valores fijos son solo un respaldo.
const FALLBACK_OWNER = 'jeancodeeer';
const FALLBACK_REPO = 'JeanCode';

function detectRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.slice(0, -'.github.io'.length);
    const repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
    return { owner, repo };
  }
  return { owner: FALLBACK_OWNER, repo: FALLBACK_REPO };
}

const { owner, repo } = detectRepo();

// Logo de la marca. Mientras sea null se muestra un hueco vacío marcado.
// Para usar uno: guarda el archivo en web/assets/ (SVG o PNG cuadrado) y pon su ruta,
// por ejemplo  logo: 'assets/logo.svg'. También reemplaza web/favicon.svg.
export const BRAND = {
  logo: null,
};

export const CONFIG = {
  owner,
  repo,
  repoUrl: `https://github.com/${owner}/${repo}`,
  apiRepoUrl: `https://github.com/${owner}/Jean-API-Generator`,
  releasesApi: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
  releasesUrl: `https://github.com/${owner}/${repo}/releases/latest`,
  isDesktop: typeof window !== 'undefined' && !!window.jeancodeDesktop,
};
