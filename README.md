# Distribuciones Santiago de Tunja — sitio web

Sitio hecho en **Astro + Tailwind CSS 4 (TypeScript estricto)**, publicado en
**Vercel** (<https://dstunja.com>) y desplegado solo con cada `git push` a `main`.
Las páginas son estáticas; solo `src/pages/api/**` (PQRS y empleos) corre como
función de Vercel. Las visitas las cuenta Vercel Web Analytics, sin cookies
(ver `docs/ANALITICA.md`).

Empezó como un prototipo en HTML plano; ese prototipo ya no está en el
repositorio (sigue en el historial de git, carpeta `legacy-html/`).

---

## Requisitos

- **Node.js 22.12 o superior** (Astro no arranca con versiones menores). En
  Windows: `winget install OpenJS.NodeJS.LTS` y reabrir la terminal.

## Cómo trabajar

```bash
npm ci               # instala exactamente lo del package-lock.json
npm run dev          # servidor local en http://localhost:4321
npm test             # pruebas (Vitest) de los módulos de servidor
npm run check        # revisa tipos y plantillas (astro check)
npm run build        # compila: el sitio queda en dist/client/ y la función en dist/server/
npm run preview      # ver el build como quedará en producción
npm run check:env    # comprueba las variables de entorno antes de arrancar
npm run og           # regenera la tarjeta de link (public/og.png)
npm run favicon      # regenera favicon.ico y apple-touch-icon desde el isotipo
npm run geocodificar # busca las coordenadas que falten (municipios y sede)
npm run iconos       # las dos anteriores
npm run verificar:navegacion  # recorre el sitio con Playwright (CSP, mapas, formularios)
```

Las mismas tres comprobaciones que corre la CI (`npm test`, `npx astro check` y
`npm run build`) conviene pasarlas antes de abrir un PR.

> **Build en Windows con `node_modules` enlazado (junction):** el adaptador de
> Vercel crea, al final del build, un enlace simbólico de `node_modules` dentro
> de `.vercel/output/`. Si `node_modules` es un junction a otra carpeta,
> Windows responde `EPERM` en ese paso. Las páginas ya quedaron generadas en
> `dist/client/`; es un problema del entorno local, no del código (en Vercel y
> en la CI no pasa).

## Estructura

```
src/
  data/site.ts             Datos de la empresa: teléfono, correo, marcas,
                           municipios, cifras, menú. EDITAR AQUÍ primero.
  data/vacantes.ts         Vacantes y convocatorias (listado y detalle).
  data/clientes-municipio.ts  Clientes reales por municipio (base de datos).
  data/coordenadas.json    Caché de coordenadas geocodificadas con Nominatim.
  data/municipios.ts       Cruce de los dos anteriores: lo que usa el mapa.
  data/innovaciones.ts     Novedades mes a mes de la página de innovación.
  data/especiales.ts       Especiales del mes (inicio y línea de tiempo de innovación).
  data/reseñas.ts          Reseñas de Google. Vacío a propósito: solo datos reales.
  data/misionVision.ts     Texto oficial de misión y visión.
  lib/rutas.ts             ruta(): antepone el `base` a los enlaces internos y
                           a los archivos de public/. OBLIGATORIO usarlo.
  lib/mapa-base.ts         Teselas de los mapas (OpenStreetMap / CARTO).
  lib/adjuntos.ts          Reglas de los archivos de soporte de la PQRS:
                           formatos, peso y saneado del nombre. El mismo archivo
                           lo usan el navegador y las funciones de servidor.
  lib/turnstile-cliente.ts Widget antirrobots de Cloudflare en el navegador.
  lib/pqrs/                Servidor de la radicacion: configuracion, radicado,
                           Turnstile, limite de tasa, Vercel Blob, correos con
                           Resend y la orquestacion (radicar.ts, con pruebas).
  lib/pqrs/categorias.ts   Las dos categorias de PQRS (administrativa y
                           comercial): que enseña cada una, si admite adjuntos y
                           si genera radicado. No lee el entorno.
  lib/pqrs/administrativa.ts  El recado del bloque administrativo: valida, limita
                           por IP, comprueba Turnstile y manda UN correo. No
                           radica nada. Con pruebas.
  pages/api/pqrs/          Funciones de Vercel: token de subida, radicacion,
                           recado administrativo y cron de limpieza. Ver
                           docs/PQRS-ADJUNTOS.md.
  lib/empleos/             Servidor de las postulaciones de /empleos/: cargos
                           admitidos, reglas de la hoja de vida (PDF, DOC o
                           DOCX, 4 MB), validacion del multipart, correo con
                           el adjunto y la orquestacion (postular.ts, con
                           pruebas). Reutiliza Resend, Turnstile y el limite
                           por IP de lib/pqrs/.
  pages/api/empleos/       Funcion de Vercel que recibe la postulacion. Ver
                           docs/EMPLEOS-POSTULACION.md.
  lib/imagenes.ts          Imágenes con reemplazo automático: si el archivo aún
                           no existe se muestra un marcador de posición (o el
                           nombre en texto, para los logos de marca).
  layouts/BaseLayout.astro Estructura común: <head>, SEO, Open Graph, JSON-LD,
                           encabezado, pie y botón flotante de WhatsApp.
  components/
    Header.astro           Menú (con versión móvil funcional).
    Footer.astro           Pie con contacto, canales y redes.
    Logo.astro             Logo oficial: completo, claro (fondo oscuro) e iso.
    Icono.astro            Todos los íconos (lucide + logos de marca).
    Resenas.astro          Reseñas de Google. Sin reseñas reales cargadas, solo
                           enlaces a la empresa en Google, sin cifras.
    MisionVision.astro     Pestañas accesibles de Misión / Visión.
    BuscadorCobertura.astro Buscador de municipios (ignora tildes y mayúsculas).
    MapaCobertura.astro    Mapa de la sede, a nivel de calle (Leaflet).
    MapaRed.astro          Mapa interactivo de cobertura: un punto por
                           municipio, filtros por departamento y buscador.
    BotonPideky.astro      Botón de Pideky.
    FormularioMailto.astro Formulario de contacto (abre el gestor de correo).
                           Ni la PQRS ni empleos lo usan ya.
    FormularioEmpleo.astro Postulacion de empleos: manda los datos y la hoja de
                           vida adjunta a /api/empleos/postular, con campo
                           trampa, Turnstile y respaldo por mailto: si la
                           funcion no contesta.
    SelectorOpciones.astro Grupo de tarjetas seleccionables (radios nativos).
                           Lo usan los dos pasos de la PQRS: categoria y tipo.
                           Cada opcion puede revelar y ocultar bloques distintos,
                           que es como la categoria bifurca la pagina.
    ContactoAdministrativo.astro  Lo que sale al elegir la categoria
                           administrativa: telefono, WhatsApp y correo (de
                           src/data/site.ts) con boton de copiar, mas un
                           formulario corto y opcional que manda un recado.
    CampoMunicipio.astro   Municipio de la PQRS: combobox cerrado a los 87
                           municipios de cobertura, con busqueda sin tildes y
                           preseleccion opcional por ubicacion.
    ContadorCaracteres.astro  Minimo y contador de caracteres bajo un campo de
                           texto largo (descripcion y "¿Que necesitas?" de PQRS).
    CampoAdjuntos.astro    Archivos de soporte de la PQRS, siempre opcionales.
                           Aparece en la categoria comercial, en sus cinco
                           tipos; lo decide la categoria, no el tipo.
    FormularioPqrs.astro   Formulario de radicacion de PQRS, solo de la
                           categoria comercial: sube los soportes a Vercel Blob,
                           llama a /api/pqrs y muestra el radicado.
    PageHero.astro         Encabezado de las páginas internas.
  pages/                   Una página por archivo: index, nosotros, catalogo,
                           innovacion, empleos, contactanos, pqrs y 404.
  pages/empleos/[slug].astro  Detalle de cada vacante, con el flyer completo.
  styles/global.css        Paleta, tipografías y clases base (Tailwind 4).
public/
  logo-distribuciones.png  Logotipo horizontal (encabezado).
  LOGO-removebg-preview.png  Isotipo (pie, móvil, favicon, tarjeta OG).
  favicon.ico / apple-touch-icon.png / icon-192.png / icon-512.png
  icons/whatsapp.svg       Ícono oficial de WhatsApp, también disponible suelto.
  img/empleos/             Fotos y flyers de las vacantes.
  img/innovacion/          Imágenes de las novedades.
  og.png, robots.txt
scripts/build-og.mjs       Genera la tarjeta Open Graph con Playwright.
scripts/build-favicon.mjs  Genera los íconos a partir del isotipo.
scripts/geocodificar.mjs   Consulta Nominatim y llena data/coordenadas.json.
.github/workflows/ci.yml   CI: pruebas, astro check y build en cada PR y push a main.
```

## Qué editar y dónde

| Quiero cambiar… | Archivo |
| --- | --- |
| Teléfono, correo, dirección, redes | `src/data/site.ts` |
| Lista real de los 87 municipios | `src/data/clientes-municipio.ts` (nombres y clientes) + `src/data/coordenadas.json` (lat/lng). `src/data/municipios.ts` los cruza y es lo que importan el mapa, la cobertura y el campo de municipio de la PQRS |
| Enlace real de Pideky | `src/data/site.ts` → `PIDEKY_URL` |
| Textos de Misión y Visión (oficiales) | `src/data/misionVision.ts` |
| Año de fundación (los «años de experiencia» se calculan solos) | `src/data/site.ts` → `ANIO_FUNDACION` |
| Colores y tipografía | `src/styles/global.css` (bloque `@theme`) |
| Foto del hero (camión / bodega) | `src/data/site.ts` → `HERO_IMAGEN` |
| Reseñas de Google (solo reales) | `src/data/reseñas.ts` |
| Especiales del mes | `src/data/especiales.ts` |
| Íconos disponibles | `src/components/Icono.astro` |
| Categorías del catálogo | `src/pages/catalogo.astro` |
| Vacantes y convocatorias | `src/data/vacantes.ts` |
| Novedades de innovación | `src/data/innovaciones.ts` |
| Municipios del mapa de cobertura | `src/data/municipios.ts` |
| Vacantes de empleo | `src/pages/empleos.astro` |
| Horario de atención | `src/pages/contactanos.astro` |

Busca `EDITAR AQUÍ` en el código: marca los textos de ejemplo que faltan por
reemplazar con la información oficial.

## Imágenes

Las fotos van en `public/img/`, en tres carpetas. **Nada se rompe si una imagen
todavía no existe**: el sitio la reemplaza solo.

| Carpeta | Para qué | Nombre del archivo | Si falta |
| --- | --- | --- | --- |
| `img/empleos/` | Foto o flyer de cada vacante | El que diga `imagen` en `src/data/vacantes.ts` | Marcador azul con el nombre del cargo |
| `img/innovacion/` | Imagen de cada novedad | El que diga `imagen` en `src/data/innovaciones.ts` | Marcador azul con el título |
| `src/assets/marcas/` | Logotipo de cada marca (no va en `public/`) | El nombre de la marca en minúsculas y con guiones | La marca se muestra como píldora de texto, y en la franja del inicio no se muestra |

**Logos de marca**: van en `src/assets/marcas/` (no en `public/`), porque solo
las imágenes de `src/` pasan por el optimizador de Astro y así cada logo se
sirve en el tamaño justo y con versión @2x para pantallas de alta densidad. El
archivo se busca por el nombre de la marca en minúsculas y sin tildes:
`Saltín Noel` → `saltin-noel.png`, `Choco Listo` → `choco-listo.png`. Sirven
`.png`, `.svg`, `.webp`, `.jpg` y `.avif`; entre más grande sea el original,
mejor, y como mínimo el doble del tamaño al que se muestra.

La franja "Marcas que distribuimos" del inicio muestra **solo** las marcas con
logotipo, listadas en `marcasDeLaFranja` (`src/data/site.ts`); ninguna se
muestra ahí como texto. El catálogo y el armador de pedidos sí siguen mostrando
las marcas sin logo como píldora de texto.

**Tamaños recomendados**: 1200×900 (4:3) para las tarjetas de vacantes y
1200×675 (16:9) para innovación. El flyer vertical de una convocatoria también
sirve: en la página de detalle se muestra completo, sin recortar.

Los marcadores de posición se piden a [placehold.co](https://placehold.co) con
los colores de la marca, así que **solo se ven con conexión a internet**. En
cuanto dejes el archivo real en su carpeta y vuelvas a compilar, el marcador
desaparece sin tocar el código. Todos los puntos donde falta una imagen real
están marcados en el código con `EDITAR AQUÍ`.

## Mapa de la red comercial

La sección "Nuestra cobertura" del inicio dibuja **un punto por municipio
atendido**: 87 puntos, con el color de su departamento. El número de clientes no
se pinta sobre el mapa; aparece al pasar el mouse o al tocar el punto, para que
el mapa se lea limpio. Tunja lleva además el punto pulsante de sede principal.

De dónde sale cada dato:

| Archivo | Qué guarda | Cómo se actualiza |
| --- | --- | --- |
| `src/data/clientes-municipio.ts` | Clientes por municipio, de la base de datos real | Regenerándolo desde el Excel de clientes |
| `src/data/coordenadas.json` | Coordenadas de cada cabecera y de la sede | `npm run geocodificar` |
| `src/data/municipios.ts` | Cruce de los dos anteriores | Solo, al compilar |

`npm run geocodificar` consulta [Nominatim](https://nominatim.openstreetmap.org)
(OpenStreetMap, gratis y sin API key), respeta su límite de una consulta por
segundo y **solo pide lo que falte**: como el resultado queda en
`coordenadas.json`, una compilación normal no genera ni una petición. Si alguna
coordenada quedara mal, se corrige a mano en ese JSON; para volver a pedirla,
basta con borrar esa entrada.

### Fondo del mapa

Las teselas se configuran en un solo archivo, `src/lib/mapa-base.ts`, que usan
los dos mapas del sitio. Hoy está activo **OpenStreetMap estándar**: el mapa
clásico a color, con calles, parques en verde, agua en azul y los nombres de
municipios y veredas. La atribución "© OpenStreetMap contributors" es
obligatoria por licencia y se muestra en la esquina del mapa.

Ese archivo deja lista una segunda opción, **CARTO Voyager**, igual de colorida
pero servida desde una CDN pensada para producción. Conviene cambiar a ella si
el sitio empieza a recibir mucho tráfico: los servidores de teselas de
OpenStreetMap son donados y su política de uso pide no apoyarse en ellos para
aplicaciones con mucho público. El cambio es una línea:

```ts
export const FONDO: FondoMapa = FONDOS.cartoVoyager;
```

Sobre el fondo a color los puntos llevan un aro blanco de 3 px y una sombra
suave; sin eso se perderían entre las calles y los parques.

El tamaño del punto crece un poco con la cantidad de clientes (radio de 6 a
12 px) para que se vea de un vistazo dónde está el grueso de la red. Para que
todos midan igual, basta con dejar fijo el radio en `MapaRed.astro`.

Los 4 clientes fuera de la zona (3 en Bogotá y 1 en Medellín) no se dibujan: el
mapa es el de la red de los tres departamentos.

El mapa de **Contáctanos** es distinto: muestra la sede a nivel de calle
(zoom 16), centrada en la coordenada geocodificada de Cra 2 Este #58-79.

## Identidad visual

**Paleta** (definida en `@theme`, en `src/styles/global.css`):

| Token | Color | Uso |
| --- | --- | --- |
| `primary` | `#0D2C84` | Azul oscuro: títulos, botón principal, barra de cifras |
| `secondary` | `#1E88E5` | Azul: íconos, acentos, bordes activos |
| `secondary-dark` | `#1565C0` | Azul para texto y enlaces (contraste AA) |
| `accent` | `#F5A623` | Naranja: botón destacado, subrayados, estrellas |
| `accent-text` | `#9A5800` | Naranja legible sobre fondo claro (antetítulos, textos): AA también sobre el velo naranja |
| `base` | `#F5F7FA` | Gris muy claro: franjas alternas |
| `ink` | `#263238` | Gris oscuro: texto y pie de página |

Los botones naranja llevan texto oscuro (`ink`) porque el blanco sobre `#F5A623`
no alcanza el contraste mínimo AA. Por lo mismo, el naranja de los textos es
`accent-text` y no el naranja puro.

**Tipografía**, self-hosted con Fontsource (nada de Google Fonts por CDN). Son
cuatro fuentes, y se reparten en dos grupos: dos para el sitio y dos, solo dos,
para el nombre de la marca.

Las del sitio, con token propio en `global.css`:

- **Montserrat** (`--font-display`, utilidad `font-display`) — Bold en `h1`,
  SemiBold en `h2`/`h3`/`h4`, botones, menú y cifras destacadas.
- **Poppins** (`--font-body`) — Regular para todo el texto de cuerpo. Es la
  fuente por defecto del `body`, así que no hace falta pedirla.

Poppins no existe como fuente variable, así que se cargan los pesos 400, 500 y
600 desde `@fontsource/poppins`; Montserrat sí es variable
(`@fontsource-variable/montserrat`).

Las de la marca sirven **únicamente** para el nombre de la empresa junto al
isotipo, en la barra y en el pie (`src/components/Logo.astro`, variantes `iso` y
`claro`). Son dos porque el logotipo también está compuesto en dos:

- **Jost 300** (`--font-marca-1`, utilidad `font-marca-1`) — la primera línea,
  «Distribuciones». Geométrica y de trazo muy fino, a 22 px.
- **Source Sans 3 400** (`--font-marca-2`, utilidad `font-marca-2`) — la
  segunda línea, «Santiago De Tunja S.A.S». Humanista y de trazo normal, a
  10,5 px, con la raya naranja a la izquierda.

No se usan en ningún otro sitio del proyecto: cualquier otro texto va en
Montserrat o Poppins. Se eligieron midiendo `public/logo-distribuciones.png`
píxel a píxel, porque el archivo está rasterizado y no declara ninguna fuente;
el razonamiento completo, con las proporciones que se compararon, está en el
comentario de `--font-marca-1` en `src/styles/global.css` y en la cabecera de
`Logo.astro`. Antes de ellas el nombre iba en Questrial, que se desinstaló al
no quedarle ningún uso.

De las cuatro, las dos de marca se cargan con **un solo peso y solo el
subconjunto latino** (`@fontsource/jost/latin-300.css` y
`@fontsource/source-sans-3/latin-400.css`, 9,9 KB y 15,7 KB): el nombre de la
empresa no se pone nunca en negrita ni en cursiva y no tiene un carácter fuera
del latín. Los cuatro imports viven juntos en `src/layouts/BaseLayout.astro`.

**Logo**: `public/logo-distribuciones.png` (horizontal) en el encabezado y
`public/LOGO-removebg-preview.png` (isotipo) en el pie, en pantallas muy
pequeñas y como base de los favicons.

**Íconos**: `src/components/Icono.astro` inserta SVG en línea —
[lucide](https://lucide.dev) para la interfaz y
[simple-icons](https://simpleicons.org) para los logotipos de WhatsApp,
Facebook, Instagram y X. Todos comparten la misma micro-interacción
(`icono-int` / `icono-chip` en `global.css`): escala 1.05 y cambio de color en
200 ms, tanto con el mouse como con el foco de teclado, y desactivada si el
sistema pide menos movimiento.

## Mapas y llaves de API

Ninguna. Los dos mapas del sitio usan Leaflet con teselas de OpenStreetMap, que
no piden API key ni registro: no hay claves en el HTML ni variables que
configurar. Lo único obligatorio es dejar visible la atribución, que ya viene en
la esquina del mapa.

La geocodificación de municipios y de la sede también es libre (Nominatim) y se
corre una sola vez con `npm run geocodificar`; el resultado queda cacheado en
`src/data/coordenadas.json`.

## Estado en producción

El sitio se publica en Vercel con el dominio oficial <https://dstunja.com> (también
responde en <https://paginaweb-beta-coral.vercel.app>) y los
formularios de PQRS y Empleos envían correo de verdad. Sin valores de claves:

| Pieza | Configuración |
| --- | --- |
| Antirrobots | Cloudflare Turnstile, widget «DST web», modo Non-interactive. Hostnames: `dstunja.com`, `paginaweb-beta-coral.vercel.app`, `vercel.app` y `localhost` |
| Correo de PQRS | Resend, cuenta de informacioncomercialdst@gmail.com (`PQRS_RESEND_API_KEY`) |
| Correo de Empleos | Resend, cuenta de ghsantiagodetunja@gmail.com (`RESEND_API_KEY`) |
| Remitente | `onboarding@resend.dev` en las dos cuentas, sin dominio verificado. Por eso la constancia a quien radica una PQRS **no se envía** |
| Soportes de PQRS | Blob store privado `pqrs-adjuntos`, conectado al proyecto. El correo al área los enlaza por `/api/pqrs/descarga` |
| Faltan en Vercel | `CRON_SECRET`, `PQRS_IP_SALT` y las dos de Upstash |
| Pendiente | Verificar dstunja.com en Resend: remitente propio, constancia al ciudadano y una sola cuenta |

El detalle, con la tabla de variables cargadas y los registros DNS que pide
Resend, está en `docs/PQRS-ADJUNTOS.md` (secciones «Estado en producción» y
«Pendiente: verificar dstunja.com en Resend») y en `docs/EMPLEOS-POSTULACION.md`.

## Variables de entorno

La radicación de PQRS **comercial** se apoya en tres servicios (Vercel Blob,
Resend y Cloudflare Turnstile) y cada uno tiene su variable. El formulario corto
de la categoría **administrativa** usa dos de los tres —Resend y Turnstile— y va
al **mismo** buzón, el de `PQRS_DESTINO`. **Cuando falta una, el síntoma es
siempre un mensaje opaco del SDK de turno**, no un aviso claro: por eso hay un
comprobador.

```bash
npm run check:env
```

Dice cuáles faltan, cuáles tienen mala pinta y de dónde sale cada una. No
imprime ningún valor. Sale con código 1 si falta alguna imprescindible, así que
sirve igual en un hook o en CI.

### Resumen de `.env.example`

| Variable | Para qué | Cuándo se lee |
| --- | --- | --- |
| `PQRS_RESEND_API_KEY`, `RESEND_API_KEY` | Correo de PQRS y de Empleos (Resend) | Petición |
| `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | Antirrobots (Cloudflare Turnstile) | Build / petición |
| `CRON_SECRET`, `PQRS_IP_SALT` | Protege los dos crons de limpieza (PQRS y empleos; se compara en tiempo constante, ver `src/lib/cron.ts`), y sal del hash de la IP de quien radica | Petición |
| `PUBLIC_PQRS_ADJUNTO_MAX_MB` | Peso máximo de cada soporte de la PQRS | Build |
| `C360_POSTULACIONES_URL`, `C360_POSTULACIONES_SECRET` | Envío de postulaciones a Control360 | Petición |
| `C360_VACANTES_URL` | Vacantes publicadas en Control360 | Build |

`BLOB_READ_WRITE_TOKEN` (Vercel Blob) no está en el ejemplo porque la define
Vercel al conectar el store. El detalle de cada una está comentado en
`.env.example` y en la tabla de abajo.

### Traerlas de Vercel

Es la vía rápida, y la única que garantiza que en local se usa lo mismo que en
producción:

```bash
npx vercel link              # una sola vez, enlaza la carpeta con el proyecto
npx vercel env pull .env.local
```

`.env.local` está en `.gitignore`. Astro lo carga solo al arrancar.

### De dónde sale cada una

| Variable | Dónde se consigue |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | **No se copia a mano.** Vercel → proyecto → *Storage* → `pqrs-adjuntos` (privado) → *Connect*. Vercel la define sola, junto con `BLOB_STORE_ID` y `BLOB_WEBHOOK_PUBLIC_KEY`, que el código no necesita. |
| `TURNSTILE_SECRET` | Cloudflare → *Turnstile* → tu widget → *Settings* → **Secret Key**. |
| `PUBLIC_TURNSTILE_SITE_KEY` | El mismo widget → **Site Key**. Lleva `PUBLIC_` porque el navegador la necesita. |
| `PQRS_RESEND_API_KEY` | <https://resend.com/api-keys>, con la cuenta de Resend de PQRS (registrada con `informacioncomercialdst@gmail.com`). Si falta, PQRS usa `RESEND_API_KEY`. |
| `RESEND_API_KEY` | <https://resend.com/api-keys>, con la cuenta de Resend de Empleos. |
| `PQRS_DESTINO`, `PQRS_REMITENTE` | Opcionales. Por defecto `informacioncomercialdst@gmail.com` y `onboarding@resend.dev`. Sin dominio verificado, Resend solo entrega al titular de la cuenta, así que la constancia a quien radica no se envía. |
| `PQRS_IP_SALT`, `CRON_SECRET` | Se generan: `node -e "console.log(crypto.randomUUID())"`. |
| `UPSTASH_REDIS_REST_URL/TOKEN` | Vercel → *Marketplace* → Upstash (plan gratuito). Opcionales. |
| `EMPLEOS_DESTINO`, `EMPLEOS_REMITENTE` | Opcionales. Buzón y remitente de las postulaciones de empleos; sin ellas se usa el correo de `contactoEmpleo` (`src/data/vacantes.ts`) y el remitente de PQRS. Ver `docs/EMPLEOS-POSTULACION.md`. |
| `C360_VACANTES_URL` | Opcional. URL pública de Control360 con las vacantes publicadas por Talento Humano (`https://control360app.com/api/talento/vacantes/dst`). Se lee **en el build**; sin ella, o si falla, la página usa `src/data/vacantes.ts`. |
| `PUBLIC_PQRS_BLOB_ACCESS` | **Ya no existe.** El acceso a los blobs es privado y fijo; si sigue definida en Vercel, borrarla. |

Para desarrollo, Cloudflare publica un par de claves de prueba que **aceptan
cualquier token**, y por eso no pueden acabar en producción:

```
PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
```

`npm run check:env` avisa si detecta que están puestas.

### Dos trampas que ya han mordido

- **`BLOB_READ_WRITE_TOKEN` se lee en cada petición, pero hay que redesplegar**
  después de conectar el store: una función ya desplegada no ve una variable que
  no existía cuando se creó. Sin ella no se sube ningún adjunto **y tampoco se
  radica nada**, porque el registro de la solicitud también vive en el Blob.
- **`PUBLIC_TURNSTILE_SITE_KEY` se lee en tiempo de BUILD** y se compila dentro
  del JavaScript del navegador. Añadirla en el panel de Vercel no sirve de nada
  hasta que se vuelve a compilar.

El detalle de cada variable está comentado en `.env.example`, y el flujo
completo de los adjuntos en `docs/PQRS-ADJUNTOS.md`.

## Cabeceras de seguridad

`vercel.json` aplica a **todas las rutas** estas cabeceras, que pidió un escaneo
con OWASP ZAP sobre dstunja.com:

| Cabecera | Valor |
| --- | --- |
| `Content-Security-Policy` | Ver la tabla de abajo |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self)` |
| `Access-Control-Allow-Origin` | `https://dstunja.com`, en lugar del `*` que pone Vercel a los archivos estáticos |

Qué permite la CSP, además del propio origen:

| Directiva | Fuera del sitio | Para qué |
| --- | --- | --- |
| `script-src` | `challenges.cloudflare.com` | Turnstile. **Sin `'unsafe-inline'`**. Vercel Analytics se sirve del mismo dominio (`/_vercel/insights/`) |
| `frame-src` | `challenges.cloudflare.com` | El iframe de Turnstile |
| `img-src` | `*.tile.openstreetmap.fr`, `placehold.co`, el bucket de Supabase de Control360, `data:` | Teselas del mapa, marcadores de imágenes que faltan, flyers de las vacantes |
| `connect-src` | `control360app.com`, `vercel.com`, `*.blob.vercel-storage.com` | Vacantes vivas y subida de soportes de PQRS a Vercel Blob |
| `style-src` | `'unsafe-inline'` | Hay atributos `style` en el HTML (iconos, tarjetas) y Leaflet los usa |
| `font-src` | ninguno | Las fuentes son propias (Fontsource) |
| `frame-ancestors` | `'none'` | Nadie puede incrustar el sitio en un iframe |

Tres consecuencias que hay que conocer:

- **No puede haber scripts en línea.** Los que había (el interruptor del
  revelado y el aviso del catálogo) están en
  `public/js/`, y
  `astro.config.mjs` pone `vite.build.assetsInlineLimit: 0` para que Astro no
  incruste los scripts pequeños. Un `<script is:inline>` con código nuevo se
  bloquearía en producción sin avisar; los de datos (`type="application/json"`)
  sí valen.
- **Un servicio externo nuevo** (otro mapa, un chat, otra analítica) hay
  que añadirlo a la CSP de `vercel.json`, o el navegador lo bloqueará.
- **La geolocalización solo la puede pedir el propio sitio** (`geolocation=(self)`):
  la PQRS la usa para preseleccionar el municipio más cercano, y ningún iframe de
  terceros puede pedirla. Hubo un momento con `geolocation=()`, que la apagaba
  del todo y dejaba el municipio sin preselección; no volver a ponerlo sin quitar
  antes esa función. Cámara y micrófono siguen deshabilitados para todos.

Los comentarios HTML de las plantillas **no se publican**: los quita
`src/middleware.ts` al generar cada página.

`npm run verificar:navegacion` aplica esas mismas cabeceras en su servidor local y
comprueba, con la red real, que ninguna página provoca bloqueos de CSP, que los
mapas cargan teselas, que Turnstile da token y los formularios llegan a su API, y
que la página no pide nada a Google ni muestra franja de cookies. Con
`--url https://dstunja.com` revisa además producción: cabeceras, redirección de
`http://` a `https://` y bloqueos en el navegador.

## Cómo funciona el pedido

El sitio **no tiene carrito de verdad ni pasarela de pago**. El armador de
pedidos sirve para que el tendero escriba una lista y se la entregue a un asesor
por WhatsApp, que es el canal que la empresa ya usa. Todo ocurre en el
navegador: no hay servidor que reciba el pedido ni base de datos donde quede.

### El recorrido completo

1. **La página.** `src/pages/pedido.astro` monta dos piezas:
   `CatalogoPedido.astro` (buscador, filtros y grilla de tarjetas) y
   `PanelPedido.astro` (la lista del pedido, la barra del carrito y el
   formulario de envío). Las dos viven en `src/components/pedido/`.
2. **El catálogo llega en dos tiempos.** En el build, `CatalogoPedido.astro`
   imprime como HTML real las secciones de marcas y las primeras 24 tarjetas
   (`TAMANO_TANDA`, en `src/data/pedido.ts`), y además emite el catálogo entero
   en un `<script type="application/json" id="datos-catalogo">`. Al arrancar, el
   script del cliente lee ese JSON y lo guarda en memoria con
   `registrarProductos()` (`src/lib/carrito.ts`), pero **no repinta** lo que ya
   está en pantalla: solo le aplica el pedido guardado. Se repinta cuando el
   visitante busca, filtra, abre otra marca o pide «Ver más».
3. **Agregar.** El clic en `[data-agregar]` de una tarjeta llama a
   `sumarCantidad(pedido, id, cantidad)` y luego a `guardarPedido(pedido)`, las
   dos de `carrito.ts`. La tarjeta vuelve a cantidad 1 para que agregar dos
   veces no repita sin querer el número anterior.
4. **El aviso.** `guardarPedido()` escribe en localStorage y dispara el evento
   `dst:pedido` sobre `document`. Quien escucha vuelve a leer: el panel repinta
   su lista, la barra fija del carrito actualiza las unidades y el contador de
   la píldora «Arma tu pedido» de `Header.astro` se mueve **en todas las
   páginas**, no solo en `/pedido/`. Por eso el estado no vive en una variable
   compartida: Astro empaqueta por separado el script de cada componente.
5. **Abrir el panel.** El botón de la barra fija abre el cajón (en escritorio
   entra por la derecha; en móvil sube desde abajo). La píldora del header lleva
   `data-abrir-pedido` solo en `/pedido/`, donde abre el panel en vez de
   recargar. Es un diálogo modal de verdad: atrapa el Tab, cierra con Escape o
   tocando el velo y devuelve el foco a donde estaba.
6. **Dos pasos.** El panel abre siempre en la lista (paso 1). Los campos del
   negocio (paso 2) solo aparecen al pulsar «Enviar pedido por WhatsApp» con al
   menos una referencia. Cerrar el panel o vaciar el pedido devuelve al paso 1.
7. **Enviar.** Al hacer submit, `validar()` comprueba que haya productos, que
   los campos obligatorios estén llenos y que el teléfono tenga 10 dígitos. Si
   pasa, `mensajeParaUrl(pedido)` (en `carrito.ts`) arma el texto,
   `enlacePedido(texto)` (`src/lib/whatsapp-pedido.ts`) lo codifica dentro de la
   URL de `wa.me` y `window.open` abre WhatsApp en otra pestaña. **El pedido no
   se vacía al enviarlo**: lo normal es que el cliente ajuste cantidades y mande
   una corrección. Para eso está «Vaciar pedido», que pide confirmación.

### Dónde vive el estado del carrito

En **localStorage**, bajo una sola clave: `dst:pedido:v1` (`CLAVE_PEDIDO`, en
`src/data/pedido.ts`). Ahí van juntas las referencias con su cantidad *y* los
datos del negocio. Esa es la fuente de verdad; las variables `pedido` de cada
componente son copias que se refrescan con el evento.

- **Si recarga la página**, el pedido sigue ahí: el script lo vuelve a leer con
  `leerPedido()` y repinta la barra, el panel y el contador. Lo único que se
  reconstruye es el catálogo en memoria, que sale otra vez del JSON de la
  página.
- **Si vuelve al día siguiente**, también sigue, con los datos del negocio ya
  escritos en el formulario (`pintarCliente()`). No hay ningún código de
  caducidad: el pedido dura hasta que el visitante lo vacíe o borre los datos
  del navegador.
- **Si el navegador bloquea el almacenamiento** (modo privado de algunos
  navegadores, almacenamiento deshabilitado), `leerPedido()` devuelve un pedido
  vacío y `guardarPedido()` se traga el error: la página funciona igual, pero el
  pedido solo dura lo que dure la pestaña abierta.
- **Entre pestañas** del mismo sitio se sincroniza con el evento `storage` del
  navegador (`alCambiarPedido()`).

Se guardan **ids y cantidades, no nombres ni precios**: el texto del mensaje se
resuelve en el momento contra el catálogo en memoria.

### Cómo se arma el mensaje de WhatsApp

**El número** sale de `WHATSAPP_PEDIDO` y `TELEFONO_PEDIDO`, en
`src/lib/whatsapp-pedido.ts`. Es uno solo para todo el sitio (botón flotante,
CTA del inicio, Contáctanos, pie, armador de pedidos). Hoy coincide dígito por
dígito con `empresa.telefono` / `empresa.whatsapp` de `src/data/site.ts`, pero
está escrito aparte a propósito: si vuelve a haber una línea comercial propia se
cambia aquí sin tocar el número general.

**El formato** lo arma `mensajePedido()` en `carrito.ts`: encabezado con el
negocio, el municipio, el contacto y el teléfono; un título con cuántas
referencias y cuántas unidades; una línea por referencia del tipo
`2 × Saltín Noel Tradicional (300 g) — cód. 1046509 — ref. $ 5.200`; el
subtotal; y el aviso de precios (`AVISO_PRECIOS`). `mensajeParaUrl()` le
antepone el saludo «Hola, te envío mi pedido.» —solo ahí, porque
`mensajePedido()` es también el texto del botón «Copiar pedido», donde el saludo
sobraría—.

**Si falta un dato**, nada se rompe: cada línea del encabezado se omite si viene
vacía; una referencia sin código va sin `— cód.`; una sin precio sugerido va sin
`— ref. $`; y una que ya no esté en el catálogo sale como
`N × (referencia <id>)`. La línea de subtotal **desaparece entera** si ninguna
referencia tiene precio confirmado (un «subtotal: $ 0» confunde más de lo que
ayuda), y se rotula como *parcial*, diciendo de cuántas sale, si solo algunas lo
tienen.

**Si el pedido está vacío**, no se llega a enviar: la barra del carrito ni se
dibuja, `irADatos()` no abre el paso 2, `validar()` lo rechaza con un aviso y
«Copiar pedido» se ignora.

**Si el pedido es muy largo**, el texto ya codificado se corta en
`LIMITE_TEXTO_URL` (4000 caracteres, en `src/data/pedido.ts`).
`mensajeParaUrl()` busca por **bisección** cuántas líneas caben, envía esas con
un aviso de cuántas faltan dentro del propio mensaje, y copia el pedido completo
al portapapeles para pegarlo como segundo mensaje.

**Sin JavaScript** el buscador, los filtros y el carrito se ocultan por CSS
(regla `html:not([data-js])`), y un bloque `<noscript>` deja a la vista las
marcas, las primeras tarjetas y un enlace al WhatsApp genérico.

### Qué hace `scripts/verificar-pedido.mjs`

Es una prueba de extremo a extremo con Playwright **sobre el sitio ya
compilado**: levanta `dist/client/` en el puerto 4399 bajo el prefijo
`/proyecto_paginaWeb` y recorre `/pedido/` en móvil (375 px) y escritorio
(1280 px). Los enlaces a `wa.me` se interceptan, así que no sale tráfico a
internet.

Se ejecuta **a mano**, después de compilar:

```bash
npm run build
npm run verificar:pedido
```

**No corre en CI**: `.github/workflows/ci.yml` solo hace `npm test`,
`astro check` y `npm run build`.

Comprueba que con el pedido vacío no se vean la barra, el pie del panel ni los
campos del negocio; que al agregar aparezca la barra con «N unidades · Ver
pedido» y que el número suba; que «Ver pedido» abra el panel (con
`aria-expanded` y el foco dentro) y que Escape y el velo lo cierren; que los
campos del negocio solo salgan en el paso 2 y que un teléfono de 5 dígitos se
rechace sin abrir ninguna pestaña de WhatsApp; que el pedido sobreviva a una
recarga en la clave `dst:pedido:v1`; y que el contador del buscador diga
«X de N referencias». Aparte, rastrea los archivos compilados para que no quede
publicado ningún número retirado, que todos los enlaces `wa.me` vayan a un
número vigente y que el enlace del `<noscript>` de `/pedido/` también apunte al
de pedidos.

### Decisiones que no son obvias leyendo el código

- **El catálogo se imprime y además viaja en JSON.** Las primeras tarjetas salen
  del build para que la página sirva antes de que llegue el script (o si nunca
  llega); el resto se pinta en el navegador porque imprimir las seiscientas y
  pico referencias serían más de medio mega de marcado. Las dos etapas usan las
  mismas plantillas (`src/lib/plantillasCatalogo.ts`), y por eso el script puede
  *adoptar* la grilla en vez de repintarla, sin parpadeo.
- **El número de WhatsApp está repetido a propósito en tres sitios**
  (`site.ts`, `whatsapp-pedido.ts` y, a mano, `verificar-pedido.mjs`). La copia
  del script es la que delata un cambio hecho por error, así que un cambio de
  línea se ajusta en los tres **en el mismo commit**.
- **`window.open` se llama dentro del propio clic**, antes de copiar al
  portapapeles: si se esperara a que la copia terminara, el navegador bloquearía
  la ventana por emergente. Por lo mismo tampoco se abren varias ventanas de
  `wa.me` seguidas para los pedidos largos.
- **Los datos del negocio se guardan con `guardarPedido(pedido, false)`**, sin
  avisar al resto de la página: repintar la lista en cada tecla movería el
  cursor de sitio.
- **Hay dos precios y no se tratan igual.** El PSP (precio sugerido al público)
  se multiplica por la cantidad y entra en el subtotal; el precio de lista de
  SAP es por unidad de venta, así que se pinta tal cual y **no** se suma ni se
  multiplica. Nunca viajan los dos juntos.
- **Un código SAP incompleto no se muestra.** `detalleReferencia()` omite el
  código cuando viene marcado como parcial: publicar medio código invita a pedir
  una referencia que no existe. Hoy no queda ninguna así, pero la comprobación
  se mantiene porque el maestro se regenera desde el deck.
- **El teléfono se valida contando dígitos**, no por formato: «310 623 2429» con
  espacios es válido, y un `+57` delante se descuenta antes de contar.
- **La clave de localStorage lleva sufijo de versión** (`:v1`) para poder
  cambiar el formato del pedido más adelante.
- **El puerto 4399** del script de verificación está elegido lejos del 4321 de
  `astro dev` (y de los 4322, 4323… que toma cuando ese está ocupado), porque un
  choque ahí no daría error: el navegador acabaría en el servidor de desarrollo
  y las comprobaciones fallarían sin que la página tuviera nada.

Lo que **no** tiene razón escrita en el código, y conviene no suponerla:

- Por qué `TAMANO_TANDA` son 24 tarjetas y no otra cifra — *sin verificar*.
- Por qué el aviso de precios del mensaje (`AVISO_PRECIOS`, en `pedido.ts`) y la
  nota del pie del panel (`NOTA_PRECIOS`, en `PanelPedido.astro`) son dos frases
  distintas en vez de una sola — *sin verificar*.
- Por qué el aviso del pedido recortado se pinta con el tono `'error'` aunque el
  envío haya salido bien — *sin verificar*.

### Lo que está a medias o es frágil

- **Toda la red de seguridad del pedido es un script manual.** No hay pruebas
  unitarias de `carrito.ts` ni de `whatsapp-pedido.ts` (los `src/lib/*.test.ts`
  cubren otras cosas), y `verificar:pedido` no está en CI. Si nadie lo corre
  después de compilar, un cambio en el armador llega a producción sin revisar.
- **El límite de 4000 caracteres es una estimación, no una medida.** `wa.me` no
  documenta ningún tope; el valor se eligió conservador y el propio comentario
  invita a ajustarlo si se ve que aguanta más o que algún teléfono falla.
- **El portapapeles puede fallar** en el caso del pedido recortado. Hay mensaje
  alternativo («usa Copiar pedido y pega el resto»), pero si la copia no sale,
  las referencias que faltan quedan solo en pantalla.
- **Los ids guardados pueden quedar huérfanos.** Si una referencia se da de baja
  del catálogo, quien la tuviera en su pedido seguirá viéndola como un id crudo
  y el mensaje dirá `(referencia <id>)`. No hay limpieza ni migración.
- **La clave está versionada, pero no hay código de migración.** Subirla a `:v2`
  haría que los pedidos guardados desaparecieran sin aviso.
- **Hay comentarios desactualizados.** Varios hablan de «709 referencias» cuando
  `src/data/productos.ts` tiene 621, y la cabecera de `src/data/pedido.ts`
  todavía dice «GitHub Pages hoy, Hostinger después», cuando el único destino es
  Vercel. No afecta al comportamiento, pero despista al leer.

## Formularios

El de **contacto** arma un correo con los datos y lo abre en el gestor de quien
escribe (`src/components/FormularioMailto.astro`).

El de **empleos** envía la postulación desde la página, **con la hoja de vida
adjunta** (PDF, DOC o DOCX, máximo 4 MB), a `POST /api/empleos/postular`
(`src/components/FormularioEmpleo.astro`). La función valida los campos y los
bytes del archivo, comprueba el campo trampa, el límite por IP y Turnstile, y
manda **un** correo por Resend a Talento Humano con el `replyTo` del candidato y
el teléfono y el correo como enlaces `tel:` y `mailto:`. El archivo no se guarda
en ningún sitio. Si la función no contesta (5xx o red caída) cae al
`mailto:` pidiendo adjuntar la hoja de vida a mano. Se prueba con `npm test` y
`npm run verificar:empleos`. Detalle en `docs/EMPLEOS-POSTULACION.md`.

El de **PQRS empieza preguntando la categoría**, y ese primer clic decide el
resto de la página: no hay botón de «continuar» y no se recarga nada.

- **Administrativa**: **no radica**. En cuanto se elige, desaparecen el paso 2 y
  el formulario de PQRS, y en su lugar sale un bloque
  (`src/components/ContactoAdministrativo.astro`) con el teléfono, el WhatsApp y
  el correo de la empresa —sacados de `empresa` en `src/data/site.ts`, no
  escritos a mano— con botón de copiar en cada uno. Debajo hay un formulario
  corto y opcional (nombre, teléfono, correo opcional y mensaje) que manda un
  recado con `POST /api/pqrs/administrativa`; si esa función no está, cae a un
  `mailto:`, así que se sigue pudiendo escribir.
El **municipio** es un combobox cerrado a los 87 municipios de cobertura, que
salen de `src/data/municipios.ts`. Busca ignorando tildes y mayúsculas, se
maneja con el teclado, y si la persona concede la ubicación preselecciona el más
cercano (si la niega, no pasa nada). Se valida también en el servidor: un
municipio que no esté en la lista devuelve 400.

La **descripción** de la comercial y el **«¿Qué necesitas?»** de la
administrativa piden 10 caracteres como mínimo, y lo dicen bajo el campo antes de
escribir («Mínimo 10 caracteres.»). Al escribir, un contador indica cuántos
faltan y el envío se frena en el navegador hasta llegar
(`src/components/ContadorCaracteres.astro`). El servidor valida con los mismos
límites y la misma forma de contar, que viven en `src/lib/pqrs/limites-texto.ts`.

- **Comercial**: pide el tipo (paso 2) y **radica de verdad** contra
  `src/pages/api/pqrs/`. Guarda la solicitud y sus soportes, devuelve un número
  de radicado y manda dos correos. Esas funciones **solo existen en Vercel**;
  sin ellas (por ejemplo, en `astro preview`) el formulario cae al respaldo por
  correo, avisando de que así no queda radicado. Necesita las variables de la
  sección anterior.

Los dos caminos acaban en el **mismo buzón**, el de `PQRS_DESTINO`, y se separan
por el asunto: «Solicitud administrativa · Nombre» frente a «[PQRS-…] PQRS
Comercial · …». Detalle completo en `docs/PQRS-ADJUNTOS.md`.

## Despliegue

Un solo destino: **Vercel** (<https://dstunja.com>), que publica solo con cada
push a `main` (integración Git de Vercel). Cada PR recibe una vista previa.

- El espejo de revisión en GitHub Pages se apagó el 10/10/2026: se borró su
  workflow (`deploy.yml`). En el repositorio hay que desactivar también
  *Settings › Pages*. `astro.config.mjs` sigue compilando con
  `base: '/proyecto_paginaWeb'` cuando no corre en Vercel, porque los scripts
  de `scripts/verificar-*.mjs` sirven `dist/client/` con ese prefijo.
- Con el adaptador de Vercel, el build deja el sitio en **`dist/client/`** (y la
  función en `dist/server/`), no en `dist/`.
- Crons (`vercel.json`, una vez al día como permite el plan Hobby):
  `/api/pqrs/limpieza` a las 04:00 UTC y `/api/empleos/limpieza` a las 08:00
  UTC. Los dos exigen `CRON_SECRET`.
- `/_astro/*` sale con `Cache-Control: public, max-age=31536000, immutable`
  (los nombres llevan hash). Los flyers de las vacantes pasan por el
  optimizador de imágenes de Vercel (`/_vercel/image`, ver
  `src/lib/empleos/flyer.mjs`).
- **CI** (`.github/workflows/ci.yml`): en cada PR y en cada push a `main` corre
  `npm ci`, `npm test`, `npx astro check` y `npm run build` con Node 22. No
  publica nada.
- Las variables de Vercel se cargan en el panel del proyecto (ver «Variables de
  entorno»). Las que se leen en el build (`PUBLIC_*`, `C360_VACANTES_URL`) solo
  surten efecto al volver a desplegar.

El dominio y los registros DNS del correo (Zoho) no se tocan al desplegar.

## SEO

- `sitemap-index.xml` generado con `@astrojs/sitemap`.
- `robots.txt` apuntando al sitemap y con `Disallow: /api/`.
- Los sitemaps del WordPress viejo (`/sitemap.xml`, `/sitemap_index.xml`,
  `/wp-sitemap*.xml`, `/*-sitemap.xml`) redirigen con 301 a `/sitemap-index.xml`.
- Canonical, Open Graph y Twitter Card en cada página; cada vacante comparte su
  flyer como imagen.
- Datos estructurados (`src/lib/datos-estructurados.ts`): `LocalBusiness`
  completo en el layout (NIT, fundación, dirección, coordenadas, horario, logo),
  `BreadcrumbList` en las páginas internas y `JobPosting` en cada vacante para
  Google Empleos (`src/lib/empleos/job-posting.ts`; no en «Buscamos vehículos»).
- `site.webmanifest` con los íconos de 192 y 512.
- Barra final: todos los enlaces la llevan, pero `trailingSlash` sigue en
  `'ignore'`. Con `'always'` las funciones sin extensión (`/api/pqrs`,
  `/api/empleos/revalidar`, los crons) pasarían a redirigir, y Control360 y
  Vercel las llaman sin barra.
- La URL del sitio se define en `astro.config.mjs` (`site`). Si el dominio cambia,
  hay que actualizarla ahí y en `public/robots.txt`.
