/**
 * Qué falló en el navegador cuando una postulación no llegó a salir.
 *
 * POR QUÉ EXISTE. El 30 de octubre de 2026 un candidato vio «No pudimos
 * conectar con el servidor» (código E-RED) desde el celular, y en los registros
 * de Vercel NO HABÍA NADA: ni la petición, ni un error, ni un rastro. Es lo
 * propio de ese error —se produce cuando el `fetch` no llega a completarse—,
 * pero deja el problema invisible desde este lado: no se sabe si el envío murió
 * subiendo el archivo, si lo cortó la red del celular o si lo abortó una
 * excepción de la página. Sin eso, arreglarlo es adivinar.
 *
 * Este endpoint es el testigo que faltaba: cuando el formulario se rinde, manda
 * aquí unos pocos datos técnicos y el servidor los escribe en el registro. Con
 * eso, el siguiente fallo se lee en `vercel logs` en vez de reconstruirse por
 * conjeturas.
 *
 * QUÉ NO VIAJA: ningún dato de la persona. No el nombre, ni el correo, ni el
 * teléfono, ni el nombre del archivo, ni su contenido. Solo el paso que falló,
 * el tipo de excepción, el peso del archivo en bytes, cuántos intentos se
 * hicieron, el tipo de red que declara el navegador y el `User-Agent` —que es
 * lo mismo que Vercel ya apunta en su registro de accesos de cada visita—.
 *
 * ADEMÁS ES UNA PRUEBA DE VIDA. El aviso es minúsculo (menos de 1 KB), así que
 * si llega significa que la red del candidato SÍ daba para hablar con el
 * servidor, y entonces lo que falló fue subir los megas de la hoja de vida. Si
 * no llega nada, el problema es anterior. Las dos respuestas son útiles.
 */
import * as almacen from '../pqrs/almacen';
import { blobConfigurado } from '../pqrs/config';
import { fechaColombia, sufijoAleatorio } from '../pqrs/radicado';
import { PREFIJO_EMPLEOS } from './almacen';
import { limitar, type Veredicto } from '../pqrs/limite-tasa';
import { ipDePeticion } from '../pqrs/solicitud';
import type { Entorno } from './config';

/** Tope del cuerpo. Un aviso de diagnóstico no tiene por qué pesar más. */
export const MAX_BYTES_DIAGNOSTICO = 2048;

/** Cuántos avisos se aceptan por IP y en cuánto tiempo. */
export const LIMITE_DIAGNOSTICO = { maximo: 12, ventanaSegundos: 600 };

/** Pasos del formulario que pueden fallar. Lista cerrada: llega del navegador. */
const PASOS = new Set([
  'red',
  'sin-api',
  /** 413: el cuerpo pasaba de 4,5 MB y Vercel lo cortó antes de la función. */
  'grande',
  /** 502 o 504 de la plataforma: la función falló o tardó demasiado. */
  'servidor',
  'lectura',
  'respuesta',
  'inesperado',
]);

/**
 * Recorta y deja solo caracteres imprimibles.
 *
 * Los controles fuera: esto se escribe en el registro de Vercel, y un salto de
 * línea metido a mano partiría la línea en dos entradas falsas.
 */
function limpio(valor: unknown, tope: number): string {
  if (typeof valor !== 'string') return '';
  const sinControles = Array.from(valor, (caracter) => {
    const codigo = caracter.charCodeAt(0);
    return codigo < 32 || codigo === 127 ? ' ' : caracter;
  }).join('');
  return sinControles.trim().slice(0, tope);
}

function entero(valor: unknown, tope: number): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), tope);
}

export interface Diagnostico {
  paso: string;
  error: string;
  mensaje: string;
  bytes: number;
  intentos: number;
  red: string;
  incrustado: string;
  ua: string;
}

/** Deja el aviso en la forma exacta que se escribe en el registro. */
export function sanearDiagnostico(bruto: unknown): Diagnostico {
  const d = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>;
  const paso = limpio(d.paso, 20);
  return {
    paso: PASOS.has(paso) ? paso : 'inesperado',
    error: limpio(d.error, 40),
    mensaje: limpio(d.mensaje, 200),
    bytes: entero(d.bytes, 50 * 1024 * 1024),
    intentos: entero(d.intentos, 99),
    red: limpio(d.red, 20),
    incrustado: limpio(d.incrustado, 20),
    ua: limpio(d.ua, 200),
  };
}

/**
 * Carpeta de los avisos dentro del store, separada de las postulaciones.
 *
 * NO cuelga de `empleos/<id>/`: ahí viven hojas de vida con datos personales, y
 * esto no lleva ninguno. Mezclarlos obligaría a tratar las dos cosas con el
 * mismo cuidado y el mismo plazo de borrado, y no son la misma cosa.
 */
export const PREFIJO_DIAGNOSTICO = `${PREFIJO_EMPLEOS}diagnostico/`;

/**
 * Una carpeta por día, un archivo por aviso.
 *
 * La fecha va delante porque así la pregunta que de verdad se hace —«¿qué
 * falló ayer?»— se responde listando un prefijo, sin descargar nada.
 */
export function rutaDiagnostico(ahora: Date = new Date()): string {
  const hora = ahora.toISOString().slice(11, 19).replace(/:/g, '');
  return `${PREFIJO_DIAGNOSTICO}${fechaColombia(ahora)}/${hora}-${sufijoAleatorio()}.json`;
}

export interface RespuestaDiagnostico {
  estado: number;
  /** La línea que se escribió, o null si no se escribió ninguna. */
  linea: string | null;
  /**
   * Ruta del aviso en el Blob, o null si no se guardó (sin Blob configurado, o
   * porque la escritura falló). Ver `atenderDiagnostico`.
   */
  guardado?: string | null;
  veredicto?: Veredicto;
}

/**
 * Atiende el aviso. Nunca falla hacia el navegador: pase lo que pase responde
 * `204`, porque un diagnóstico que devuelve un error solo añade ruido a una
 * página que ya está enseñando un fallo.
 */
export async function atenderDiagnostico(
  peticion: Request,
  env: Entorno,
): Promise<RespuestaDiagnostico> {
  let texto: string;
  try {
    texto = await peticion.text();
  } catch {
    return { estado: 204, linea: null };
  }

  if (texto.length === 0 || texto.length > MAX_BYTES_DIAGNOSTICO) {
    return { estado: 204, linea: null };
  }

  const veredicto = await limitar(
    ipDePeticion(peticion.headers),
    { ...LIMITE_DIAGNOSTICO, prefijo: 'empleos:diagnostico' },
    env,
  );
  if (!veredicto.ok) return { estado: 204, linea: null, veredicto };

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { estado: 204, linea: null, veredicto };
  }

  const aviso = sanearDiagnostico(bruto);
  const linea = `[empleos/diagnostico] ${JSON.stringify(aviso)}`;
  console.warn(linea);

  /*
   * Y ADEMÁS AL BLOB, porque el registro de Vercel no sirve para esto.
   *
   * El plan Hobby retiene los registros de ejecución alrededor de UNA HORA:
   * `vercel logs --since 24h` ya responde «outside the available retention».
   * Un candidato cuenta que no pudo postular al día siguiente, o el lunes, y
   * para entonces la línea de `console.warn` se borró. Esa es la razón por la
   * que este fallo se persiguió tres veces a ciegas, así que el aviso se
   * escribe donde sobrevive.
   *
   * NUNCA ESTORBA: si no hay Blob configurado, o si la escritura falla, el
   * `console.warn` de arriba ya salió y la respuesta sigue siendo 204. Un
   * diagnóstico que rompiera la página que está enseñando un fallo sería peor
   * que no tener diagnóstico.
   */
  if (!blobConfigurado(env)) return { estado: 204, linea, guardado: null, veredicto };
  // Se calcula UNA vez: lleva hora y sufijo al azar, así que llamarla dos
  // veces daría dos rutas distintas y la devuelta no sería la escrita.
  const destino = rutaDiagnostico();
  try {
    await almacen.guardarJson(destino, { ...aviso, cuando: new Date().toISOString() }, env);
    return { estado: 204, linea, guardado: destino, veredicto };
  } catch (fallo) {
    console.warn('[empleos/diagnostico] no se pudo guardar el aviso:', fallo);
    return { estado: 204, linea, guardado: null, veredicto };
  }
}
