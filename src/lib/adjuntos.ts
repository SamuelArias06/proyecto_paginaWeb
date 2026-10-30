/**
 * Reglas de los archivos de soporte de una PQRS.
 *
 * Este módulo es deliberadamente AGNÓSTICO DEL ENTORNO: no toca el DOM, no usa
 * `import.meta.env` y no depende de ninguna API exclusiva del navegador. Lee los
 * bytes a través de una función `LectorBytes` que le pasa quien lo llama. Así el
 * mismo archivo sirve hoy para validar en el navegador (`lectorDeBlob`, sobre un
 * `File`) y mañana, sin tocarlo, para validar en el servidor (un lector sobre
 * `fs.read` o sobre el `Buffer` del multipart).
 *
 * Eso importa porque el sitio es estático y hoy NO hay backend: la validación
 * del navegador es lo único que corre. Cuando exista el endpoint real hay que
 * volver a ejecutar `validarArchivo` en el servidor con estas mismas reglas: la
 * validación de cliente se salta con unas DevTools abiertas. El contrato del
 * endpoint y el SQL de `pqrs_adjuntos` están en docs/PQRS-ADJUNTOS.md.
 */

/** Tamaño máximo por archivo. Configurable con PUBLIC_PQRS_ADJUNTO_MAX_MB. */
export const MAX_MB_POR_DEFECTO = 5;

/** Cuántos soportes admite una radicación. */
export const MAX_ARCHIVOS_POR_DEFECTO = 3;

/*
 * AQUÍ YA NO SE DECIDE QUÉ TIPOS LLEVAN SOPORTE. Hubo una lista
 * `TIPOS_CON_SOPORTE = ['queja', 'reclamo']` y un `requiereSoporte()` que la
 * consultaba; se eliminaron al abrir los adjuntos a los cinco tipos de la
 * categoría comercial. Hoy lo único que decide si hay campo de soporte es la
 * CATEGORÍA, y eso vive en `admiteSoporte()` de src/lib/pqrs/categorias.ts.
 *
 * Este módulo se quedó con lo que siempre fue suyo: qué formatos se aceptan,
 * cuánto pueden pesar y cómo se comprueba que el contenido es de verdad lo que
 * dice la extensión.
 */

/** Extensión aceptada al MIME que debe tener el contenido de verdad. */
export const EXTENSION_A_MIME: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * El camino inverso: del contenido detectado a la extensión que le corresponde.
 *
 * Hace falta porque el nombre del archivo NO siempre trae una extensión
 * utilizable. Los selectores de archivos de Android devuelven el nombre que
 * muestra el proveedor (Drive, Descargas, Documentos de WhatsApp), y muchos lo
 * dan sin extensión o con otra; en el PC eso no pasa casi nunca. Con este mapa,
 * `validarArchivo` puede corregir la extensión a partir del contenido en vez de
 * rechazar un PDF de verdad por cómo lo nombró el teléfono (ver
 * `confiarEnElContenido`).
 *
 * El primer par gana: `.jpg` antes que `.jpeg` para `image/jpeg`.
 */
export const MIME_A_EXTENSION: Readonly<Record<string, string>> = Object.freeze(
  Object.entries(EXTENSION_A_MIME).reduce<Record<string, string>>((mapa, [extension, mime]) => {
    if (!(mime in mapa)) mapa[mime] = extension;
    return mapa;
  }, {}),
);

/** MIME de imagen, para distinguir «subió una foto» de «subió cualquier cosa». */
const MIMES_DE_IMAGEN: readonly string[] = ['image/jpeg', 'image/png'];

/** Valor del atributo `accept` del <input type="file">. */
export const ACEPTA = Object.keys(EXTENSION_A_MIME).join(',');

/** Lista legible de formatos, para los mensajes y el texto de ayuda. */
export const FORMATOS_LEGIBLES = 'PDF, Word (.doc, .docx), JPG, PNG';

/**
 * Extensiones que no pueden aparecer en el nombre, ni siquiera en medio.
 *
 * Cubre el caso `factura.pdf.exe` (que además ya cae por la extensión final) y
 * sobre todo el inverso `factura.exe.pdf`, que pasa el filtro de extensión pero
 * está pensado para que alguien lo renombre al abrirlo.
 */
const EXTENSIONES_PELIGROSAS = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'pif', 'cpl', 'dll', 'sys', 'lnk',
  'jar', 'apk', 'app', 'dmg', 'deb', 'rpm', 'bin', 'run',
  'js', 'mjs', 'cjs', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1',
  'sh', 'bash', 'zsh', 'py', 'pl', 'rb', 'php', 'phtml', 'php5', 'asp', 'aspx',
  'jsp', 'cgi', 'htm', 'html', 'xhtml', 'svg', 'shtml', 'hta', 'reg', 'inf',
]);

/** Lee un rango de bytes [inicio, fin). Puede devolver menos de lo pedido. */
export type LectorBytes = (inicio: number, fin: number) => Promise<Uint8Array>;

export interface ArchivoAValidar {
  /** Nombre tal como lo mandó el navegador. Se sanitiza aquí, no antes. */
  nombre: string;
  tamano: number;
  leer: LectorBytes;
}

export interface OpcionesValidacion {
  /** Tamaño máximo por archivo, en MB. */
  maxMb?: number;
  /**
   * Qué puede ser el CONTENIDO del archivo. Por defecto, cualquiera de los
   * tipos de `EXTENSION_A_MIME`. El campo de hoja de vida lo acota a documentos
   * (ver src/lib/empleos/hoja-de-vida.ts).
   */
  mimesPermitidos?: readonly string[];
  /** Lista legible de formatos para los mensajes de error. */
  formatosLegibles?: string;
  /**
   * MANDA EL CONTENIDO, NO EL NOMBRE.
   *
   * Con esto puesto, un archivo cuyo contenido es de un tipo permitido se
   * acepta aunque el nombre venga sin extensión o con otra, y la extensión que
   * se devuelve es la del contenido. Sin esto (lo que siguen haciendo los
   * soportes de PQRS), nombre y contenido tienen que coincidir.
   *
   * Existe por el celular: los selectores de Android entregan el nombre que
   * muestra el proveedor del archivo, y muchas veces es «Documento» o
   * «hoja de vida» a secas. Rechazar eso por «formato no permitido» echaba
   * atrás a candidatos con un PDF perfectamente válido en la mano.
   */
  confiarEnElContenido?: boolean;
}

export type ResultadoValidacion =
  | { ok: true; mime: string; extension: string; nombreSeguro: string }
  | { ok: false; error: string };

// --- Utilidades de texto ----------------------------------------------------

/** Minúsculas y sin tildes, para comparar valores que vienen de la interfaz. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Extensión en minúsculas, con el punto. Cadena vacía si no tiene. */
export function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  if (punto <= 0) return '';
  return nombre.slice(punto).toLowerCase();
}

/**
 * Nombre de archivo seguro para escribir en disco o para meter en una consulta.
 *
 * Quita rutas (`..\..\algo`), caracteres de control y todo lo que no sea
 * `[A-Za-z0-9._-]`. NO es el nombre con el que se guarda el archivo: el
 * almacenado debe ser un UUID más la extensión (ver docs/PQRS-ADJUNTOS.md).
 * Este es el `nombre_original` que va a la base de datos, y se limpia igual
 * porque un nombre con comillas o con `<script>` acaba pintado en el panel de
 * administración.
 *
 * Para lo que ve la persona se usa `nombreParaMostrar`, que conserva las
 * tildes: nadie reconoce su "factura_marzo.pdf" si se lo llamamos así.
 */
export function sanitizarNombre(nombre: string): string {
  // Solo el último tramo: descarta cualquier intento de ruta relativa.
  const base = nombre.split(/[\\/]/).pop() ?? '';

  const limpio = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tildes fuera: "peticion.pdf"
    .replace(/[\u0000-\u001f\u007f]/g, '') // controles y NUL
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, ''); // nada de archivos ocultos ni de guion inicial

  if (limpio === '' || limpio === '.') return 'archivo';

  // Recorta el cuerpo pero conserva la extensión: los sistemas de archivos y
  // las columnas de base de datos tienen límite, y perder la extensión estorba.
  const extension = extensionDe(limpio);
  const cuerpo = extension ? limpio.slice(0, -extension.length) : limpio;
  const cuerpoCorto = cuerpo.slice(0, 100) || 'archivo';
  return `${cuerpoCorto}${extension}`;
}

/**
 * Nombre para enseñar en pantalla y en el correo.
 *
 * Conserva tildes y espacios, que es como la persona reconoce su archivo, pero
 * quita rutas y caracteres de control y recorta la longitud. NO sirve para
 * escribir en disco ni para construir una ruta: para eso está
 * `sanitizarNombre`, y el archivo se guarda con un UUID de todas formas.
 *
 * Pintarlo siempre con `textContent`, nunca con `innerHTML`.
 */
export function nombreParaMostrar(nombre: string): string {
  const base = (nombre.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (base === '') return 'archivo';
  return base.length > 80 ? `${base.slice(0, 77)}...` : base;
}

/**
 * El nombre esconde una extensión ejecutable?
 *
 * Se miran TODOS los tramos después del primer punto, no solo el último, para
 * atrapar tanto `factura.pdf.exe` como `factura.exe.pdf`. Los tramos que no
 * parecen extensión no molestan: en `informe.v2.final.pdf` ni `v2` ni `final`
 * están en la lista negra, así que ese nombre pasa.
 */
export function tieneDobleExtensionSospechosa(nombre: string): boolean {
  const base = nombre.split(/[\\/]/).pop() ?? '';
  const tramos = base.toLowerCase().split('.').slice(1);
  if (tramos.length < 2) return false;
  return tramos.some((t) => EXTENSIONES_PELIGROSAS.has(t));
}

/** "1,2 MB", "340 KB", "812 B": con coma decimal, como se escribe en español. */
export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}

// --- Detección del tipo real ------------------------------------------------

const FIRMAS: ReadonlyArray<{ mime: string; bytes: readonly number[] }> = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
  // Contenedor OLE2/CFB: es lo que usa Word 97-2003 (.doc).
  { mime: 'application/msword', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  // Los .docx son ZIP. El ZIP se afina más abajo buscando la carpeta "word/".
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x07, 0x08] },
];

/** Ventana que se lee por cada extremo para inspeccionar el ZIP. */
const VENTANA = 64 * 1024;

function empiezaPor(datos: Uint8Array, bytes: readonly number[]): boolean {
  if (datos.length < bytes.length) return false;
  return bytes.every((b, i) => datos[i] === b);
}

/** Busca una cadena ASCII dentro de un bloque de bytes. */
function contiene(datos: Uint8Array, texto: string): boolean {
  const aguja = Array.from(texto, (c) => c.charCodeAt(0));
  const tope = datos.length - aguja.length;
  for (let i = 0; i <= tope; i += 1) {
    let coincide = true;
    for (let j = 0; j < aguja.length; j += 1) {
      if (datos[i + j] !== aguja[j]) {
        coincide = false;
        break;
      }
    }
    if (coincide) return true;
  }
  return false;
}

/**
 * MIME deducido del CONTENIDO, no de la extensión ni del `type` que declara el
 * navegador: los dos los pone quien sube el archivo y los dos se falsifican.
 *
 * Devuelve `null` si no reconoce la firma.
 */
export async function detectarMimeReal(leer: LectorBytes, tamano: number): Promise<string | null> {
  const cabecera = await leer(0, Math.min(VENTANA, tamano));

  for (const firma of FIRMAS) {
    if (!empiezaPor(cabecera, firma.bytes)) continue;

    if (firma.mime !== 'application/zip') return firma.mime;

    // Un .docx es un ZIP que contiene la carpeta "word/". Se busca al principio
    // (cabeceras locales) y al final (directorio central, que siempre lista
    // todas las entradas): así un .zip cualquiera renombrado a .docx no pasa.
    const docx = EXTENSION_A_MIME['.docx'] as string;
    if (contiene(cabecera, 'word/')) return docx;
    if (tamano > VENTANA) {
      const cola = await leer(Math.max(0, tamano - VENTANA), tamano);
      if (contiene(cola, 'word/')) return docx;
    }
    return 'application/zip';
  }

  // Algunos PDF traen basura antes de la cabecera; el estándar admite que el
  // "%PDF-" aparezca dentro del primer kilobyte.
  if (contiene(cabecera.subarray(0, 1024), '%PDF-')) return 'application/pdf';

  return null;
}

// --- Validación -------------------------------------------------------------

/**
 * Aplica todas las reglas a un archivo. Devuelve el MIME real y el nombre ya
 * saneado, que es lo que hay que guardar como `nombre_original`.
 */
export async function validarArchivo(
  archivo: ArchivoAValidar,
  opciones: OpcionesValidacion = {},
): Promise<ResultadoValidacion> {
  const maxMb = opciones.maxMb ?? MAX_MB_POR_DEFECTO;
  const maxBytes = maxMb * 1024 * 1024;
  const formatos = opciones.formatosLegibles ?? FORMATOS_LEGIBLES;
  const permitidos = opciones.mimesPermitidos ?? Object.values(EXTENSION_A_MIME);
  const nombreSeguro = sanitizarNombre(archivo.nombre);
  // En los mensajes va el nombre que la persona reconoce, con sus tildes; en el
  // resultado va el saneado, que es el que se guardaría en base de datos.
  const visible = `«${nombreParaMostrar(archivo.nombre)}»`;

  if (archivo.tamano <= 0) {
    return { ok: false, error: `${visible}: el archivo está vacío.` };
  }

  if (archivo.tamano > maxBytes) {
    return {
      ok: false,
      error: `${visible}: pesa ${formatearTamano(archivo.tamano)} y el máximo es ${maxMb} MB.`,
    };
  }

  if (tieneDobleExtensionSospechosa(archivo.nombre)) {
    return {
      ok: false,
      error: `${visible}: el nombre tiene una doble extensión sospechosa. Renómbralo y vuelve a intentarlo.`,
    };
  }

  const extension = extensionDe(nombreSeguro);
  const mimeEsperado = EXTENSION_A_MIME[extension];
  // Sin `confiarEnElContenido`, un nombre sin extensión conocida se corta aquí y
  // no se leen los bytes. Con él, la extensión no decide nada todavía: puede
  // faltar, y lo único que importa es lo que haya dentro.
  if (!mimeEsperado && !opciones.confiarEnElContenido) {
    return {
      ok: false,
      error: `${visible}: formato no permitido. Solo aceptamos ${formatos}.`,
    };
  }

  const mimeReal = await detectarMimeReal(archivo.leer, archivo.tamano);
  if (mimeReal === null) {
    return {
      ok: false,
      error: `${visible}: no reconocemos el contenido del archivo. Vuelve a guardarlo como ${formatos}.`,
    };
  }

  /*
   * MODO ESTRICTO (el de los soportes de PQRS): nombre y contenido tienen que
   * decir lo mismo. Se comprueba ANTES que la lista de tipos admitidos para que
   * el mensaje siga siendo el que ya decía —«el contenido no corresponde a la
   * extensión .docx»—, que para un archivo con nombre y extensión de verdad es
   * más útil que hablar de la lista de formatos.
   */
  if (!opciones.confiarEnElContenido) {
    if (mimeReal !== mimeEsperado) {
      return {
        ok: false,
        error: `${visible}: el contenido no corresponde a la extensión ${extension}. Guárdalo de nuevo en el formato correcto.`,
      };
    }
    if (!permitidos.includes(mimeReal)) {
      return { ok: false, error: noAdmitido(visible, mimeReal, formatos) };
    }
    return { ok: true, mime: mimeEsperado, extension, nombreSeguro };
  }

  /*
   * MANDA EL CONTENIDO. Aquí la extensión del nombre no ha decidido nada, así
   * que lo único que puede descartar el archivo es lo que haya dentro.
   */
  if (!permitidos.includes(mimeReal)) {
    return { ok: false, error: noAdmitido(visible, mimeReal, formatos) };
  }

  /*
   * Vale. La extensión con la que sigue viaje es la del CONTENIDO: así el
   * adjunto del correo y el archivo que llega a Control360 se abren con el
   * programa correcto aunque el teléfono haya entregado el nombre sin extensión
   * o con otra. Se conserva la que ya traía cuando corresponde al mismo tipo
   * (un «.jpeg» no se vuelve «.jpg» por gusto).
   */
  const extensionFinal =
    mimeEsperado === mimeReal ? extension : (MIME_A_EXTENSION[mimeReal] as string);
  return {
    ok: true,
    mime: mimeReal,
    extension: extensionFinal,
    nombreSeguro: conExtension(nombreSeguro, extensionFinal),
  };
}

/**
 * El contenido es de un tipo que este campo no admite.
 *
 * Se dice QUÉ subió, porque es lo único que le permite arreglarlo: «formato no
 * permitido» a secas no explica nada a quien acaba de elegir un archivo que se
 * llama «hoja de vida» y es la foto de una hoja de vida.
 */
function noAdmitido(visible: string, mimeReal: string, formatos: string): string {
  if (MIMES_DE_IMAGEN.includes(mimeReal)) {
    return `${visible}: es una foto, no un documento. Solo aceptamos ${formatos}; si solo lo tienes en fotos, pásalas a PDF antes de subirlo.`;
  }
  return `${visible}: el contenido no es ${formatos}. Guárdalo de nuevo en el formato correcto.`;
}

/** El mismo nombre, con la extensión `extension` en lugar de la que tuviera. */
export function conExtension(nombre: string, extension: string): string {
  const actual = extensionDe(nombre);
  const cuerpo = actual ? nombre.slice(0, -actual.length) : nombre;
  return `${cuerpo || 'archivo'}${extension}`;
}

// --- Puentes con cada entorno ----------------------------------------------

/** Lector sobre un Blob o File del navegador. */
export function lectorDeBlob(blob: Blob): LectorBytes {
  return async (inicio, fin) =>
    new Uint8Array(await blob.slice(inicio, Math.min(fin, blob.size)).arrayBuffer());
}

/** Atajo de navegador: valida un File tal cual sale del <input type="file">. */
export function validarFile(file: File, opciones: OpcionesValidacion = {}) {
  return validarArchivo({ nombre: file.name, tamano: file.size, leer: lectorDeBlob(file) }, opciones);
}
