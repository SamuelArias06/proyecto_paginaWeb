/**
 * Verificación del formulario de Empleos con un navegador de verdad y una hoja
 * de vida de verdad, sobre el sitio YA COMPILADO en dist/.
 *
 * Se comprueban tres cosas distintas:
 *
 * A) EL CAMPO DE HOJA DE VIDA, que no toca la red:
 *   1. Existe, es obligatorio, acepta solo .pdf/.doc/.docx y dice el tope
 *      ("PDF, DOC o DOCX, máximo 3 MB.") antes de elegir nada.
 *   2. Un archivo válido de cada formato se acepta y se enseña con su nombre y
 *      su peso.
 *   3. Se rechazan el formato no permitido, el contenido que no corresponde a
 *      la extensión, la doble extensión y el exceso de peso, con un mensaje
 *      claro y sacando el archivo del input.
 *   4. El campo trampa está en el HTML pero no se ve, y la casilla de
 *      tratamiento de datos es obligatoria: sin ella no sale ninguna petición.
 *
 * B) EL ENVÍO, con un doble de POST /api/empleos/postular montado en el MISMO
 *    servidor local que sirve dist/. No se intercepta con `page.route()` a
 *    propósito: Chromium no entrega el contenido de los archivos en el
 *    `postData` de una petición interceptada, y aquí hay que comprobar que
 *    llegan LOS BYTES de la hoja de vida, no solo su nombre.
 *   5. Sale UNA petición multipart con todos los campos, la casilla, el campo
 *      trampa vacío, el token de Turnstile y el archivo con SUS bytes.
 *   6. Mientras se envía el botón queda deshabilitado y dice "Enviando…".
 *   7. Con 200 sale la confirmación ("Recibimos tu postulación, te
 *      contactaremos al correo indicado") y el formulario desaparece.
 *   8. Un 400, un 429 o un 500 se muestran con su código visible («Código:
 *      E-LIMITE»), el formulario sigue ahí y el botón vuelve a quedar usable.
 *      NO se abre ningún gestor de correo: ese respaldo ya no existe.
 *   9. Un 403 del servidor (token caducado o ya usado) se reenvía UNA vez con
 *      la marca `sin_verificar`, en vez de dejar al candidato fuera.
 *  10. Un doble clic en enviar manda UNA sola postulación.
 *  11. Si el servidor devuelve una referencia (la postulación quedó guardada
 *      pero el aviso no salió), la confirmación la enseña para poder citarla.
 *  12. En el espejo estático sin funciones se explica y se ofrece WhatsApp.
 *  13. El cargo llega preseleccionado desde ?cargo= y desde "Postularme".
 *
 * C) TURNSTILE, con una clave de prueba inyectada en el HTML y un doble de
 *    Cloudflare:
 *  14. Sin interacción, el token del widget viaja con la postulación.
 *  15. Si Cloudflare pide marcar la casilla, sale un aviso, la espera NO vence a
 *      los 30 s y, cuando llega el token, la postulación llega a la función.
 *      Es el fallo que hubo en producción: al vencer ese tope se abría el
 *      `mailto:` sin llamar nunca a la API.
 *  16. Un error de Cloudflare NO deja al candidato fuera: tras el reintento
 *      automático, la postulación sale con `sin_verificar`.
 *  17. Con el script de Cloudflare bloqueado, lo mismo. Antes los dos casos
 *      acababan en un `mailto:` que en el celular muchas veces no abría nada.
 *
 * D) OPCIONAL, EL ENVÍO REAL contra una función en marcha:
 *      node scripts/verificar-empleos.mjs --api http://localhost:3000
 *      node scripts/verificar-empleos.mjs --solo-api --api http://localhost:3000
 *    Manda un multipart de verdad (con un PDF de prueba y cabecera Origin) a
 *    <url>/api/empleos/postular y enseña la respuesta completa. Hace falta
 *    `vercel dev` con las variables puestas y la clave secreta de PRUEBA de
 *    Turnstile (1x…), porque el token es de mentira. OJO: si RESEND_API_KEY es
 *    real, el correo LLEGA de verdad a EMPLEOS_DESTINO; el nombre del
 *    candidato de prueba lo dice para que no lo confundan con una postulación.
 *
 * El script de Cloudflare Turnstile también se intercepta: se sirve un doble
 * que devuelve un token de mentira. Así la prueba no depende de la red ni de
 * tener claves reales.
 *
 * Uso:
 *   npm run build
 *   npm run verificar:empleos
 *
 * Sin dependencias nuevas: Playwright ya está en devDependencies. Los archivos
 * de prueba se generan en el directorio temporal del sistema, no en el
 * repositorio.
 *
 * Puerto: 4399, el mismo que los demás scripts de verificación (se corren de
 * uno en uno). Ver el comentario de scripts/verificar-pqrs.mjs.
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { crc32 } from 'node:zlib';
import { chromium } from 'playwright';

// Con el adaptador de Vercel el sitio estatico queda en dist/client.
const RAIZ = join(process.cwd(), 'dist', 'client');
const PUERTO = 4399;

/**
 * Prefijo con el que compila `npm run build` fuera de Vercel (el espejo de
 * GitHub Pages). El servidor de aquí se lo quita si viene; si el build se hizo
 * con VERCEL=1 y no lleva prefijo, también sirve.
 */
const BASE = '/proyecto_paginaWeb';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
};

/** Ruta de la función, ya sin el prefijo del espejo. */
const RUTA_FUNCION = '/api/empleos/postular';

/**
 * Estado del doble de la función: qué contestar (`plan`) y qué llegó
 * (`envios`). Lo fija `instalarDobles` antes de cada página; las páginas se
 * abren de una en una, así que un solo estado compartido basta.
 */
const funcion = { plan: {}, envios: [] };

function leerCuerpo(peticion) {
  return new Promise((listo, fallo) => {
    const trozos = [];
    peticion.on('data', (trozo) => trozos.push(trozo));
    peticion.on('end', () => listo(Buffer.concat(trozos)));
    peticion.on('error', fallo);
  });
}

/**
 * El doble de POST /api/empleos/postular.
 *
 * `funcion.plan.respuesta`:
 *   'ok' (por defecto)  200 { ok: true }
 *   'error'             400 con un mensaje de campo
 *   'antirrobots'       403
 *   'limite'            429, el límite por IP
 *   'servidor'          500, que es como sale un fallo de Resend sin Blob
 *   'guardada'          200 con referencia: el correo no salió pero la
 *                       postulación quedó guardada en el Blob
 *   'html'              404 en HTML, que es lo que devuelve el espejo estático
 *   'grande'            413 en text/plain, como Vercel cuando el cuerpo pasa
 *                       de 4,5 MB (medido contra producción)
 *   'plataforma'        502 en text/plain, como Vercel cuando la función se
 *                       cae o tarda más de lo que le concede
 *   'caida'             se corta la conexión sin contestar
 *
 * `funcion.plan.secuencia`: lista de respuestas, una por petición, para los
 * casos en que la segunda tiene que ser distinta de la primera (el reenvío sin
 * verificar después de un 403). Cuando se agota, manda `respuesta`.
 *
 * `funcion.plan.demora`: milisegundos antes de contestar, para ver "Enviando…".
 */
async function atenderFuncion(peticion, respuesta) {
  const cuerpo = await leerCuerpo(peticion);
  const tipo = peticion.headers['content-type'] ?? '';
  funcion.envios.push({ metodo: peticion.method, tipo, partes: leerMultipart(cuerpo, tipo) });

  const plan = funcion.plan;
  if (plan.demora) await new Promise((r) => setTimeout(r, plan.demora));

  const json = (estado, datos) => {
    respuesta.writeHead(estado, { 'content-type': 'application/json; charset=utf-8' });
    respuesta.end(JSON.stringify(datos));
  };

  // La secuencia manda sobre `respuesta`, y se consume de a una por petición.
  const cual = plan.secuencia?.shift() ?? plan.respuesta ?? 'ok';

  switch (cual) {
    case 'caida':
      respuesta.socket.destroy();
      return;
    case 'html':
      respuesta.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404</h1>');
      return;
    /*
     * Los dos que escribe la PLATAFORMA, no nuestro código: no son JSON, así
     * que el formulario no recibe `datos` y tiene que deducir qué pasó del
     * código de estado. Antes los dos salían como «no está disponible en esta
     * dirección», un mensaje sobre la dirección para un problema de peso.
     */
    case 'grande':
      respuesta
        .writeHead(413, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Request Entity Too Large FUNCTION_PAYLOAD_TOO_LARGE');
      return;
    case 'plataforma':
      respuesta
        .writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        .end('An error occurred with your deployment FUNCTION_INVOCATION_FAILED');
      return;
    case 'servidor':
      json(500, {
        ok: false,
        codigo: 'E-CORREO',
        errores: [
          'No pudimos enviar tu postulación en este momento. Inténtalo de nuevo en unos minutos o escríbenos por WhatsApp.',
        ],
      });
      return;
    case 'limite':
      json(429, {
        ok: false,
        codigo: 'E-LIMITE',
        errores: ['Has enviado varias postulaciones seguidas. Espera 10 minutos e inténtalo de nuevo.'],
      });
      return;
    case 'guardada':
      json(200, { ok: true, referencia: 'EMP-20260929-A7K2M9' });
      return;
    case 'antirrobots':
      json(403, {
        ok: false,
        codigo: 'T-invalid-input-response',
        errores: ['La comprobación antirrobots no pasó. Recarga la página e inténtalo de nuevo.'],
      });
      return;
    case 'error':
      json(400, {
        ok: false,
        codigo: 'E-DATOS',
        errores: ['El teléfono debe tener entre 7 y 15 dígitos.'],
      });
      return;
    default:
      json(200, { ok: true });
  }
}

/**
 * Clave de prueba de Cloudflare que se inyecta en el HTML cuando la página se
 * pide con `?turnstile=prueba`.
 *
 * `npm run build` sin `.env` compila el formulario SIN clave, y entonces el
 * cliente ni siquiera monta Turnstile: el camino que falló en producción
 * (casilla interactiva, error, script bloqueado) quedaría sin probar. Con la
 * clave inyectada el cliente monta el widget, y el doble de Turnstile
 * (`TURNSTILE_FALSO`) decide qué pasa.
 */
const CLAVE_TURNSTILE_PRUEBA = '1x00000000000000000000AA';

function servir() {
  return new Promise((listo) => {
    const servidor = createServer(async (peticion, respuesta) => {
      const direccion = new URL(peticion.url, 'http://x');
      const conTurnstile = direccion.searchParams.get('turnstile') === 'prueba';
      let ruta = decodeURIComponent(direccion.pathname);
      if (ruta.startsWith(BASE)) ruta = ruta.slice(BASE.length);

      if (ruta === RUTA_FUNCION) {
        await atenderFuncion(peticion, respuesta);
        return;
      }

      if (ruta.endsWith('/')) ruta += 'index.html';
      if (ruta === '') ruta = '/index.html';

      const archivo = normalize(join(RAIZ, ruta));
      if (!archivo.startsWith(RAIZ)) {
        respuesta.writeHead(403).end();
        return;
      }

      try {
        const info = await stat(archivo);
        if (info.isDirectory()) throw new Error('directorio');
        let cuerpo = await readFile(archivo);
        if (conTurnstile && extname(archivo) === '.html') {
          // Astro pinta el atributo vacío sin valor: `data-turnstile-key`.
          cuerpo = Buffer.from(
            cuerpo
              .toString('utf8')
              .replace(
                /data-turnstile-key(="")?(?=[\s>])/g,
                `data-turnstile-key="${CLAVE_TURNSTILE_PRUEBA}"`,
              ),
          );
        }
        respuesta.writeHead(200, {
          'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
        });
        respuesta.end(cuerpo);
      } catch {
        respuesta.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404</h1>');
      }
    });
    servidor.listen(PUERTO, () => listo(servidor));
  });
}

const resultados = [];
const comprobar = (descripcion, ok, detalle = '') => {
  resultados.push({ descripcion, ok, detalle });
  console.log(`${ok ? '  OK  ' : ' FALLA'}  ${descripcion}${detalle ? ` — ${detalle}` : ''}`);
};

const url = (camino) => `http://localhost:${PUERTO}${BASE}${camino}`;

// --- Archivos de prueba -----------------------------------------------------

/** ZIP mínimo con una entrada almacenada, para hacer un .docx creíble. */
function zipConUnaEntrada(nombreEntrada, contenido) {
  const nombre = Buffer.from(nombreEntrada, 'utf8');
  const datos = Buffer.from(contenido, 'utf8');
  const suma = crc32(datos);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(suma, 14);
  local.writeUInt32LE(datos.length, 18);
  local.writeUInt32LE(datos.length, 22);
  local.writeUInt16LE(nombre.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(suma, 16);
  central.writeUInt32LE(datos.length, 20);
  central.writeUInt32LE(datos.length, 24);
  central.writeUInt16LE(nombre.length, 28);

  const inicioCentral = local.length + nombre.length + datos.length;
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(central.length + nombre.length, 12);
  fin.writeUInt32LE(inicioCentral, 16);

  return Buffer.concat([local, nombre, datos, central, nombre, fin]);
}

const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);
const OLE2 = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(1024),
]);
/** Cabecera JFIF: una foto de la hoja de vida, que es lo que sube media gente. */
const JPEG_MINIMO = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'latin1'),
  Buffer.alloc(512),
]);

async function prepararArchivos() {
  const carpeta = await mkdtemp(join(tmpdir(), 'dst-empleos-'));
  const ruta = (nombre) => join(carpeta, nombre);

  const docx = zipConUnaEntrada(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="x"><w:body/></w:document>',
  );
  // 4 MB y un byte: justo por encima del tope.
  const pdfPesado = Buffer.concat([PDF_MINIMO, Buffer.alloc(4 * 1024 * 1024 + 1)]);

  const archivos = {
    pdfValido: ruta('hoja de vida.pdf'),
    docxValido: ruta('hoja-de-vida.docx'),
    docValido: ruta('hoja-de-vida.doc'),
    texto: ruta('hoja-de-vida.txt'),
    pdfFalso: ruta('disfrazado.pdf'),
    pesado: ruta('escaneo-gigante.pdf'),
    dobleExtension: ruta('hoja.exe.pdf'),
    /*
     * SIN EXTENSION, como lo entregan los selectores de archivos de Android:
     * el nombre es el que muestra el proveedor (Drive, Descargas, Documentos de
     * WhatsApp) y muchas veces no trae «.pdf». Son bytes de PDF de verdad.
     */
    sinExtension: ruta('hoja de vida'),
    /** Extension equivocada, mismo caso: por dentro es un PDF. */
    extensionAjena: ruta('hoja-de-vida-escaneada.docx'),
    foto: ruta('hoja-de-vida.jpg'),
  };

  await Promise.all([
    writeFile(archivos.pdfValido, PDF_MINIMO),
    writeFile(archivos.docxValido, docx),
    writeFile(archivos.docValido, OLE2),
    writeFile(archivos.texto, 'Esto es un archivo de texto plano.\n'),
    writeFile(archivos.pdfFalso, 'MZ Esto no es un PDF, es texto plano disfrazado.\n'),
    writeFile(archivos.pesado, pdfPesado),
    writeFile(archivos.dobleExtension, PDF_MINIMO),
    writeFile(archivos.sinExtension, PDF_MINIMO),
    writeFile(archivos.extensionAjena, PDF_MINIMO),
    writeFile(archivos.foto, JPEG_MINIMO),
  ]);

  return archivos;
}

// --- Dobles -----------------------------------------------------------------

/** Turnstile de mentira: cada `execute` devuelve un token distinto. */
const TURNSTILE_FALSO = `
  (function () {
    var callbacks = {};
    var contador = 0;
    window.turnstile = {
      render: function (contenedor, opciones) {
        var id = 'widget-' + ++contador;
        callbacks[id] = opciones;
        return id;
      },
      // El modo lo fija la prueba antes de cargar la página (window.__modoTurnstile):
      //   'ok'          token a los 10 ms, sin interacción
      //   'interaccion' pide la casilla y el token llega a los
      //                 window.__esperaInteraccionMs (más de 30 s: el tope viejo)
      //   'error'       Cloudflare responde con el error 110200 en cada intento
      //   'un-fallo'    falla la PRIMERA ejecucion y resuelve la segunda, que es
      //                 lo que hace un 600010 esporadico: sirve para comprobar
      //                 que el reintento automatico de la libreria lo rescata
      execute: function (id) {
        var o = callbacks[id];
        if (!o) return;
        var intento = (window.__ejecucionesTurnstile || 0) + 1;
        window.__ejecucionesTurnstile = intento;
        var modo = window.__modoTurnstile || 'ok';
        var token = function () { o.callback('token-de-prueba-' + Date.now()); };
        if (modo === 'un-fallo') {
          if (intento === 1) {
            setTimeout(function () { o['error-callback'] && o['error-callback']('600010'); }, 50);
          } else {
            setTimeout(token, 10);
          }
        } else if (modo === 'interaccion') {
          setTimeout(function () { o['before-interactive-callback'] && o['before-interactive-callback'](); }, 50);
          setTimeout(token, window.__esperaInteraccionMs || 33000);
        } else if (modo === 'error') {
          setTimeout(function () { o['error-callback'] && o['error-callback']('110200'); }, 50);
        } else {
          setTimeout(token, 10);
        }
      },
      reset: function () {},
      remove: function () {},
    };
    if (window.alTurnstileListo) window.alTurnstileListo();
  })();
`;

/**
 * Lector mínimo de multipart/form-data, suficiente para ver qué mandó el
 * navegador: nombre del campo, nombre de archivo, tipo y bytes de cada parte.
 */
function leerMultipart(cuerpo, contentType) {
  const coincidencia = /boundary=("?)([^";]+)\1/i.exec(contentType ?? '');
  if (!cuerpo || !coincidencia) return null;
  const limite = Buffer.from(`--${coincidencia[2]}`);
  const partes = [];

  let posicion = cuerpo.indexOf(limite);
  while (posicion !== -1) {
    let inicio = posicion + limite.length;
    if (cuerpo.subarray(inicio, inicio + 2).toString() === '--') break;
    inicio += 2; // el CRLF que sigue al límite
    const fin = cuerpo.indexOf(limite, inicio);
    if (fin === -1) break;
    const bloque = cuerpo.subarray(inicio, fin - 2); // sin el CRLF final
    const separador = bloque.indexOf('\r\n\r\n');
    const cabeceras = bloque.subarray(0, separador).toString('utf8');
    const datos = bloque.subarray(separador + 4);
    partes.push({
      nombre: /name="([^"]*)"/.exec(cabeceras)?.[1] ?? '',
      archivo: /filename="([^"]*)"/.exec(cabeceras)?.[1],
      tipo: /content-type:\s*([^\r\n]+)/i.exec(cabeceras)?.[1],
      datos,
    });
    posicion = fin;
  }
  return partes;
}

/**
 * Prepara los dobles para una página y devuelve el registro de lo que llegó.
 *
 * El de Turnstile se sirve con `page.route()`; el de la función vive en el
 * servidor local (ver `atenderFuncion`) y aquí solo se le fija el plan y se
 * vacía lo registrado por la página anterior.
 */
async function instalarDobles(pagina, plan = {}) {
  funcion.plan = { ...plan, secuencia: plan.secuencia ? [...plan.secuencia] : undefined };
  funcion.envios = [];

  if (plan.turnstile === 'bloqueado') {
    // Lo que hace un bloqueador de anuncios: el script de Cloudflare no llega.
    await pagina.route('https://challenges.cloudflare.com/**', (ruta) => ruta.abort('blockedbyclient'));
  } else {
    await pagina.route('https://challenges.cloudflare.com/**', (ruta) =>
      ruta.fulfill({ status: 200, contentType: 'text/javascript', body: TURNSTILE_FALSO }),
    );
  }

  if (plan.turnstile) {
    await pagina.addInitScript(
      ([modo, espera]) => {
        window.__modoTurnstile = modo;
        window.__esperaInteraccionMs = espera;
      },
      [plan.turnstile, plan.esperaInteraccionMs ?? 33000],
    );
  }

  return funcion;
}

/**
 * Abre una página con los dobles puestos. Con `plan.turnstile` la página se
 * pide con `?turnstile=prueba`, que hace que el servidor inyecte la clave de
 * prueba y el cliente monte el widget.
 */
async function abrir(contexto, plan = {}, camino = '/empleos/') {
  const pagina = await contexto.newPage();
  const registro = await instalarDobles(pagina, plan);
  let destino = camino;
  if (plan.turnstile) {
    const [ruta, ancla = ''] = camino.split('#');
    destino = `${ruta}${ruta.includes('?') ? '&' : '?'}turnstile=prueba${ancla ? `#${ancla}` : ''}`;
  }
  await pagina.goto(url(destino), { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(400);
  const rechazar = pagina.locator('[data-rechazar-cookies]');
  if (await rechazar.isVisible().catch(() => false)) await rechazar.click();
  return { pagina, registro };
}

/** ¿El sitio compilado lleva clave de Turnstile en el formulario? */
const hayTurnstile = async (pagina) =>
  ((await pagina.locator('[data-form-empleo]').getAttribute('data-turnstile-key')) ?? '') !== '';

async function rellenar(pagina, archivo) {
  await pagina.fill('#nombre-empleo', 'Cristian Amaya (prueba automática)');
  await pagina.fill('#correo-empleo', 'practicaspasantiasdst@gmail.com');
  await pagina.fill('#telefono-empleo', '3106232429');
  await pagina.fill('#municipio-empleo', 'Tunja');
  await pagina.selectOption('#cargo-empleo', 'Vendedor TAT');
  await pagina.fill('#experiencia-empleo', 'Dos años en ventas TAT en Tunja.');
  if (archivo) await pagina.setInputFiles('#hoja-de-vida-empleo', archivo);
  await pagina.check('#autorizacion-empleo');
}

const textoDe = async (localizador) => ((await localizador.textContent()) ?? '').trim();

// --- A) El campo de hoja de vida --------------------------------------------

async function revisarCampo(navegador, archivos, etiqueta, viewport) {
  console.log(`\n=== A) Campo de hoja de vida (${etiqueta}) ===\n`);
  const contexto = await navegador.newContext({ viewport });
  const { pagina, registro } = await abrir(contexto);

  const entrada = pagina.locator('#hoja-de-vida-empleo');
  const error = pagina.locator('[data-error-hv]');
  const archivo = pagina.locator('[data-archivo-hv]');
  const cuantos = () => entrada.evaluate((e) => e.files.length);

  comprobar(`${etiqueta}: el campo existe y es obligatorio`, (await entrada.count()) === 1 && (await entrada.getAttribute('required')) !== null);
  /*
   * EL `accept` LLEVA LAS EXTENSIONES Y LOS MIME. Chrome de Android traduce cada
   * extension del `accept` a un tipo MIME y le pide al selector que esconda todo
   * lo demas; un archivo cuyo proveedor no declara bien el tipo salia en gris o
   * no salia, y el candidato no podia elegir su propia hoja de vida.
   * `application/octet-stream` esta a proposito: es lo que declaran los gestores
   * de archivos que no saben de que tipo es. El formato lo decide la validacion,
   * no este filtro (src/lib/empleos/hoja-de-vida.ts).
   */
  const accept = (await entrada.getAttribute('accept')) ?? '';
  comprobar(
    `${etiqueta}: el accept lleva las tres extensiones, sus MIME y octet-stream`,
    ['.pdf', '.doc', '.docx', 'application/pdf', 'application/msword', 'application/octet-stream'].every(
      (v) => accept.split(',').includes(v),
    ) && accept.includes('wordprocessingml.document'),
    accept,
  );
  comprobar(
    `${etiqueta}: dice los formatos y el tope antes de elegir nada`,
    (await textoDe(pagina.locator('[data-ayuda-hv]'))) === 'PDF, DOC o DOCX, máximo 3 MB.',
    await textoDe(pagina.locator('[data-ayuda-hv]')),
  );
  comprobar(
    `${etiqueta}: la ayuda está enlazada al campo (aria-describedby)`,
    (await entrada.getAttribute('aria-describedby'))?.split(' ').includes('hoja-de-vida-empleo-ayuda') && (await entrada.getAttribute('aria-describedby'))?.split(' ').includes('hoja-de-vida-empleo-error'),
  );

  // ---- Válidos --------------------------------------------------------------
  await entrada.setInputFiles(archivos.pdfValido);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: un PDF válido se acepta y se enseña con nombre y peso`,
    (await archivo.isVisible()) &&
      (await textoDe(pagina.locator('[data-archivo-nombre]'))) === 'hoja de vida.pdf' &&
      /\d+ B|KB|MB/.test(await textoDe(pagina.locator('[data-archivo-peso]'))) &&
      !(await error.isVisible()) &&
      (await cuantos()) === 1,
    await textoDe(archivo),
  );

  await entrada.setInputFiles(archivos.docxValido);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: un .docx válido se acepta`,
    (await textoDe(pagina.locator('[data-archivo-nombre]'))) === 'hoja-de-vida.docx' &&
      !(await error.isVisible()) &&
      (await cuantos()) === 1,
  );

  await entrada.setInputFiles(archivos.docValido);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: un .doc válido se acepta`,
    (await textoDe(pagina.locator('[data-archivo-nombre]'))) === 'hoja-de-vida.doc' &&
      !(await error.isVisible()) &&
      (await cuantos()) === 1,
  );

  /*
   * ---- Los nombres que entrega el celular ----------------------------------
   *
   * Lo que decide es el CONTENIDO. Un PDF de verdad se acepta aunque el nombre
   * llegue sin extension o con otra, que es como lo entregan los selectores de
   * archivos de Android. Antes esto se rechazaba con «formato no permitido» sin
   * llegar a mirar los bytes.
   */
  await entrada.setInputFiles(archivos.sinExtension);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: un PDF cuyo nombre llega SIN extension se acepta`,
    (await archivo.isVisible()) && !(await error.isVisible()) && (await cuantos()) === 1,
    await textoDe(error),
  );

  await entrada.setInputFiles(archivos.extensionAjena);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: un PDF con la extension equivocada se acepta`,
    (await archivo.isVisible()) && !(await error.isVisible()) && (await cuantos()) === 1,
    await textoDe(error),
  );

  // ---- Rechazados -----------------------------------------------------------
  await entrada.setInputFiles(archivos.foto);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: una foto se rechaza diciendo que es una foto, no un formato raro`,
    (await error.isVisible()) &&
      (await textoDe(error)).includes('es una foto') &&
      (await cuantos()) === 0,
    await textoDe(error),
  );
  comprobar(
    `${etiqueta}: con el rechazo aparece la salida por WhatsApp junto al campo`,
    await pagina.locator('[data-salida-hv]').isVisible(),
  );

  await entrada.setInputFiles(archivos.texto);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: un .txt se rechaza nombrando los formatos, y sale del input`,
    (await error.isVisible()) &&
      (await textoDe(error)).includes('PDF, DOC o DOCX') &&
      (await cuantos()) === 0 &&
      !(await archivo.isVisible()),
    await textoDe(error),
  );
  comprobar(
    `${etiqueta}: el rechazo deja el campo inválido para reportValidity()`,
    !(await entrada.evaluate((e) => e.checkValidity())),
  );

  await entrada.setInputFiles(archivos.pdfFalso);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: texto plano disfrazado de .pdf se rechaza por su contenido`,
    (await error.isVisible()) && (await textoDe(error)).includes('contenido') && (await cuantos()) === 0,
    await textoDe(error),
  );

  await entrada.setInputFiles(archivos.dobleExtension);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: la doble extensión se rechaza`,
    (await error.isVisible()) && (await textoDe(error)).includes('doble extensión') && (await cuantos()) === 0,
    await textoDe(error),
  );

  await entrada.setInputFiles(archivos.pesado);
  await pagina.waitForTimeout(600);
  comprobar(
    `${etiqueta}: más de 3 MB se rechaza diciendo el tope`,
    (await error.isVisible()) && (await textoDe(error)).includes('el máximo es 3 MB') && (await cuantos()) === 0,
    await textoDe(error),
  );

  await entrada.setInputFiles(archivos.pdfValido);
  await pagina.waitForTimeout(300);
  comprobar(
    `${etiqueta}: un archivo válido después del rechazo borra el error`,
    !(await error.isVisible()) && (await cuantos()) === 1 && (await entrada.evaluate((e) => e.checkValidity())),
  );
  comprobar(
    `${etiqueta}: y se lleva con él la salida por WhatsApp del campo`,
    !(await pagina.locator('[data-salida-hv]').isVisible()),
  );

  // ---- Campo trampa y casilla ----------------------------------------------
  /*
   * `isVisible()` de Playwright no sirve aquí: da por visible cualquier
   * elemento con caja, aunque esté a 9999 px de la pantalla. Se mira la caja
   * de verdad y que cuelgue de un `aria-hidden`.
   */
  const trampa = pagina.locator('[data-honeypot]');
  const fueraDeVista = await trampa.evaluate((e) => {
    const caja = e.getBoundingClientRect();
    const ocultoALectores = e.closest('[aria-hidden="true"]') !== null;
    return ocultoALectores && (caja.right <= 0 || caja.bottom <= 0 || caja.width <= 1);
  });
  comprobar(
    `${etiqueta}: el campo trampa está en el HTML pero fuera de la vista y de los lectores de pantalla`,
    (await trampa.count()) === 1 && fueraDeVista && (await trampa.inputValue()) === '',
  );
  comprobar(
    `${etiqueta}: el campo trampa queda fuera del orden de tabulación`,
    (await trampa.getAttribute('tabindex')) === '-1',
    String(await trampa.getAttribute('tabindex')),
  );
  /*
   * Que un AUTOCOMPLETADO no lo pueda llenar es lo que de verdad importa: si un
   * gestor de contraseñas lo rellena, esa postulación se descarta en silencio y
   * la persona ve «Postulación enviada». `autocomplete="off"` no basta -Chrome
   * lo ignora a menudo en formularios de contacto-, así que va un valor que no
   * existe en el estándar, y con él las señales que respetan 1Password y
   * LastPass.
   */
  comprobar(
    `${etiqueta}: el campo trampa no lo puede rellenar un autocompletado`,
    (await trampa.getAttribute('autocomplete')) === 'nope' &&
      (await trampa.getAttribute('data-lpignore')) === 'true' &&
      (await trampa.getAttribute('data-1p-ignore')) !== null,
    `autocomplete=${await trampa.getAttribute('autocomplete')} lpignore=${await trampa.getAttribute('data-lpignore')}`,
  );
  /*
   * Y que no lo pueda llenar un LECTOR DE PANTALLA: `aria-hidden` en el campo
   * además del contenedor, y ninguna <label> que lo nombre. Antes había una que
   * decía «Sitio web», que es justo la pista que un gestor de contraseñas
   * necesita para rellenarlo.
   */
  comprobar(
    `${etiqueta}: el campo trampa no lo anuncia ningún lector de pantalla`,
    (await trampa.getAttribute('aria-hidden')) === 'true' &&
      (await pagina.locator('label[for="sitio-web-empleo"]').count()) === 0,
    `aria-hidden=${await trampa.getAttribute('aria-hidden')} labels=${await pagina.locator('label[for="sitio-web-empleo"]').count()}`,
  );

  const casilla = pagina.locator('#autorizacion-empleo');
  comprobar(
    `${etiqueta}: la casilla de tratamiento de datos existe y es obligatoria`,
    (await casilla.count()) === 1 && (await casilla.getAttribute('required')) !== null,
  );
  comprobar(
    `${etiqueta}: el aviso de la Ley 1581 sigue en la página`,
    (await pagina.locator('#postular').textContent()).includes('Ley 1581 de 2012'),
  );

  // Sin marcar la casilla, no sale ninguna petición.
  await pagina.fill('#nombre-empleo', 'Cristian Amaya');
  await pagina.fill('#correo-empleo', 'practicaspasantiasdst@gmail.com');
  await pagina.fill('#telefono-empleo', '3106232429');
  await pagina.fill('#municipio-empleo', 'Tunja');
  await pagina.click('[data-enviar-empleo]');
  await pagina.waitForTimeout(500);
  comprobar(
    `${etiqueta}: sin la casilla marcada no se envía nada`,
    registro.envios.length === 0 && (await pagina.locator('[data-form-empleo]').isVisible()),
    String(registro.envios.length),
  );

  // Sin hoja de vida, tampoco.
  await casilla.check();
  await entrada.setInputFiles([]);
  await pagina.waitForTimeout(200);
  await pagina.click('[data-enviar-empleo]');
  await pagina.waitForTimeout(500);
  comprobar(
    `${etiqueta}: sin hoja de vida no se envía nada`,
    registro.envios.length === 0,
    String(registro.envios.length),
  );

  await pagina.close();
  await contexto.close();
}

// --- B) El envío -------------------------------------------------------------

async function revisarEnvio(navegador, archivos, etiqueta, viewport) {
  console.log(`\n=== B) Envío (${etiqueta}) ===\n`);
  const contexto = await navegador.newContext({ viewport });

  // ---- 1. Camino feliz, con demora para ver el estado intermedio ---------
  {
    const { pagina, registro } = await abrir(contexto, { respuesta: 'ok', demora: 900 });
    const conTurnstile = await hayTurnstile(pagina);
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);

    const boton = pagina.locator('[data-enviar-empleo]');
    await boton.click();
    await pagina.waitForTimeout(350);
    comprobar(
      `${etiqueta} · Envío: mientras se envía, el botón está deshabilitado y dice "Enviando…"`,
      (await boton.isDisabled()) && (await textoDe(boton)) === 'Enviando…',
      await textoDe(boton),
    );

    await pagina.waitForTimeout(1500);
    const confirmacion = pagina.locator('[data-confirmacion-empleo]');
    comprobar(
      `${etiqueta} · Envío: con 200 sale la confirmación y el formulario desaparece`,
      (await confirmacion.isVisible()) && !(await pagina.locator('[data-form-empleo]').isVisible()),
    );
    comprobar(
      `${etiqueta} · Envío: la confirmación dice "Recibimos tu postulación…"`,
      (await textoDe(confirmacion)).includes(
        'Recibimos tu postulación, te contactaremos al correo indicado',
      ),
    );
    comprobar(
      `${etiqueta} · Envío: en el camino normal no se enseña ninguna referencia`,
      !(await pagina.locator('[data-referencia-empleo]').isVisible()),
    );
    comprobar(
      `${etiqueta} · Envío: salió UNA sola petición`,
      registro.envios.length === 1,
      String(registro.envios.length),
    );

    const envio = registro.envios[0];
    comprobar(
      `${etiqueta} · Envío: es un POST multipart/form-data`,
      envio?.metodo === 'POST' && envio.tipo.startsWith('multipart/form-data'),
      `${envio?.metodo} ${envio?.tipo}`,
    );

    const partes = envio?.partes ?? [];
    const parte = (nombre) => partes.find((p) => p.nombre === nombre);
    const valor = (nombre) => parte(nombre)?.datos.toString('utf8');
    comprobar(
      `${etiqueta} · Envío: el navegador dejó ver el cuerpo (postDataBuffer)`,
      partes.length > 0,
      partes.length === 0 ? 'Playwright no entregó el cuerpo del multipart' : `${partes.length} partes`,
    );
    comprobar(
      `${etiqueta} · Envío: van los campos de texto con lo escrito`,
      valor('nombre') === 'Cristian Amaya (prueba automática)' &&
        valor('correo') === 'practicaspasantiasdst@gmail.com' &&
        valor('telefono') === '3106232429' &&
        valor('municipio') === 'Tunja' &&
        valor('cargo') === 'Vendedor TAT' &&
        valor('experiencia') === 'Dos años en ventas TAT en Tunja.',
      partes.map((p) => `${p.nombre}=${p.archivo ?? p.datos.toString('utf8').slice(0, 40)}`).join(' | '),
    );
    comprobar(
      `${etiqueta} · Envío: va el idEnvio que identifica la postulación`,
      /^[A-Za-z0-9-]{8,64}$/.test(valor('idEnvio') ?? ''),
      String(valor('idEnvio')),
    );
    comprobar(
      `${etiqueta} · Envío: va la casilla de autorización`,
      valor('autorizacion') === 'si',
      String(valor('autorizacion')),
    );
    comprobar(
      `${etiqueta} · Envío: el campo trampa viaja vacío`,
      parte('sitio-web') !== undefined && valor('sitio-web') === '',
    );
    comprobar(
      `${etiqueta} · Envío: una postulación verificada NO lleva la marca sin_verificar`,
      parte('sin_verificar') === undefined,
    );
    comprobar(
      conTurnstile
        ? `${etiqueta} · Envío: va el token de Turnstile del widget`
        : `${etiqueta} · Envío: sin clave de Turnstile en el build, el token viaja vacío`,
      conTurnstile ? (valor('turnstileToken') ?? '').startsWith('token-de-prueba-') : valor('turnstileToken') === '',
      String(valor('turnstileToken')),
    );
    const hoja = parte('hoja-de-vida');
    comprobar(
      `${etiqueta} · Envío: la hoja de vida va con su nombre, su tipo y SUS bytes`,
      hoja?.archivo === 'hoja de vida.pdf' &&
        (hoja.tipo ?? '').startsWith('application/pdf') &&
        Buffer.compare(hoja.datos, PDF_MINIMO) === 0,
      hoja ? `${hoja.archivo} ${hoja.tipo} ${hoja.datos.length} B` : '(no llegó)',
    );

    await pagina.close();
  }

  // ---- 2. Un 400 se muestra y no cae al correo ----------------------------
  {
    const { pagina, registro } = await abrir(contexto, { respuesta: 'error' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(900);

    const errores = pagina.locator('[data-errores-empleo]');
    comprobar(
      `${etiqueta} · Error 400: se muestra el motivo que mandó el servidor`,
      (await errores.isVisible()) && (await textoDe(errores)).includes('entre 7 y 15 dígitos'),
      await textoDe(errores),
    );
    comprobar(
      `${etiqueta} · Error 400: sale el código visible para la captura de pantalla`,
      (await textoDe(pagina.locator('[data-codigo-error]'))).includes('E-DATOS'),
      await textoDe(pagina.locator('[data-codigo-error]')),
    );
    comprobar(
      `${etiqueta} · Error 400: el formulario sigue ahí y WhatsApp aparece como último recurso`,
      (await pagina.locator('[data-form-empleo]').isVisible()) &&
        (await pagina.locator('[data-whatsapp-empleo]').isVisible()),
    );
    const boton = pagina.locator('[data-enviar-empleo]');
    comprobar(
      `${etiqueta} · Error 400: el botón vuelve a quedar usable con su texto`,
      !(await boton.isDisabled()) && (await textoDe(boton)) === 'Enviar postulación',
    );
    comprobar(
      `${etiqueta} · Error 400: se intentó una sola vez`,
      registro.envios.length === 1,
      String(registro.envios.length),
    );
    await pagina.close();
  }

  // ---- 2 bis. Un 429: el límite por IP ------------------------------------
  {
    const { pagina } = await abrir(contexto, { respuesta: 'limite' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(900);

    const errores = pagina.locator('[data-errores-empleo]');
    comprobar(
      `${etiqueta} · Límite (429): dice cuánto esperar, con su código`,
      (await errores.isVisible()) &&
        (await textoDe(errores)).includes('Espera 10 minutos') &&
        (await textoDe(pagina.locator('[data-codigo-error]'))).includes('E-LIMITE'),
      await textoDe(errores),
    );
    await pagina.close();
  }

  // ---- 2 ter. Un 500: el correo no salió y no había dónde guardar ---------
  {
    const { pagina, registro } = await abrir(contexto, { respuesta: 'servidor' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(900);

    const errores = pagina.locator('[data-errores-empleo]');
    comprobar(
      `${etiqueta} · Fallo de correo (500): se explica, con código, sin abrir ningún gestor de correo`,
      (await errores.isVisible()) &&
        (await textoDe(pagina.locator('[data-codigo-error]'))).includes('E-CORREO') &&
        (await pagina.locator('[data-form-empleo]').isVisible()),
      await textoDe(errores),
    );
    comprobar(
      `${etiqueta} · Fallo de correo (500): ofrece WhatsApp como último recurso`,
      await pagina.locator('[data-whatsapp-empleo]').isVisible(),
    );
    comprobar(
      `${etiqueta} · Fallo de correo (500): se intentó una sola vez`,
      registro.envios.length === 1,
      String(registro.envios.length),
    );
    await pagina.close();
  }

  // ---- 2 quater. La postulación quedó guardada: sale la referencia --------
  {
    const { pagina } = await abrir(contexto, { respuesta: 'guardada' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(900);

    comprobar(
      `${etiqueta} · Guardada: sale la confirmación, no un error`,
      await pagina.locator('[data-confirmacion-empleo]').isVisible(),
    );
    comprobar(
      `${etiqueta} · Guardada: se enseña la referencia para poder citarla`,
      (await textoDe(pagina.locator('[data-referencia-empleo]'))).includes('EMP-20260929-A7K2M9'),
      await textoDe(pagina.locator('[data-referencia-empleo]')),
    );
    await pagina.close();
  }

  // ---- 2 quinquies. Doble clic en enviar ----------------------------------
  {
    const { pagina, registro } = await abrir(contexto, { respuesta: 'ok', demora: 700 });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);

    // Dos clics seguidos, como los da un dedo impaciente en un celular.
    const boton = pagina.locator('[data-enviar-empleo]');
    await boton.click();
    await boton.click({ force: true, timeout: 2000 }).catch(() => {});
    await pagina.waitForTimeout(1600);

    comprobar(
      `${etiqueta} · Doble clic: sale UNA sola postulación, no dos`,
      registro.envios.length === 1,
      `${registro.envios.length} envíos`,
    );
    comprobar(
      `${etiqueta} · Doble clic: la confirmación sale una vez`,
      await pagina.locator('[data-confirmacion-empleo]').isVisible(),
    );
    await pagina.close();
  }

  /*
   * ---- 3. Un 403 del servidor -------------------------------------------
   *
   * Un token que el servidor rechaza (caducado, ya usado, dominio sin
   * autorizar) es indistinguible para el candidato de que la página esté rota.
   * En vez de dejarlo fuera, se reenvía UNA vez con la marca `sin_verificar`.
   */
  {
    const { pagina, registro } = await abrir(contexto, {
      secuencia: ['antirrobots', 'ok'],
    });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(1200);

    comprobar(
      `${etiqueta} · 403: se reenvía una vez, y solo una`,
      registro.envios.length === 2,
      `${registro.envios.length} envíos`,
    );
    const segundo = registro.envios[1]?.partes ?? [];
    const valorDe2 = (nombre) => segundo.find((p) => p.nombre === nombre)?.datos.toString('utf8');
    comprobar(
      `${etiqueta} · 403: el reenvío lleva sin_verificar y el token vacío`,
      valorDe2('sin_verificar') === 'si' && valorDe2('turnstileToken') === '',
      `sin_verificar=${valorDe2('sin_verificar')} token=${JSON.stringify(valorDe2('turnstileToken'))}`,
    );
    comprobar(
      `${etiqueta} · 403: el reenvío lleva la hoja de vida otra vez`,
      segundo.find((p) => p.nombre === 'hoja-de-vida')?.datos.length > 0,
    );
    comprobar(
      `${etiqueta} · 403: el candidato acaba viendo la confirmación`,
      await pagina.locator('[data-confirmacion-empleo]').isVisible(),
    );
    await pagina.close();
  }

  // ---- 3 bis. Si el reenvío también falla, se explica ---------------------
  {
    const { pagina, registro } = await abrir(contexto, { respuesta: 'antirrobots' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(1200);

    comprobar(
      `${etiqueta} · 403 persistente: no se reintenta sin parar`,
      registro.envios.length === 2,
      `${registro.envios.length} envíos`,
    );
    comprobar(
      `${etiqueta} · 403 persistente: se enseña el motivo con su código`,
      (await pagina.locator('[data-errores-empleo]').isVisible()) &&
        (await textoDe(pagina.locator('[data-codigo-error]'))).includes('T-invalid-input-response'),
      await textoDe(pagina.locator('[data-codigo-error]')),
    );
    await pagina.close();
  }

  /*
   * ---- 4. Cuando no hay función que conteste ----------------------------
   *
   * Los dos casos que antes abrían el gestor de correo. Ahora se explica qué
   * pasa, se da un código y se ofrece WhatsApp, que SÍ puede llevar el archivo.
   * Lo que no puede volver a pasar es que la página diga «abrimos tu gestor de
   * correo» sin que se abra nada, que es lo que ocurría en el celular.
   */
  for (const [caso, plan, codigo, trozo] of [
    [
      'El HTML del espejo estático (GitHub Pages)',
      { respuesta: 'html' },
      'E-SIN-API',
      'no está disponible en esta dirección',
    ],
    [
      'La red caída',
      { respuesta: 'caida' },
      'E-RED',
      'la conexión se cortó mientras subía tu hoja de vida',
    ],
    /*
     * El 413 y el 5xx de la plataforma llegan en text/plain, igual que el HTML
     * del espejo, y antes se confundían con él: los tres enseñaban «no está
     * disponible en esta dirección». Ahora cada uno dice lo suyo, porque lo que
     * el candidato tiene que hacer es distinto en cada caso: aligerar el
     * archivo, volver en unos minutos, o cambiar de dirección.
     */
    [
      'El 413 de Vercel (cuerpo de más de 4,5 MB)',
      { respuesta: 'grande' },
      'E-GRANDE',
      'demasiado pesada',
    ],
    [
      'El 502 de Vercel (la función se cayó)',
      { respuesta: 'plataforma' },
      'E-SERVIDOR-502',
      'tuvo un problema al recibir tu postulación',
    ],
  ]) {
    const { pagina } = await abrir(contexto, plan);
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    // Con la red caída se insiste tres veces (1,2 s + 3,5 s de pausa) antes de
    // rendirse: hay que esperar a que acabe de intentarlo.
    await pagina.waitForTimeout(7000);

    const errores = pagina.locator('[data-errores-empleo]');
    comprobar(
      `${etiqueta} · ${caso}: se explica con su código, sin gestor de correo`,
      (await errores.isVisible()) &&
        (await textoDe(errores)).includes(trozo) &&
        (await textoDe(pagina.locator('[data-codigo-error]'))).includes(codigo),
      `${await textoDe(errores)} | ${await textoDe(pagina.locator('[data-codigo-error]'))}`,
    );
    comprobar(
      `${etiqueta} · ${caso}: WhatsApp queda a la vista como último recurso`,
      await pagina.locator('[data-whatsapp-empleo]').isVisible(),
    );
    comprobar(
      `${etiqueta} · ${caso}: el formulario sigue ahí, con los datos escritos`,
      (await pagina.locator('[data-form-empleo]').isVisible()) &&
        (await pagina.locator('#nombre-empleo').inputValue()) !== '',
    );
    await pagina.close();
  }

  /*
   * ---- 5. El archivo cambia en el disco después de elegirlo ---------------
   *
   * Lo que vio un candidato en Chrome de Android (E-RED con un .docx de 30 KB y
   * el servidor sano): el archivo elegido desde WhatsApp o Drive deja de poder
   * leerse cuando llega el envío, y `fetch` lanza `TypeError` antes de salir
   * (ERR_UPLOAD_FILE_CHANGED). En el escritorio se reproduce igual: se elige el
   * archivo y se reescribe antes de pulsar Enviar. Lo que tiene que viajar es la
   * copia que se leyó al elegirlo.
   */
  {
    const cambiante = join(dirname(archivos.pdfValido), `cambia-${etiqueta}.pdf`);
    await writeFile(cambiante, PDF_MINIMO);
    const { pagina, registro } = await abrir(contexto);
    await rellenar(pagina, cambiante);
    await pagina.waitForTimeout(300);
    await writeFile(cambiante, Buffer.concat([PDF_MINIMO, Buffer.from('% cambiado\n')]));
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(1200);

    comprobar(
      `${etiqueta} · Archivo cambiado tras elegirlo: la postulación se envía igual`,
      await pagina.locator('[data-confirmacion-empleo]').isVisible(),
      `${await textoDe(pagina.locator('[data-errores-empleo]'))} | ${await textoDe(pagina.locator('[data-codigo-error]'))}`,
    );
    const hoja = registro.envios[0]?.partes?.find((p) => p.nombre === 'hoja-de-vida');
    comprobar(
      `${etiqueta} · Archivo cambiado tras elegirlo: viajan los bytes que se revisaron al elegirlo`,
      hoja?.archivo === `cambia-${etiqueta}.pdf` && Buffer.compare(hoja.datos, PDF_MINIMO) === 0,
      hoja ? `${hoja.archivo} ${hoja.datos.length} B` : '(no llegó)',
    );
    await pagina.close();
  }

  /*
   * LA RED SE CAE UNA VEZ Y LA POSTULACIÓN SE SALVA.
   *
   * Es el caso que nos reportaron: desde el celular, «no pudimos conectar con
   * el servidor» (E-RED). Subir dos o tres megas por datos móviles es la parte
   * frágil de todo esto y basta un segundo de túnel para que el `fetch` muera.
   * Con un solo intento eso era el final del camino. Ahora se insiste, y lo que
   * el candidato ve es su confirmación.
   *
   * Y NO SE DUPLICA: los dos intentos llevan el mismo `idEnvio`, que el
   * servidor usa como llave de idempotencia de Control360.
   */
  {
    const { pagina, registro } = await abrir(contexto, { secuencia: ['caida', 'ok'] });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(4000);

    comprobar(
      `${etiqueta} · Red intermitente: el reintento la salva y sale la confirmación`,
      await pagina.locator('[data-confirmacion-empleo]').isVisible(),
      await textoDe(pagina.locator('[data-errores-empleo]')),
    );
    comprobar(
      `${etiqueta} · Red intermitente: se intentó dos veces, no más`,
      registro.envios.length === 2,
      `${registro.envios.length} envíos`,
    );
    const ids = registro.envios.map(
      (e) => e.partes?.find((x) => x.nombre === 'idEnvio')?.datos.toString() ?? '',
    );
    comprobar(
      `${etiqueta} · Red intermitente: los dos intentos llevan el MISMO idEnvio`,
      ids.length === 2 && ids[0] !== '' && ids[0] === ids[1],
      ids.join(' | '),
    );
    comprobar(
      `${etiqueta} · Red intermitente: el segundo intento lleva la hoja de vida otra vez`,
      (registro.envios[1]?.partes ?? []).some(
        (x) => x.nombre === 'hoja-de-vida' && x.datos.length > 0,
      ),
    );
    await pagina.close();
  }

  await contexto.close();
}

// --- C) El cargo preseleccionado ---------------------------------------------

async function revisarCargo(navegador) {
  console.log('\n=== C) Cargo preseleccionado ===\n');
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });

  {
    const { pagina } = await abrir(contexto, {}, '/empleos/?cargo=Buscamos%20Veh%C3%ADculos#postular');
    comprobar(
      'Llegando con ?cargo= el select trae esa vacante',
      (await pagina.locator('#cargo-empleo').inputValue()) === 'Buscamos Vehículos',
      await pagina.locator('#cargo-empleo').inputValue(),
    );
    await pagina.close();
  }

  {
    const { pagina } = await abrir(contexto);
    await pagina.locator('[data-postular="Vendedor TAT"]').first().click();
    await pagina.waitForTimeout(300);
    comprobar(
      '"Postularme" en la tarjeta deja ese cargo elegido',
      (await pagina.locator('#cargo-empleo').inputValue()) === 'Vendedor TAT',
    );
    comprobar(
      'El select ofrece la opción de hoja de vida espontánea',
      (await pagina.locator('#cargo-empleo option[value="Otro / hoja de vida espontánea"]').count()) === 1,
    );
    await pagina.close();
  }

  await contexto.close();
}

// --- D) Turnstile: interacción, error y script bloqueado ----------------------

/**
 * El fallo que hubo en producción: al pulsar Enviar, Cloudflare pedía marcar la
 * casilla, el cliente esperaba como mucho 30 segundos y, al vencer, abría el
 * `mailto:` sin haber llamado nunca a la función. Aquí se prueba con la clave
 * de prueba inyectada y el doble de Turnstile en cada modo.
 */
async function revisarTurnstile(navegador, archivos, etiqueta, viewport) {
  console.log(`\n=== D) Turnstile (${etiqueta}) ===\n`);
  const contexto = await navegador.newContext({ viewport });

  // ---- 1. Sin interacción: el token viaja en el multipart ------------------
  {
    const { pagina, registro } = await abrir(contexto, { turnstile: 'ok' });
    await pagina.waitForTimeout(300);
    comprobar(
      'Turnstile: con la clave inyectada el formulario la lleva',
      (await pagina.locator('[data-form-empleo]').getAttribute('data-turnstile-key')) ===
        CLAVE_TURNSTILE_PRUEBA,
    );
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(1200);
    const token = registro.envios[0]?.partes?.find((p) => p.nombre === 'turnstileToken');
    comprobar(
      'Turnstile: el token del widget viaja con la postulación y sale la confirmación',
      (token?.datos.toString('utf8') ?? '').startsWith('token-de-prueba-') &&
        (await pagina.locator('[data-confirmacion-empleo]').isVisible()),
      String(token?.datos.toString('utf8') ?? '(no llegó)'),
    );
    await pagina.close();
  }

  // ---- 2. Pide la casilla y el token llega pasados los 30 s ----------------
  {
    const { pagina, registro } = await abrir(contexto, {
      turnstile: 'interaccion',
      esperaInteraccionMs: 33_000,
    });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(800);

    const aviso = pagina.locator('[data-aviso-verificacion]');
    comprobar(
      'Casilla pedida: aparece el aviso de que falta marcar la verificación',
      (await aviso.isVisible()) && (await textoDe(aviso)).includes('marca la casilla'),
      await textoDe(aviso),
    );
    comprobar(
      'Casilla pedida: el botón sigue deshabilitado con "Enviando…"',
      (await pagina.locator('[data-enviar-empleo]').isDisabled()) &&
        (await textoDe(pagina.locator('[data-enviar-empleo]'))) === 'Enviando…',
    );

    // Pasado el tope viejo de 30 s: antes aquí ya se había abierto el correo.
    await pagina.waitForTimeout(30_500);
    comprobar(
      'Casilla pedida: a los 31 s NO se ha caído al correo ni se ha rendido',
      (await pagina.locator('[data-form-empleo][data-respaldo]').count()) === 0 &&
        registro.envios.length === 0 &&
        (await aviso.isVisible()),
      `respaldo=${await pagina.locator('[data-form-empleo]').getAttribute('data-respaldo')} envíos=${registro.envios.length}`,
    );

    await pagina.waitForTimeout(3_500);
    comprobar(
      'Casilla marcada: la postulación llega a la función con el token',
      registro.envios.length === 1 &&
        (registro.envios[0].partes?.find((p) => p.nombre === 'turnstileToken')?.datos.toString('utf8') ?? '')
          .startsWith('token-de-prueba-'),
      String(registro.envios.length),
    );
    comprobar(
      'Casilla marcada: sale la confirmación y el aviso desaparece',
      (await pagina.locator('[data-confirmacion-empleo]').isVisible()) && !(await aviso.isVisible()),
    );
    await pagina.close();
  }

  /*
   * ---- 3. Cloudflare responde con error ---------------------------------
   *
   * Este es el caso que reportaron los candidatos: «[turnstile] error 600010» y
   * un mensaje que les pedía volver a pulsar Enviar. Ahora la librería reintenta
   * sola una vez y, si el reto sigue sin pasar, la postulación SALE marcada
   * `sin_verificar` en vez de quedarse en la página.
   */
  {
    const { pagina, registro } = await abrir(contexto, { turnstile: 'error' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    // Dos intentos del reto, con su pausa de 600 ms entre medias.
    await pagina.waitForTimeout(3000);

    comprobar(
      `${etiqueta} · Error de Turnstile: la postulación SÍ llega a la función`,
      registro.envios.length === 1,
      `${registro.envios.length} envíos`,
    );
    const partes = registro.envios[0]?.partes ?? [];
    const valor = (nombre) => partes.find((p) => p.nombre === nombre)?.datos.toString('utf8');
    comprobar(
      `${etiqueta} · Error de Turnstile: va marcada sin_verificar, con el código de Cloudflare`,
      valor('sin_verificar') === 'si' && (valor('turnstileCodigo') ?? '').startsWith('T-'),
      `sin_verificar=${valor('sin_verificar')} codigo=${valor('turnstileCodigo')}`,
    );
    comprobar(
      `${etiqueta} · Error de Turnstile: la hoja de vida va con SUS bytes`,
      (partes.find((p) => p.nombre === 'hoja-de-vida')?.datos.length ?? 0) > 0,
    );
    comprobar(
      `${etiqueta} · Error de Turnstile: el candidato ve la confirmación, no un error`,
      (await pagina.locator('[data-confirmacion-empleo]').isVisible()) &&
        !(await pagina.locator('[data-errores-empleo]').isVisible()),
    );
    await pagina.close();
  }

  /*
   * ---- 4. El script de Cloudflare no carga ------------------------------
   *
   * Un bloqueador, una red corporativa, el WebView de WhatsApp. Antes se abría
   * el `mailto:` sin llamar nunca a la función, y en el celular muchas veces no
   * se abría nada: la postulación se perdía sin dejar rastro.
   */
  {
    const { pagina, registro } = await abrir(contexto, { turnstile: 'bloqueado' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(2000);

    comprobar(
      `${etiqueta} · Turnstile bloqueado: la postulación llega a la función igual`,
      registro.envios.length === 1,
      `${registro.envios.length} envíos`,
    );
    const partes = registro.envios[0]?.partes ?? [];
    const valor = (nombre) => partes.find((p) => p.nombre === nombre)?.datos.toString('utf8');
    comprobar(
      `${etiqueta} · Turnstile bloqueado: va marcada sin_verificar y con el token vacío`,
      valor('sin_verificar') === 'si' && valor('turnstileToken') === '',
      `sin_verificar=${valor('sin_verificar')} token=${JSON.stringify(valor('turnstileToken'))}`,
    );
    comprobar(
      `${etiqueta} · Turnstile bloqueado: sale la confirmación`,
      await pagina.locator('[data-confirmacion-empleo]').isVisible(),
    );
    await pagina.close();
  }

  /*
   * ---- 5. El reintento automático rescata un fallo pasajero -------------
   *
   * El doble de Turnstile en modo `un-fallo` falla la primera ejecución y
   * resuelve la segunda. Es lo que hace un 600010 esporádico, y la postulación
   * tiene que salir VERIFICADA, no marcada.
   */
  {
    const { pagina, registro } = await abrir(contexto, { turnstile: 'un-fallo' });
    await rellenar(pagina, archivos.pdfValido);
    await pagina.waitForTimeout(300);
    await pagina.click('[data-enviar-empleo]');
    await pagina.waitForTimeout(3000);

    const partes = registro.envios[0]?.partes ?? [];
    const valor = (nombre) => partes.find((p) => p.nombre === nombre)?.datos.toString('utf8');
    comprobar(
      `${etiqueta} · Un fallo pasajero: el reintento consigue el token y va VERIFICADA`,
      registro.envios.length === 1 &&
        (valor('turnstileToken') ?? '').startsWith('token-de-prueba-') &&
        valor('sin_verificar') === undefined,
      `token=${valor('turnstileToken')} sin_verificar=${valor('sin_verificar')}`,
    );
    await pagina.close();
  }

  await contexto.close();
}

// --- E) Opcional: envío real -------------------------------------------------

/**
 * POST multipart de verdad contra una función en marcha.
 *
 * Dos requisitos que no son obvios:
 * - Lleva cabecera `Origin`. Astro rechaza con 403 «Cross-site POST form
 *   submissions are forbidden» cualquier multipart que llegue sin ella o con
 *   otro origen; el navegador la pone solo, `fetch` de Node no.
 * - El token es de mentira, así que solo pasa si el servidor usa la clave
 *   secreta de PRUEBA de Turnstile (1x0000000000000000000000000000000AA). Con
 *   la de producción la función responde 403, y eso ya prueba que contesta.
 */
async function envioReal(base, archivos) {
  console.log(`\n=== E) Envío real contra ${base} ===\n`);
  const cuerpo = new FormData();
  cuerpo.set('nombre', 'Prueba automática de dstunja.com');
  cuerpo.set('correo', 'practicaspasantiasdst@gmail.com');
  cuerpo.set('telefono', '3106232429');
  cuerpo.set('municipio', 'Tunja');
  cuerpo.set('cargo', 'Otro / hoja de vida espontánea');
  cuerpo.set('experiencia', 'Envío de prueba de scripts/verificar-empleos.mjs. Ignorar.');
  cuerpo.set('autorizacion', 'si');
  cuerpo.set('turnstileToken', 'token-de-prueba');
  cuerpo.set(
    'hoja-de-vida',
    new File([await readFile(archivos.pdfValido)], 'hoja de vida.pdf', { type: 'application/pdf' }),
  );

  try {
    const origen = new URL(base).origin;
    const respuesta = await fetch(`${base.replace(/\/$/, '')}/api/empleos/postular`, {
      method: 'POST',
      headers: { origin: origen },
      body: cuerpo,
    });
    const texto = await respuesta.text();
    console.log(`  Respuesta completa: HTTP ${respuesta.status} ${respuesta.headers.get('content-type') ?? ''}`);
    console.log(`  ${texto}`);
    comprobar(
      'Envío real: la función respondió JSON',
      (respuesta.headers.get('content-type') ?? '').includes('application/json'),
      `${respuesta.status} ${texto.slice(0, 200)}`,
    );
    comprobar('Envío real: respondió 200 { ok: true }', respuesta.status === 200 && texto.includes('"ok":true'), `${respuesta.status} ${texto.slice(0, 200)}`);
  } catch (fallo) {
    comprobar('Envío real: la función contestó', false, fallo.message);
  }
}

// --- E) El navegador incrustado de otra aplicación ---------------------------

/*
 * El caso que dejó sin postularse a los candidatos: el flyer de la vacante
 * circula por WhatsApp, el enlace se abre DENTRO de WhatsApp y ese navegador
 * muchas veces no puede abrir el selector de archivos. Se toca «Hoja de vida» y
 * no pasa nada; desde el PC el mismo formulario funciona.
 *
 * Desde la página no hay forma de forzar el selector, así que lo que se
 * comprueba aquí es que el aviso con las salidas aparezca cuando el UA delata un
 * navegador incrustado, y que NO aparezca en un navegador normal (ver
 * src/lib/navegador-incrustado.ts).
 */
const UA_WHATSAPP =
  'Mozilla/5.0 (Linux; Android 13; SM-A135M Build/TP1A.220624.014; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36';
const UA_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113 (iPhone13,2; iOS 17_1_1; es_CO)';
const UA_CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/119.0.0.0 Mobile Safari/537.36';

async function revisarNavegadorIncrustado(navegador, archivos) {
  console.log('\n=== E) Navegador incrustado (WhatsApp, Instagram) ===\n');
  const viewport = { width: 375, height: 720 };

  // 1) El WebView de WhatsApp: el aviso sale, con el enlace a Chrome.
  const enWhatsapp = await navegador.newContext({ viewport, userAgent: UA_WHATSAPP });
  {
    const { pagina } = await abrir(enWhatsapp, {});
    const aviso = pagina.locator('[data-aviso-webview]');
    comprobar('WhatsApp: el aviso de que el selector puede no abrir está a la vista', await aviso.isVisible());
    comprobar(
      'WhatsApp: en Android se ofrece abrir la página en Chrome con un intent://',
      (await pagina.locator('[data-abrir-chrome]').isVisible()) &&
        ((await pagina.locator('[data-abrir-chrome]').getAttribute('href')) ?? '').startsWith(
          'intent://',
        ),
      (await pagina.locator('[data-abrir-chrome]').getAttribute('href')) ?? '',
    );
    comprobar(
      'WhatsApp: el aviso ofrece también copiar el enlace y mandarla por WhatsApp',
      (await pagina.locator('[data-copiar-enlace]').isVisible()) &&
        (await textoDe(aviso)).includes('WhatsApp'),
    );

    /*
     * Y EN CUANTO HAY ARCHIVO, EL AVISO SE VA. Dentro de un WebView que SÍ abre
     * el selector (los hay), el aviso no se puede quedar contradiciendo lo que
     * la persona acaba de conseguir.
     */
    await pagina.setInputFiles('#hoja-de-vida-empleo', archivos.pdfValido);
    await pagina.waitForTimeout(300);
    comprobar(
      'WhatsApp: adjuntada la hoja de vida, el aviso desaparece',
      !(await aviso.isVisible()),
    );
    await pagina.close();
  }
  await enWhatsapp.close();

  // 2) Instagram en iOS: el aviso nombra la aplicación, y no hay intent://.
  const enInstagram = await navegador.newContext({ viewport, userAgent: UA_INSTAGRAM });
  {
    const { pagina } = await abrir(enInstagram, {});
    const aviso = pagina.locator('[data-aviso-webview]');
    comprobar('Instagram: el aviso está a la vista', await aviso.isVisible());
    comprobar(
      'Instagram: el aviso dice dentro de QUÉ aplicación está la página',
      (await textoDe(aviso)).includes('Instagram'),
      await textoDe(aviso),
    );
    comprobar(
      'Instagram: en iOS no se ofrece el intent:// de Android',
      !(await pagina.locator('[data-abrir-chrome]').isVisible()),
    );
    await pagina.close();
  }
  await enInstagram.close();

  // 3) Chrome de Android, que es un navegador de verdad: nada que avisar.
  const enChrome = await navegador.newContext({ viewport, userAgent: UA_CHROME_ANDROID });
  {
    const { pagina } = await abrir(enChrome, {});
    comprobar(
      'Chrome de Android: NO se enseña ningún aviso (no es un navegador incrustado)',
      !(await pagina.locator('[data-aviso-webview]').isVisible()),
    );
    await pagina.close();
  }
  await enChrome.close();
}

// --- Ejecución --------------------------------------------------------------

const archivos = await prepararArchivos();

// `--solo-api` salta las pruebas de navegador y hace solo el envío real.
if (!process.argv.includes('--solo-api')) {
  const servidor = await servir();
  const navegador = await chromium.launch();
  try {
    await revisarCampo(navegador, archivos, 'Móvil', { width: 375, height: 720 });
    await revisarCampo(navegador, archivos, 'Escritorio', { width: 1280, height: 800 });
    // El envío se prueba en los dos tamaños: los fallos que reportaron los
    // candidatos venían del celular, y el respaldo por correo que se quitó era
    // justo lo que peor se portaba ahí.
    await revisarEnvio(navegador, archivos, 'Móvil', { width: 375, height: 720 });
    await revisarEnvio(navegador, archivos, 'Escritorio', { width: 1280, height: 900 });
    await revisarCargo(navegador);
    // Turnstile, en móvil: es donde vive el WebView de WhatsApp.
    await revisarTurnstile(navegador, archivos, 'Móvil', { width: 375, height: 720 });
    await revisarNavegadorIncrustado(navegador, archivos);
  } finally {
    await navegador.close();
    servidor.close();
  }
}

const indiceApi = process.argv.indexOf('--api');
if (indiceApi !== -1 && process.argv[indiceApi + 1]) {
  await envioReal(process.argv[indiceApi + 1], archivos);
}

const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} comprobaciones correctas.`);
process.exit(fallas.length === 0 ? 0 : 1);
