// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { configIsr, prerenderDe, tokenIsr, VARIABLE_TOKEN_ISR } from './src/lib/empleos/isr.mjs';
import { CONFIG_IMAGENES_VERCEL } from './src/lib/empleos/flyer.mjs';

// ---------------------------------------------------------------------------
// DOS DESTINOS DE PUBLICACION, DOS `site`/`base` DISTINTOS
// ---------------------------------------------------------------------------
//
// 1. VERCEL (publicacion principal, plan Hobby)
//    https://dstunja.com (tambien responde en paginaweb-beta-coral.vercel.app,
//    pero el canonical, el Open Graph y el sitemap apuntan siempre a dstunja.com)
//    El sitio cuelga de la RAIZ del dominio, asi que NO lleva `base`: los
//    enlaces y los assets salen como "/pqrs/" y "/_astro/...". Vercel define
//    la variable de entorno VERCEL='1' durante el build, y eso es lo unico
//    que hace falta para distinguir este caso (no hay que configurar nada a
//    mano en el panel).
//
// 2. FUERA DE VERCEL (CI, builds locales). Antes era el espejo de GitHub Pages
//    (https://dstunja.github.io/proyecto_paginaWeb), que se apago el 10/10/2026
//    al borrar .github/workflows/deploy.yml. Se sigue compilando con
//    `base: '/proyecto_paginaWeb'` porque los scripts scripts/verificar-*.mjs
//    sirven dist/client/ con ese prefijo; quitarlo exige ajustarlos a la vez.
//
// El sitio sigue siendo ESTATICO en los dos casos: `output: 'static'` compila
// todas las paginas a HTML en el build. Lo unico que corre como funcion son
// las rutas que se marcan a mano con `export const prerender = false`, que hoy
// son las de src/pages/api/pqrs/ (radicacion de PQRS, tokens de subida y
// limpieza) y las de src/pages/api/empleos/. Esas funciones solo existen en
// Vercel; fuera de Vercel no hay backend y el formulario de PQRS no radica.
//
// EXCEPCION: LAS PAGINAS DE EMPLEOS EN VERCEL VAN CON ISR. /empleos/,
// /empleos/<slug>/ y /api/empleos/vacantes.json leen las vacantes de
// Control360, y Talento Humano las cambia cuando quiere. En Vercel se sirven
// desde la cache como si fueran estaticas, pero se regeneran en segundos cuando
// Control360 avisa (POST /api/empleos/revalidar) y, si el aviso se pierde, a
// los 5 minutos. Fuera de Vercel se siguen prerenderizando. Detalle y razones
// en src/lib/empleos/isr.mjs.
//
// Ninguna ruta interna se escribe a mano: todas pasan por ruta() de
// src/lib/rutas.ts o por import.meta.env.BASE_URL, que Astro recalcula a
// partir del `base` de aqui abajo. Por eso el mismo codigo sirve para los dos
// destinos sin tocar ni un componente.
//
// dstunja.com ya apunta a Vercel, en lugar del WordPress anterior. Canonical,
// Open Graph y sitemap se generan a partir de `site`; la linea Sitemap de
// public/robots.txt es estatica y va aparte. Las URLs viejas de WordPress
// (/shop, /producto/..., /mi-cuenta/...) redirigen con 301 desde vercel.json.

/** URL publica del despliegue en Vercel: el dominio oficial. */
const SITIO_VERCEL = 'https://dstunja.com';
/** URL y prefijo del espejo en GitHub Pages. */
const SITIO_GITHUB_PAGES = 'https://dstunja.github.io';
const BASE_GITHUB_PAGES = '/proyecto_paginaWeb';

/** Vercel define VERCEL='1' en todos sus builds (produccion y preview). */
const enVercel = Boolean(process.env.VERCEL);

/**
 * Decide `prerender` de las paginas de empleos segun el destino: bajo demanda
 * (ISR) en Vercel, estaticas en GitHub Pages. El resto de rutas no se toca.
 * Tambien marca el proceso de build para que las vacantes se lean UNA vez por
 * compilacion (ver cargarVacantes en src/lib/empleos/vacantes-fuente.ts).
 * @type {import('astro').AstroIntegration}
 */
const empleosIsr = {
  name: 'dstunja-empleos-isr',
  hooks: {
    'astro:route:setup': ({ route }) => {
      // Astro ya entrega `component` con `/` en todos los sistemas operativos.
      const prerender = prerenderDe(route.component, enVercel);
      if (prerender !== undefined) route.prerender = prerender;
    },
    'astro:build:start': ({ logger }) => {
      process.env.EMPLEOS_LECTURA_UNICA = '1';
      if (enVercel && !tokenIsr(process.env)) {
        logger.warn(
          `${VARIABLE_TOKEN_ISR} no esta definida (o tiene menos de 32 caracteres): las paginas de empleos se ` +
            'actualizan solo cada 5 minutos y /api/empleos/revalidar responde 503.',
        );
      }
    },
  },
};

export default defineConfig({
  site: enVercel ? SITIO_VERCEL : SITIO_GITHUB_PAGES,
  base: enVercel ? undefined : BASE_GITHUB_PAGES,
  output: 'static',
  // `isr` solo tiene efecto sobre las rutas bajo demanda; las prerenderizadas
  // siguen siendo archivos. Fuera de Vercel no hay rutas de empleos bajo
  // demanda, asi que da igual, pero se deja apagado para que quede claro.
  //
  // `imagesConfig` solo habilita el optimizador de Vercel (/_vercel/image) para
  // los flyers de las vacantes (el bucket público de Control360, ver
  // src/lib/empleos/flyer.mjs). No se activa `imageService`: las imágenes
  // locales siguen optimizándose en el build con astro:assets, como siempre.
  adapter: vercel({
    /*
     * CUANTO PUEDE TARDAR LA FUNCION, dicho a mano.
     *
     * Sin esto se usaba el valor por defecto de la cuenta, que no esta escrito
     * en ningun sitio del repositorio y puede cambiar sin que nos enteremos. Y
     * el presupuesto importa: cuando se agota, Vercel responde 504 y NADA del
     * codigo posterior corre, en particular `ponerASalvo`
     * (src/lib/empleos/postular.ts), que es quien guarda la hoja de vida en el
     * Blob cuando el correo no sale. Agotar el reloj costaba la postulacion.
     *
     * 60 s es el techo del plan Hobby, y sobra: el peor caso de
     * /api/empleos/postular son tres intentos de correo de 8 s mas dos pausas
     * (26 s, ver ESPERA_CORREO_MS en src/lib/empleos/correo.ts), Control360 en
     * paralelo con sus propios 8 s, y el respaldo al final.
     */
    maxDuration: 60,
    isr: enVercel ? configIsr(process.env) : false,
    ...(enVercel ? { imagesConfig: CONFIG_IMAGENES_VERCEL } : {}),
  }),
  // El sitemap solo ve las paginas prerenderizadas. En Vercel las de empleos van
  // con ISR, asi que tienen su propio sitemap, tambien con ISR
  // (src/pages/sitemap-empleos.xml.ts): /empleos/ y cada vacante abierta, al dia
  // con Control360. sitemap-index.xml lo incluye con `customSitemaps`. En GitHub
  // Pages las paginas de empleos son estaticas y ya entran en sitemap-0.xml.
  integrations: [
    empleosIsr,
    sitemap(
      enVercel
        ? {
            customSitemaps: [`${SITIO_VERCEL}/sitemap-empleos.xml`],
            // /empleos/ ya va en sitemap-empleos.xml: aqui no se repite.
            filter: (pagina) => pagina !== `${SITIO_VERCEL}/empleos/`,
          }
        : {},
    ),
  ],
  // Los comentarios HTML de las plantillas NO se publican: los quita
  // src/middleware.ts al generar cada pagina. Astro no tiene opcion para eso.
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Ningun script ni recurso se incrusta en el HTML. Por defecto Astro mete
      // en linea los scripts de menos de 4 KB, y eso obligaria a la
      // Content-Security-Policy de vercel.json a permitir 'unsafe-inline' en
      // script-src. Con 0, todos salen como archivos de /_astro/ ('self').
      assetsInlineLimit: 0,
    },
  },
});
