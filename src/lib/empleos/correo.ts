/**
 * Correo de una postulación, con Resend.
 *
 * Sale UNO, a Talento Humano (`EMPLEOS_DESTINO`), con los datos en el cuerpo y
 * la hoja de vida ADJUNTA. Aquí sí se adjunta, al contrario que en PQRS, donde
 * los soportes van enlazados: la hoja de vida es justo lo que Talento Humano
 * tiene que abrir, y es lo que el candidato vino a entregar.
 *
 * El `replyTo` es el correo del candidato, para responderle desde la bandeja
 * sin copiar direcciones. El teléfono va como enlace `tel:` y el correo como
 * `mailto:`, para contestar desde el celular con un toque.
 *
 * No hay correo de confirmación al candidato: la confirmación es la pantalla.
 * Sin número de radicado ni plazo legal, un segundo correo solo llenaría su
 * bandeja.
 *
 * SE REINTENTA CON ESPERA CRECIENTE. Resend, en el plan gratuito, responde 429
 * cuando llegan varias postulaciones seguidas, y un 429 es justo el fallo que se
 * arregla esperando un segundo. Antes el primer fallo se daba por definitivo y la
 * postulación se perdía; ahora `enviarConReintentos` prueba tres veces con una
 * pausa que crece entre intentos.
 *
 * DOS FORMAS DEL MISMO CORREO. La normal lleva la hoja de vida ADJUNTA. La otra,
 * que se usa cuando el adjunto es lo más probable que esté haciendo fallar el
 * envío, va sin adjunto y con un ENLACE firmado al archivo ya guardado en el
 * Blob. Talento Humano recibe el mismo correo en los dos casos; lo que cambia es
 * de dónde saca el documento.
 *
 * EL ASUNTO AVISA SI NO SE VERIFICÓ. Una postulación que entró sin pasar el reto
 * de Turnstile (porque el navegador del candidato no pudo resolverlo) llega con
 * «[SIN VERIFICAR]» delante del asunto. No significa que sea falsa: significa
 * que las únicas barreras que la filtraron fueron la validación de los datos y
 * la del archivo, y que conviene leerla con algo más de criterio.
 */
import { Resend } from 'resend';
import { correoDestinoEmpleos, correoRemitenteEmpleos, type Entorno } from './config';
import type { PostulacionValidada } from './postulacion';

/** Escapa lo que escribió la persona antes de meterlo en el HTML del correo. */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "SI"/"NO" del filtro se leen como Sí / No; lo demás, tal cual. */
function legible(respuesta: string): string {
  if (respuesta === 'SI') return 'Sí';
  if (respuesta === 'NO') return 'No';
  return respuesta;
}

function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Teléfono en formato E.164 para el enlace `tel:`.
 *
 * Los candidatos escriben celulares colombianos de diez dígitos, con o sin el
 * 57 delante y con espacios o guiones. Se dejan solo los dígitos y se antepone
 * el indicativo si no lo traía; si ya viene con 57 y el largo cuadra, se deja.
 */
export function telefonoParaEnlace(telefono: string): string {
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.startsWith('57') && digitos.length >= 12) return `+${digitos}`;
  return `+57${digitos}`;
}

/**
 * «Postulación: Vendedor TAT – Cristian Amaya», o con «[SIN VERIFICAR]» delante
 * si la postulación entró sin pasar el reto de Turnstile.
 *
 * El aviso va al PRINCIPIO a propósito: es lo que se lee en la lista de la
 * bandeja sin abrir el correo, que es donde Talento Humano decide en qué orden
 * los mira.
 */
export function asuntoPostulacion(cargo: string, nombre: string, sinVerificar = false): string {
  const base = `Postulación: ${cargo} – ${nombre}`;
  return sinVerificar ? `[SIN VERIFICAR] ${base}` : base;
}

const ESTILO_CUERPO =
  'font-family:Segoe UI,system-ui,sans-serif;color:#263238;line-height:1.6;font-size:15px';
const ESTILO_ETIQUETA = 'color:#5f6b73;font-size:13px;text-transform:uppercase;letter-spacing:.06em';
const ESTILO_ENLACE = 'color:#1565c0;text-decoration:underline';

/** Una fila de la tabla. `valorHtml` ya viene escapado por quien lo construye. */
function fila(etiqueta: string, valorHtml: string): string {
  if (!valorHtml) return '';
  return `<tr>
    <td style="padding:6px 16px 6px 0;vertical-align:top;white-space:nowrap;${ESTILO_ETIQUETA}">${escapar(etiqueta)}</td>
    <td style="padding:6px 0;vertical-align:top">${valorHtml}</td>
  </tr>`;
}

/** Lo que cambia entre el correo normal y el de respaldo. */
export interface OpcionesCorreo {
  /**
   * Manda el correo SIN la hoja de vida adjunta.
   *
   * Se usa en el último intento, cuando el adjunto es lo más probable que esté
   * haciendo fallar el envío: un correo de 4 MB choca con límites que uno de dos
   * kilobytes no roza. Pide `enlace`, o Talento Humano se quedaría sin manera de
   * llegar al archivo.
   */
  sinAdjunto?: boolean;
  /** Enlace firmado a la hoja de vida ya guardada en el Blob. */
  enlace?: string;
  /** Identificador de la postulación guardada (`EMP-…`), para poder buscarla. */
  id?: string;
  /** Reloj de un intento, en ms. Solo lo cambian las pruebas. */
  esperaMs?: number;
}

/** Lo que devuelve `resend.emails.send`, en lo que de él se usa. */
interface SalidaResend {
  data?: { id?: string } | null;
  error?: { message: string } | null;
}

/**
 * Pone un reloj a una promesa que no sabe pararse sola.
 *
 * No cancela la petición —el SDK de Resend no lo permite—, solo deja de
 * esperarla. Ver `ESPERA_CORREO_MS` para el porqué y el riesgo aceptado.
 */
function conReloj(promesa: Promise<SalidaResend>, ms: number): Promise<SalidaResend> {
  return Promise.race([
    promesa,
    new Promise<SalidaResend>((listo) =>
      setTimeout(() => listo({ error: { message: `Resend no respondió en ${ms} ms.` } }), ms),
    ),
  ]);
}

/** Aviso de cabecera cuando la postulación no pasó por el reto de Turnstile. */
function avisoSinVerificar(datos: PostulacionValidada): string {
  if (!datos.sinVerificar) return '';
  return `<p style="margin:0 0 16px;padding:10px 14px;border-left:4px solid #F5A623;background:#fff8ec;font-size:14px">
    <strong>Esta postulación no pasó la verificación antirrobots.</strong>
    El navegador del candidato no pudo resolver el reto de Cloudflare, así que se
    aceptó igual para no dejarlo sin postular. Sí se comprobaron los datos del
    formulario y que la hoja de vida es un documento real.
  </p>`;
}

/** Bloque de la hoja de vida: adjunta, o enlazada si no se pudo adjuntar. */
function bloqueHojaDeVida(datos: PostulacionValidada, opciones: OpcionesCorreo): string {
  const { hojaDeVida } = datos;
  const peso = `<span style="color:#5f6b73">(${tamanoLegible(hojaDeVida.tamano)})</span>`;

  if (!opciones.sinAdjunto) {
    return `<p style="margin:0">
      Va adjunta a este correo: <strong>${escapar(hojaDeVida.nombreSeguro)}</strong> ${peso}.
    </p>`;
  }

  const enlace = opciones.enlace
    ? `<p style="margin:8px 0 0">
        <a href="${escapar(opciones.enlace)}" style="${ESTILO_ENLACE}">Descargar ${escapar(hojaDeVida.nombreSeguro)}</a>
        ${peso}. El enlace caduca en siete días.
      </p>`
    : '';

  const conId = opciones.id
    ? ` con el identificador <strong>${escapar(opciones.id)}</strong>`
    : '';

  return `<p style="margin:0">
      <strong>No se pudo adjuntar a este correo</strong>, así que quedó guardada en el
      almacenamiento del proyecto${conId}.
    </p>${enlace}`;
}

function cuerpoHtml(datos: PostulacionValidada, fecha: string, opciones: OpcionesCorreo): string {
  const telefonoHref = telefonoParaEnlace(datos.telefono);

  const experiencia = datos.experiencia
    ? `<h3 style="margin:24px 0 8px;color:#0d2c84;font-size:16px">Sobre su experiencia</h3>
    <p style="margin:0;white-space:pre-wrap">${escapar(datos.experiencia)}</p>`
    : `<p style="margin:24px 0 0;color:#5f6b73">No escribió nada sobre su experiencia: está todo en la hoja de vida.</p>`;

  // Las preguntas de filtro de la vacante (Control360), si las respondió. Van
  // tal cual: el CUMPLE / NO CUMPLE lo calcula Control360 con sus reglas.
  const respuestas = datos.respuestas?.length
    ? `<h3 style="margin:24px 0 8px;color:#0d2c84;font-size:16px">Preguntas de la vacante</h3>
    <table style="border-collapse:collapse;width:100%">
      ${datos.respuestas.map((r) => fila(r.texto_pregunta, escapar(legible(r.respuesta)))).join('')}
    </table>`
    : '';

  return `<div style="${ESTILO_CUERPO}">
    <h2 style="margin:0 0 4px;color:#0d2c84">Nueva postulación</h2>
    <p style="margin:0 0 20px;font-size:20px;font-weight:600">${escapar(datos.cargo)}</p>
    ${avisoSinVerificar(datos)}
    <table style="border-collapse:collapse;width:100%">
      ${fila('Nombre', escapar(datos.nombre))}
      ${fila('Cargo', escapar(datos.cargo))}
      ${fila(
        'Teléfono',
        `<a href="tel:${escapar(telefonoHref)}" style="${ESTILO_ENLACE}">${escapar(datos.telefono)}</a>`,
      )}
      ${fila('Municipio', escapar(datos.municipio))}
      ${fila(
        'Correo',
        `<a href="mailto:${escapar(datos.correo)}" style="${ESTILO_ENLACE}">${escapar(datos.correo)}</a>`,
      )}
      ${fila('Fecha', escapar(fecha))}
      ${opciones.id ? fila('Identificador', escapar(opciones.id)) : ''}
    </table>
    ${experiencia}
    ${respuestas}
    <h3 style="margin:24px 0 8px;color:#0d2c84;font-size:16px">Hoja de vida</h3>
    ${bloqueHojaDeVida(datos, opciones)}
    <p style="margin:24px 0 0;color:#5f6b73;font-size:13px">
      Autorización de tratamiento de datos para selección de personal (Ley 1581 de 2012): sí.
      Responder a este correo le escribe directamente al candidato.
    </p>
  </div>`;
}

function cuerpoTexto(datos: PostulacionValidada, fecha: string, opciones: OpcionesCorreo): string {
  const { hojaDeVida } = datos;
  const lineas: string[] = [`Nueva postulación: ${datos.cargo}`];

  if (datos.sinVerificar) {
    lineas.push(
      '',
      'AVISO: esta postulación no pasó la verificación antirrobots. El navegador',
      'del candidato no pudo resolver el reto de Cloudflare y se aceptó igual para',
      'no dejarlo sin postular. Los datos del formulario y la hoja de vida sí se',
      'comprobaron.',
    );
  }

  lineas.push(
    '',
    `Fecha: ${fecha}`,
    `Nombre: ${datos.nombre}`,
    `Cargo: ${datos.cargo}`,
    `Teléfono: ${datos.telefono}`,
    `Municipio: ${datos.municipio}`,
    `Correo: ${datos.correo}`,
  );
  if (opciones.id) lineas.push(`Identificador: ${opciones.id}`);

  lineas.push(
    '',
    'Sobre su experiencia:',
    datos.experiencia || '(no escribió nada: está todo en la hoja de vida)',
    '',
  );

  if (datos.respuestas?.length) {
    lineas.push('Preguntas de la vacante:');
    for (const r of datos.respuestas) lineas.push(`- ${r.texto_pregunta} ${legible(r.respuesta)}`);
    lineas.push('');
  }

  if (opciones.sinAdjunto) {
    lineas.push(
      `Hoja de vida: ${hojaDeVida.nombreSeguro} (${tamanoLegible(hojaDeVida.tamano)})`,
      'NO se pudo adjuntar a este correo; quedó guardada en el almacenamiento del proyecto.',
    );
    if (opciones.enlace) lineas.push(`Descargarla (caduca en 7 días): ${opciones.enlace}`);
  } else {
    lineas.push(
      `Hoja de vida adjunta: ${hojaDeVida.nombreSeguro} (${tamanoLegible(hojaDeVida.tamano)})`,
    );
  }

  lineas.push(
    '',
    'Autorización de tratamiento de datos para selección de personal (Ley 1581 de 2012): sí.',
    'Responder a este correo le escribe directamente al candidato.',
  );
  return lineas.join('\n');
}

/** Fecha en hora de Colombia, legible: «7 de septiembre de 2026, 9:15». */
function fechaLegible(fecha: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(fecha);
}

export interface ResultadoCorreo {
  ok: boolean;
  error?: string;
  /** Cuántos intentos se gastaron. Va al registro, para ver si Resend flaquea. */
  intentos?: number;
  /**
   * Identificador que devuelve Resend cuando ACEPTA el envío (un UUID).
   *
   * OJO CON LO QUE SIGNIFICA: que Resend aceptó la petición, NO que el correo
   * llegara a ninguna bandeja. La entrega ocurre después, y puede acabar en
   * `delivered`, `bounced`, `complained` o `suppressed` sin que esta función se
   * entere de nada, porque la respuesta del envío se da antes.
   *
   * Por eso se devuelve y se escribe en el registro: es el ÚNICO dato con el
   * que un envío concreto se puede buscar luego en Resend (`GET /emails/{id}`
   * devuelve `last_event`). Sin él, una postulación registrada como «enviada»
   * que nadie recibió no se puede cruzar con ninguna fila del panel de Resend.
   */
  id?: string;
}

/** UN intento de envío. Quien quiera reintentos usa `enviarConReintentos`. */
export async function enviarCorreoPostulacion(
  datos: PostulacionValidada,
  env: Entorno,
  ahora: Date = new Date(),
  opciones: OpcionesCorreo = {},
): Promise<ResultadoCorreo> {
  const clave = env.RESEND_API_KEY;
  if (!clave) return { ok: false, error: FALTA_CLAVE };

  const resend = new Resend(clave);
  const fecha = fechaLegible(ahora);

  try {
    const { data, error } = await conReloj(
      resend.emails.send({
      from: correoRemitenteEmpleos(env),
      to: correoDestinoEmpleos(env),
      replyTo: datos.correo,
      subject: asuntoPostulacion(datos.cargo, datos.nombre, datos.sinVerificar),
      html: cuerpoHtml(datos, fecha, opciones),
      text: cuerpoTexto(datos, fecha, opciones),
      attachments: opciones.sinAdjunto
        ? undefined
        : [
            {
              filename: datos.hojaDeVida.nombreSeguro,
              content: Buffer.from(datos.hojaDeVida.bytes),
              contentType: datos.hojaDeVida.mime,
            },
          ],
      }),
      opciones.esperaMs ?? ESPERA_CORREO_MS,
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (fallo) {
    return { ok: false, error: (fallo as Error).message };
  }
}

/** Error que no se arregla reintentando: la clave no está puesta. */
export const FALTA_CLAVE = 'Falta RESEND_API_KEY.';

/**
 * Pausas entre intentos, en milisegundos.
 *
 * Tres intentos y dos esperas: dos segundos de reloj en el peor caso. El tope lo
 * pone la duración máxima de una función de Vercel, que también tiene que dar
 * para leer 4 MB de multipart y para escribir en el Blob si hace falta. Crecen
 * porque el fallo que se arregla esperando es el 429 del plan gratuito de
 * Resend, y ese cede en el orden del segundo, no del minuto.
 */
const PAUSAS_MS = [500, 1500];

/** Cuántas veces se intenta en total. */
export const INTENTOS_CORREO = PAUSAS_MS.length + 1;

/**
 * Reloj de UN intento. Mismo valor que el de Control360 (./control360.ts).
 *
 * POR QUÉ HACE FALTA. El SDK de Resend no acepta un timeout, así que una
 * llamada colgada se quedaba colgada: los únicos segundos que la cortaban eran
 * los de la función de Vercel. Y cuando los agota, la función responde 504 y
 * NADA de lo que viene después llega a ejecutarse —en particular `ponerASalvo`
 * (./postular.ts), que es quien guarda la hoja de vida en el Blob cuando el
 * correo no sale—. Es decir: Resend lento costaba la postulación entera, que es
 * justo lo que esa red de seguridad existe para evitar.
 *
 * EL RIESGO ACEPTADO. Si el correo sí salió y lo que se perdió fue su
 * respuesta, el reintento manda un segundo correo: Resend no tiene llave de
 * idempotencia. Talento Humano vería la misma hoja de vida repetida, y es el
 * intercambio que este archivo ya tenía escrito en su cabecera: una postulación
 * duplicada se borra, una perdida no se recupera.
 *
 * Tres intentos de 8 s más las dos pausas son 26 s en el peor caso, y la función
 * tiene 60 (`maxDuration` en astro.config.mjs): queda sitio para el respaldo.
 */
export const ESPERA_CORREO_MS = 8000;

function esperar(ms: number): Promise<void> {
  return new Promise((listo) => setTimeout(listo, ms));
}

/**
 * Manda el correo reintentando hasta `INTENTOS_CORREO` veces.
 *
 * Solo se reintenta lo que puede cambiar de respuesta: si falta la clave de
 * Resend se sale al primer intento, porque insistir tres veces sobre una clave
 * que no existe es gastar el tiempo de la función para dar el mismo error más
 * tarde.
 *
 * @param dormir  inyectable para que las pruebas no esperen de verdad.
 */
export async function enviarConReintentos(
  datos: PostulacionValidada,
  env: Entorno,
  opciones: OpcionesCorreo = {},
  ahora: Date = new Date(),
  dormir: (ms: number) => Promise<void> = esperar,
): Promise<ResultadoCorreo> {
  let ultimo: ResultadoCorreo = { ok: false, error: 'No se intentó ningún envío.' };

  for (let intento = 1; intento <= INTENTOS_CORREO; intento += 1) {
    ultimo = await enviarCorreoPostulacion(datos, env, ahora, opciones);
    if (ultimo.ok) return { ...ultimo, intentos: intento };
    if (ultimo.error === FALTA_CLAVE) return { ...ultimo, intentos: intento };

    const pausa = PAUSAS_MS[intento - 1];
    if (pausa === undefined) return { ...ultimo, intentos: intento };

    console.warn(`[empleos/correo] intento ${intento} falló (${ultimo.error}); reintentando`);
    await dormir(pausa);
  }

  return { ...ultimo, intentos: INTENTOS_CORREO };
}
