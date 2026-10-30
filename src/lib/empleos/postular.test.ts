/**
 * Pruebas de POST /api/empleos/postular (src/lib/empleos/postular.ts).
 *
 * Es el formulario de postulación de /empleos/: manda un correo por Resend con
 * la hoja de vida adjunta y no guarda nada. Aquí se comprueba el servidor —qué
 * acepta, qué rechaza y qué acaba en el correo—; lo que se ve en pantalla se
 * prueba con un navegador de verdad en scripts/verificar-empleos.mjs.
 *
 * Resend se sustituye por un doble que apunta cada mensaje en `correosEnviados`,
 * igual que en administrativa.test.ts. Los archivos son bytes de verdad: un PDF
 * mínimo, un contenedor OLE2 (.doc), un ZIP con `word/` (.docx) y sus
 * impostores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crc32 } from 'node:zlib';

const correosEnviados: Array<Record<string, unknown>> = [];
/** Clave con la que se creó cada cliente de Resend, en orden. */
const clavesUsadas: string[] = [];
/** Lo que devuelve el doble de Resend. Se cambia para probar el fallo. */
let respuestaResend: { data: unknown; error: { message: string } | null } = {
  data: { id: 'correo-de-prueba' },
  error: null,
};
/**
 * Respuestas encoladas, una por intento, para probar los reintentos.
 *
 * Mientras tenga elementos, cada envío consume el primero; cuando se vacía se
 * vuelve a usar `respuestaResend`. Así se puede describir «el primer intento
 * falla y el segundo pasa» sin tocar el doble de Resend desde cada prueba.
 */
const colaResend: Array<{ data: unknown; error: { message: string } | null }> = [];

vi.mock('resend', () => ({
  Resend: class {
    constructor(clave: string) {
      clavesUsadas.push(clave);
    }
    emails = {
      send: async (mensaje: Record<string, unknown>) => {
        correosEnviados.push(mensaje);
        return colaResend.shift() ?? respuestaResend;
      },
    };
  },
}));

const { atenderPostulacion } = await import('./postular');
const { reiniciarMemoria } = await import('../pqrs/limite-tasa');

const ENTORNO = {
  TURNSTILE_SECRET: 'secreto-de-prueba',
  RESEND_API_KEY: 're_prueba',
};

/**
 * Se pasa como `dormir` en los casos que prueban un fallo de correo: el envio
 * se reintenta tres veces con pausas crecientes, y esperarlas de verdad
 * añadiría dos segundos de reloj a cada una de esas pruebas sin comprobar nada.
 */
const SIN_ESPERA = async () => {};

// --- Archivos de prueba -----------------------------------------------------

const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);
const OLE2 = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(1024),
]);

/** ZIP mínimo con una entrada almacenada, para hacer un .docx creíble. */
function zipConEntrada(nombreEntrada: string, contenido: string): Buffer {
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

const DOCX = zipConEntrada('word/document.xml', '<w:document/>');
const ZIP_AJENO = zipConEntrada('otra/cosa.txt', 'hola');

interface Archivo {
  nombre: string;
  bytes: Buffer;
  tipo?: string;
}

const HOJA_PDF: Archivo = { nombre: 'hoja de vida.pdf', bytes: PDF_MINIMO, tipo: 'application/pdf' };

function campos(extra: Record<string, string> = {}): Record<string, string> {
  return {
    nombre: 'Cristian Amaya',
    correo: 'practicaspasantiasdst@gmail.com',
    telefono: '310 623 2429',
    municipio: 'Tunja',
    cargo: 'Vendedor TAT',
    experiencia: 'Dos años en ventas TAT en Tunja.',
    autorizacion: 'si',
    turnstileToken: 'token-valido',
    ...extra,
  };
}

/** Arma la petición multipart tal como la manda el navegador. */
function peticion(
  valores: Record<string, string>,
  archivo: Archivo | null = HOJA_PDF,
  ip = '203.0.113.10',
): Request {
  const formulario = new FormData();
  for (const [clave, valor] of Object.entries(valores)) formulario.set(clave, valor);
  if (archivo) {
    // Copia a un Uint8Array con su propio ArrayBuffer: un Buffer de Node no
    // encaja en el tipo BlobPart (puede colgar de un SharedArrayBuffer).
    formulario.set(
      'hoja-de-vida',
      new File([new Uint8Array(archivo.bytes)], archivo.nombre, {
        type: archivo.tipo ?? 'application/octet-stream',
      }),
    );
  }
  return new Request('https://dstunja.com/api/empleos/postular', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: formulario,
  });
}

function turnstileResponde(exito: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: exito,
            'error-codes': exito ? [] : ['invalid-input-response'],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
}

function errores(respuesta: Awaited<ReturnType<typeof atenderPostulacion>>): string[] {
  return respuesta.cuerpo.ok ? [] : respuesta.cuerpo.errores;
}

function adjuntos(): Array<{ filename: string; content: Buffer; contentType: string }> {
  return (correosEnviados[0]?.attachments ?? []) as Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

beforeEach(() => {
  correosEnviados.length = 0;
  clavesUsadas.length = 0;
  respuestaResend = { data: { id: 'correo-de-prueba' }, error: null };
  colaResend.length = 0;
  reiniciarMemoria();
  turnstileResponde(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Camino feliz ------------------------------------------------------------

describe('postulación válida', () => {
  it('responde 200 y manda UN correo a Talento Humano', async () => {
    const respuesta = await atenderPostulacion(peticion(campos()), ENTORNO);

    expect(respuesta.estado).toBe(200);
    expect(respuesta.cuerpo).toEqual({ ok: true });
    expect(correosEnviados).toHaveLength(1);
    expect(correosEnviados[0]!.to).toBe('ghsantiagodetunja@gmail.com');
  });

  it('el asunto es «Postulación: [cargo] – [nombre]»', async () => {
    await atenderPostulacion(peticion(campos()), ENTORNO);
    expect(correosEnviados[0]!.subject).toBe('Postulación: Vendedor TAT – Cristian Amaya');
  });

  it('responder desde la bandeja va al candidato', async () => {
    await atenderPostulacion(peticion(campos()), ENTORNO);
    expect(correosEnviados[0]!.replyTo).toBe('practicaspasantiasdst@gmail.com');
  });

  it('la hoja de vida va ADJUNTA, con los bytes recibidos y el MIME real', async () => {
    await atenderPostulacion(peticion(campos()), ENTORNO);
    const [adjunto, ...resto] = adjuntos();

    expect(resto).toHaveLength(0);
    expect(adjunto).toBeDefined();
    // El nombre viaja saneado: sin espacios ni caracteres raros.
    expect(adjunto!.filename).toBe('hoja_de_vida.pdf');
    expect(adjunto!.contentType).toBe('application/pdf');
    expect(Buffer.compare(Buffer.from(adjunto!.content), PDF_MINIMO)).toBe(0);
  });

  it('el cuerpo lleva todos los datos y el nombre del adjunto', async () => {
    await atenderPostulacion(peticion(campos()), ENTORNO);
    const texto = String(correosEnviados[0]!.text);
    expect(texto).toContain('Cristian Amaya');
    expect(texto).toContain('Vendedor TAT');
    expect(texto).toContain('310 623 2429');
    expect(texto).toContain('practicaspasantiasdst@gmail.com');
    expect(texto).toContain('Dos años en ventas TAT en Tunja.');
    expect(texto).toContain('hoja_de_vida.pdf');
  });

  it('el teléfono va como enlace tel: y el correo como mailto:', async () => {
    await atenderPostulacion(peticion(campos()), ENTORNO);
    const html = String(correosEnviados[0]!.html);
    expect(html).toContain('href="tel:+573106232429"');
    expect(html).toContain('href="mailto:practicaspasantiasdst@gmail.com"');
  });

  it('un teléfono escrito con el 57 delante no lo duplica en el tel:', async () => {
    await atenderPostulacion(peticion(campos({ telefono: '+57 310 623 2429' })), ENTORNO);
    expect(String(correosEnviados[0]!.html)).toContain('href="tel:+573106232429"');
  });

  it('lo escrito por la persona llega escapado al HTML', async () => {
    await atenderPostulacion(
      peticion(campos({ nombre: 'Ana <script>alert(1)</script>' })),
      ENTORNO,
    );
    const html = String(correosEnviados[0]!.html);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sin texto de experiencia se envía igual y el correo lo dice', async () => {
    const respuesta = await atenderPostulacion(peticion(campos({ experiencia: '' })), ENTORNO);
    expect(respuesta.estado).toBe(200);
    expect(String(correosEnviados[0]!.text)).toContain('está todo en la hoja de vida');
  });

  it('no manda correo de confirmación al candidato ni promete radicado', async () => {
    const respuesta = await atenderPostulacion(peticion(campos()), ENTORNO);
    expect(correosEnviados).toHaveLength(1);
    expect(respuesta.cuerpo).not.toHaveProperty('radicado');
  });
});

// --- Destino y remitente -----------------------------------------------------

describe('destino y remitente', () => {
  it('sin variables, el remitente es el de pruebas de Resend, el mismo de PQRS', async () => {
    await atenderPostulacion(peticion(campos()), ENTORNO);
    expect(correosEnviados[0]!.from).toBe('onboarding@resend.dev');
  });

  /*
   * PQRS y Empleos usan cuentas de Resend distintas. Si Empleos tomara la clave
   * de PQRS, sus correos saldrían por la cuenta equivocada y Resend los
   * rechazaría: con el remitente de pruebas cada cuenta solo entrega a su titular.
   */
  it('usa RESEND_API_KEY aunque exista PQRS_RESEND_API_KEY', async () => {
    const respuesta = await atenderPostulacion(peticion(campos()), {
      ...ENTORNO,
      PQRS_RESEND_API_KEY: 're_de_pqrs',
    });
    expect(respuesta.estado).toBe(200);
    expect(clavesUsadas.at(-1)).toBe('re_prueba');
  });

  it('EMPLEOS_DESTINO y EMPLEOS_REMITENTE mandan si están definidas', async () => {
    await atenderPostulacion(peticion(campos()), {
      ...ENTORNO,
      EMPLEOS_DESTINO: 'talento@ejemplo.com',
      EMPLEOS_REMITENTE: 'Empleos DST <empleos@dstunja.com>',
    });
    expect(correosEnviados[0]!.to).toBe('talento@ejemplo.com');
    expect(correosEnviados[0]!.from).toBe('Empleos DST <empleos@dstunja.com>');
  });

  /*
   * Antes SI lo heredaba, y era un error esperando su turno: PQRS y Empleos usan
   * cuentas de Resend distintas, asi que un dominio verificado en la de PQRS no
   * lo esta en la de Empleos. El dia que PQRS estrenara dominio propio, Empleos
   * habria empezado a mandar desde una direccion que su cuenta no puede firmar y
   * todas las postulaciones habrian fallado a la vez.
   */
  it('NO hereda PQRS_REMITENTE: se queda con el remitente de pruebas', async () => {
    await atenderPostulacion(peticion(campos()), {
      ...ENTORNO,
      PQRS_REMITENTE: 'Sitio <hola@dstunja.com>',
    });
    expect(correosEnviados[0]!.from).toBe('onboarding@resend.dev');
  });

  it('EMPLEOS_REMITENTE manda sobre el valor por defecto', async () => {
    await atenderPostulacion(peticion(campos()), {
      ...ENTORNO,
      EMPLEOS_REMITENTE: 'Empleos <empleos@dstunja.com>',
    });
    expect(correosEnviados[0]!.from).toBe('Empleos <empleos@dstunja.com>');
  });
});

// --- Los tres formatos -------------------------------------------------------

describe('formatos de la hoja de vida', () => {
  it('acepta .docx (ZIP con carpeta word/)', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.docx', bytes: DOCX }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(adjuntos()[0]!.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('acepta .doc (contenedor OLE2)', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.doc', bytes: OLE2 }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(adjuntos()[0]!.contentType).toBe('application/msword');
  });

  it('ignora el MIME que declara el navegador y mira los bytes', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.pdf', bytes: PDF_MINIMO, tipo: 'text/plain' }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(adjuntos()[0]!.contentType).toBe('application/pdf');
  });
});

/*
 * LOS NOMBRES QUE ENTREGA EL CELULAR. El selector de archivos de Android da el
 * nombre que muestra el proveedor (Drive, Descargas, Documentos de WhatsApp), y
 * muchas veces llega sin extensión o con otra. Antes eso se rechazaba con
 * «formato no permitido» sin llegar a mirar los bytes, y era por lo que los
 * candidatos no podían adjuntar su hoja de vida desde el teléfono. Manda el
 * contenido: ver src/lib/empleos/hoja-de-vida.ts.
 */
describe('nombres de archivo del celular', () => {
  it('un PDF cuyo nombre llega SIN extensión se acepta, y el adjunto sale .pdf', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'hoja de vida', bytes: PDF_MINIMO }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(adjuntos()[0]!.contentType).toBe('application/pdf');
    expect(adjuntos()[0]!.filename).toBe('hoja_de_vida.pdf');
  });

  it('un PDF con la extensión equivocada se acepta y se le corrige', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.docx', bytes: PDF_MINIMO }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(adjuntos()[0]!.contentType).toBe('application/pdf');
    expect(adjuntos()[0]!.filename).toBe('cv.pdf');
  });

  it('un DOCX cuyo nombre llega sin extensión se acepta como .docx', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'Documento', bytes: DOCX }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(adjuntos()[0]!.filename).toBe('Documento.docx');
  });

  /*
   * Confiar en el contenido no deja pasar nombres peligrosos: la extensión del
   * nombre se SUSTITUYE por la del contenido, así que lo que se adjunta nunca
   * se llama `.exe`. Y la doble extensión (`cv.exe.pdf`) sigue rechazándose
   * antes de leer un solo byte, en el test de más abajo.
   */
  it('un nombre con extensión ejecutable sale con la extensión del contenido', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.exe', bytes: PDF_MINIMO }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(adjuntos()[0]!.filename).toBe('cv.pdf');
  });
});

// --- Archivos rechazados -----------------------------------------------------

describe('hoja de vida rechazada', () => {
  it('sin archivo → 400 y ningún correo', async () => {
    const respuesta = await atenderPostulacion(peticion(campos(), null), ENTORNO);
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta)).toContain(
      'La hoja de vida es obligatoria: adjúntala en PDF, DOC o DOCX.',
    );
    expect(correosEnviados).toHaveLength(0);
  });

  it('archivo vacío → 400', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.pdf', bytes: Buffer.alloc(0) }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('obligatoria');
  });

  it('un .txt → 400 con el mensaje de formatos (PDF, DOC o DOCX)', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.txt', bytes: Buffer.from('hola') }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('PDF, DOC o DOCX');
  });

  it('una foto renombrada a .pdf → 400, y el mensaje dice que es una foto', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.pdf', bytes: png }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('es una foto, no un documento');
  });

  it('texto plano disfrazado de .pdf → 400', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.pdf', bytes: Buffer.from('MZ esto no es un pdf') }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('no reconocemos el contenido');
  });

  it('un ZIP cualquiera renombrado a .docx → 400', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.docx', bytes: ZIP_AJENO }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('el contenido no es PDF, DOC o DOCX');
  });

  it('doble extensión sospechosa → 400', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.exe.pdf', bytes: PDF_MINIMO }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('doble extensión');
  });

  it('más de 3 MB → 400 y el mensaje dice el tope', async () => {
    const pesado = Buffer.concat([PDF_MINIMO, Buffer.alloc(3 * 1024 * 1024 + 1)]);
    const respuesta = await atenderPostulacion(
      peticion(campos(), { nombre: 'cv.pdf', bytes: pesado }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('el máximo es 3 MB');
    expect(correosEnviados).toHaveLength(0);
  });
});

// --- Campos de texto ---------------------------------------------------------

describe('campos de texto', () => {
  it('devuelve TODOS los errores a la vez, sin gastar token de Turnstile', async () => {
    const respuesta = await atenderPostulacion(
      peticion(
        campos({
          nombre: 'A',
          correo: 'no-es-un-correo',
          telefono: '12',
          cargo: 'Gerente General Inventado',
          autorizacion: '',
        }),
        null,
      ),
      ENTORNO,
    );

    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta)).toEqual([
      'El nombre completo es obligatorio.',
      'El correo no tiene un formato válido.',
      'El teléfono debe tener entre 7 y 15 dígitos.',
      'El cargo no es uno de los que ofrece el formulario. Recarga la página e inténtalo de nuevo.',
      'Falta la autorización de tratamiento de datos personales.',
      'La hoja de vida es obligatoria: adjúntala en PDF, DOC o DOCX.',
    ]);
    // La validación va ANTES de Turnstile: un 400 no consume el token.
    expect(fetch).not.toHaveBeenCalled();
    expect(correosEnviados).toHaveLength(0);
  });

  it('admite la opción de hoja de vida espontánea', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos({ cargo: 'Otro / hoja de vida espontánea' })),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(correosEnviados[0]!.subject).toBe(
      'Postulación: Otro / hoja de vida espontánea – Cristian Amaya',
    );
  });

  it('la casilla marcada llega como "on" en un envío sin JavaScript y también vale', async () => {
    const respuesta = await atenderPostulacion(peticion(campos({ autorizacion: 'on' })), ENTORNO);
    expect(respuesta.estado).toBe(200);
  });

  it('un teléfono con indicativo 57 cuenta los dígitos sin el 57', async () => {
    const respuesta = await atenderPostulacion(peticion(campos({ telefono: '573106232429' })), ENTORNO);
    expect(respuesta.estado).toBe(200);
  });

  it('la experiencia es opcional pero tiene tope', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos({ experiencia: 'x'.repeat(3001) })),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('3000 caracteres');
  });

  it('quita los caracteres de control de lo escrito', async () => {
    await atenderPostulacion(peticion(campos({ nombre: 'Cris tian Amaya' })), ENTORNO);
    expect(correosEnviados[0]!.subject).toBe('Postulación: Vendedor TAT – Cristian Amaya');
  });
});

// --- Cuerpo que no es multipart ---------------------------------------------

describe('cuerpo inválido', () => {
  it('JSON en vez de multipart → 400', async () => {
    const respuesta = await atenderPostulacion(
      new Request('https://dstunja.com/api/empleos/postular', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(campos()),
      }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('multipart/form-data');
  });

  it('multipart roto → 400', async () => {
    const respuesta = await atenderPostulacion(
      new Request('https://dstunja.com/api/empleos/postular', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: 'esto no es un multipart',
      }),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(400);
    expect(errores(respuesta).join(' ')).toContain('No pudimos leer el formulario');
  });
});

// --- Antispam ----------------------------------------------------------------

describe('campo trampa', () => {
  it('si viene relleno responde 200 sin enviar nada ni tocar la red', async () => {
    const respuesta = await atenderPostulacion(
      peticion(campos({ 'sitio-web': 'https://spam.example' })),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(200);
    expect(respuesta.cuerpo).toEqual({ ok: true });
    expect(correosEnviados).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('vacío no estorba', async () => {
    const respuesta = await atenderPostulacion(peticion(campos({ 'sitio-web': '' })), ENTORNO);
    expect(respuesta.estado).toBe(200);
    expect(correosEnviados).toHaveLength(1);
  });
});

describe('límite de tasa', () => {
  /*
   * Sin Upstash el tope es 20, no 5, y la clave lleva la huella del archivo. El
   * contador en memoria no frena a nadie decidido -se reinicia en cada arranque
   * en frio y se multiplica por instancia-, asi que lo unico que puede hacer es
   * no estorbar a los candidatos de verdad, que detras de un operador movil
   * comparten IP publica de a muchos.
   */
  it('la postulación 21 con la misma hoja de vida y la misma IP → 429', async () => {
    for (let i = 0; i < 20; i += 1) {
      const respuesta = await atenderPostulacion(peticion(campos()), ENTORNO);
      expect(respuesta.estado).toBe(200);
    }
    const siguiente = await atenderPostulacion(peticion(campos()), ENTORNO);
    expect(siguiente.estado).toBe(429);
    expect(errores(siguiente).join(' ')).toContain('Espera');
    expect(correosEnviados).toHaveLength(20);
  });

  it('otra IP tiene su propio contador', async () => {
    for (let i = 0; i < 20; i += 1) await atenderPostulacion(peticion(campos()), ENTORNO);
    const otra = await atenderPostulacion(peticion(campos(), HOJA_PDF, '198.51.100.7'), ENTORNO);
    expect(otra.estado).toBe(200);
  });

  /*
   * Este es el caso que motivo la huella: veinte candidatos distintos desde la
   * misma IP de un operador movil no se pueden estorbar entre ellos. Cada hoja
   * de vida lleva su propio contador.
   */
  it('otra hoja de vida desde la misma IP tiene su propio contador', async () => {
    for (let i = 0; i < 20; i += 1) await atenderPostulacion(peticion(campos()), ENTORNO);

    const otroArchivo = {
      nombre: 'hoja de vida.pdf',
      bytes: Buffer.concat([PDF_MINIMO, Buffer.from('otro candidato', 'latin1')]),
      tipo: 'application/pdf',
    };
    const otra = await atenderPostulacion(peticion(campos(), otroArchivo), ENTORNO);
    expect(otra.estado).toBe(200);
  });
});

/*
 * POSTULACIONES SIN VERIFICAR
 *
 * Cuando el navegador del candidato no consigue resolver el reto de Cloudflare
 * -un WebView de WhatsApp, un bloqueador, un telefono viejo-, el formulario
 * manda la postulacion igual, sin token y con la marca `sin_verificar`. Es un
 * intercambio consciente: se acepta porque perder a un candidato real es peor
 * que revisar un correo de mas, y a cambio entra por un limite mucho mas
 * estrecho y sale marcada en el asunto.
 */
describe('postulaciones sin verificar', () => {
  function sinVerificar(extra: Record<string, string> = {}) {
    return campos({ turnstileToken: '', sin_verificar: 'si', ...extra });
  }

  it('sin token y con la marca → 200 y el correo sale', async () => {
    const respuesta = await atenderPostulacion(peticion(sinVerificar()), ENTORNO);
    expect(respuesta.estado).toBe(200);
    expect(correosEnviados).toHaveLength(1);
  });

  it('el asunto lleva [SIN VERIFICAR] delante', async () => {
    await atenderPostulacion(peticion(sinVerificar()), ENTORNO);
    expect(correosEnviados[0]!.subject).toBe(
      '[SIN VERIFICAR] Postulación: Vendedor TAT – Cristian Amaya',
    );
  });

  it('el cuerpo explica por qué no se verificó', async () => {
    await atenderPostulacion(peticion(sinVerificar()), ENTORNO);
    expect(String(correosEnviados[0]!.text)).toContain('no pasó la verificación antirrobots');
    expect(String(correosEnviados[0]!.html)).toContain('no pasó la verificación antirrobots');
  });

  it('la hoja de vida sigue yendo adjunta', async () => {
    await atenderPostulacion(peticion(sinVerificar()), ENTORNO);
    expect(adjuntos()).toHaveLength(1);
    expect(adjuntos()[0]!.filename).toBe('hoja_de_vida.pdf');
  });

  /*
   * La marca no es una puerta trasera: si viene un token, se verifica. Si no
   * fuera asi, a un robot le bastaria con mandar la marca junto a cualquier
   * token para elegir por que puerta entra.
   */
  it('con token presente la marca se ignora y el token se verifica', async () => {
    turnstileResponde(false);
    const respuesta = await atenderPostulacion(
      peticion(campos({ sin_verificar: 'si', turnstileToken: 'token-invalido' })),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(403);
    expect(correosEnviados).toHaveLength(0);
  });

  it('sin token y SIN la marca sigue siendo un 403', async () => {
    turnstileResponde(false);
    const respuesta = await atenderPostulacion(
      peticion(campos({ turnstileToken: '' })),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(403);
  });

  /* El limite estrecho es la unica barrera real que queda en este camino. */
  it('la cuarta sin verificar desde la misma IP y hoja de vida → 429', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await atenderPostulacion(peticion(sinVerificar()), ENTORNO)).estado).toBe(200);
    }
    const cuarta = await atenderPostulacion(peticion(sinVerificar()), ENTORNO);
    expect(cuarta.estado).toBe(429);
    expect(correosEnviados).toHaveLength(3);
  });

  /*
   * El limite de las verificadas es otro y mucho mas holgado: agotar el de las
   * sin verificar no puede dejar fuera a quien si pasa el reto.
   */
  it('agotar el límite sin verificar no bloquea a quien sí verifica', async () => {
    for (let i = 0; i < 4; i += 1) await atenderPostulacion(peticion(sinVerificar()), ENTORNO);
    const verificada = await atenderPostulacion(peticion(campos()), ENTORNO);
    expect(verificada.estado).toBe(200);
  });

  it('una marca que no es «si» no cuenta: se exige el token como siempre', async () => {
    turnstileResponde(false);
    const respuesta = await atenderPostulacion(
      peticion(campos({ turnstileToken: '', sin_verificar: 'quizás' })),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(403);
  });
});

describe('Turnstile', () => {
  it('token rechazado → 403 y ningún correo', async () => {
    turnstileResponde(false);
    const respuesta = await atenderPostulacion(peticion(campos()), ENTORNO);
    expect(respuesta.estado).toBe(403);
    expect(correosEnviados).toHaveLength(0);
  });

  it('sin TURNSTILE_SECRET falla cerrado: 403', async () => {
    const respuesta = await atenderPostulacion(peticion(campos()), {
      RESEND_API_KEY: 're_prueba',
    });
    expect(respuesta.estado).toBe(403);
    expect(correosEnviados).toHaveLength(0);
  });

  it('sin token → 403 sin llamar a Cloudflare', async () => {
    const respuesta = await atenderPostulacion(peticion(campos({ turnstileToken: '' })), ENTORNO);
    expect(respuesta.estado).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// --- Fallos del correo -------------------------------------------------------

describe('cuando el correo no sale', () => {
  it('Resend devuelve error → 500 con mensaje genérico, sin filtrar el motivo', async () => {
    respuestaResend = { data: null, error: { message: 'Domain not verified: dstunja.com' } };
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const respuesta = await atenderPostulacion(peticion(campos()), ENTORNO, SIN_ESPERA);

    // Sin BLOB_READ_WRITE_TOKEN no hay donde guardar la hoja de vida: este es el
    // unico camino que todavia pierde una postulacion.
    expect(respuesta.estado).toBe(500);
    expect(errores(respuesta).join(' ')).toContain('No pudimos enviar tu postulación');
    expect(JSON.stringify(respuesta.cuerpo)).not.toContain('Domain not verified');
    expect(silencio).toHaveBeenCalled();
  });

  /*
   * El plan gratuito de Resend responde 429 cuando llegan varias postulaciones
   * seguidas, y ese error cede esperando un segundo. Antes el primer fallo se
   * daba por definitivo y la postulacion se perdia.
   */
  it('un fallo de correo se reintenta tres veces', async () => {
    respuestaResend = { data: null, error: { message: 'Too many requests' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await atenderPostulacion(peticion(campos()), ENTORNO, SIN_ESPERA);

    expect(correosEnviados).toHaveLength(3);
  });

  it('si el segundo intento sale bien, la postulación se da por enviada', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    colaResend.push({ data: null, error: { message: 'Too many requests' } });

    const respuesta = await atenderPostulacion(peticion(campos()), ENTORNO, SIN_ESPERA);

    expect(respuesta.estado).toBe(200);
    expect(correosEnviados).toHaveLength(2);
  });

  it('sin RESEND_API_KEY → 500 sin gastar tres intentos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const respuesta = await atenderPostulacion(
      peticion(campos()),
      { TURNSTILE_SECRET: 'secreto-de-prueba' },
      SIN_ESPERA,
    );
    expect(respuesta.estado).toBe(500);
    expect(correosEnviados).toHaveLength(0);
  });
});
