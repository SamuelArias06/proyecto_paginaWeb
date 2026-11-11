/**
 * De dónde salen las vacantes: Control360 primero, la lista del repositorio después.
 *
 * Talento Humano publica y cierra las vacantes desde Control360
 * (Postulaciones › Vacantes), y Control360 las expone en
 * GET /api/talento/vacantes/dst con la MISMA forma que este sitio ya publicaba
 * en /api/empleos/vacantes.json: { version: 1, vacantes: [{ slug, cargo,
 * ciudad, tipo, resumen, descripcion[], requisitos[], funciones[] }] }.
 *
 * CUÁNDO SE LEE. En Vercel, /empleos/, cada /empleos/<slug>/, el <select> del
 * formulario y el JSON público se sirven con ISR (src/lib/empleos/isr.mjs):
 * quedan en caché y se vuelven a generar —leyendo Control360 en ese momento—
 * cuando Control360 avisa por POST /api/empleos/revalidar (en segundos) o, si
 * el aviso se pierde, cuando la copia cumple 5 minutos. En el espejo de GitHub
 * Pages se siguen leyendo una sola vez, en el build. La función de postular
 * también la llama, para validar el cargo contra la misma lista.
 *
 * LECTURA FRESCA. La ruta de Control360 tiene caché de CDN de 5 minutos para
 * aguantar a los navegadores; si el servidor de este sitio la leyera igual, una
 * revalidación de ISR podría traer la versión vieja. Por eso, cuando existe el
 * secreto compartido `EMPLEOS_WEBHOOK_SECRET`, el servidor pide `?fresco=1` con
 * `Authorization: Bearer <secreto>` y Control360 responde sin caché, directo de
 * la base. Sin el secreto se lee la URL normal (con su caché de 5 minutos). El
 * secreto nunca sale del servidor.
 *
 * CERO VACANTES ES UNA RESPUESTA. Si Control360 responde bien y la lista viene
 * vacía (RRHH cerró todas), la página dice que no hay vacantes abiertas; no
 * resucita la lista fija del repositorio.
 *
 * SI FALLA, LA PÁGINA NO SE QUEDA SIN VACANTES. Sin `C360_VACANTES_URL`, con la
 * URL caída, con un JSON que no tiene la forma esperada o con una lista en la
 * que ninguna entrada es válida, se usa `src/data/vacantes.ts` tal cual estaba.
 * Nunca se lanza: ni el build ni la página se caen por Control360.
 *
 * QUÉ SE ENRIQUECE. Desde 10·09 Control360 también manda el flyer (`imagen`,
 * como URL pública de su bucket), el `salario` (solo si RRHH lo marcó para
 * mostrar), la `jornada`, lo que ofrece la empresa, las habilidades deseables
 * y el WhatsApp extra. Lo que venga de Control360 manda; SOLO lo que falte se
 * hereda de `src/data/vacantes.ts` cuando el `slug` coincide con una de la
 * lista estática.
 *
 * LAS ZONAS SON LA EXCEPCIÓN QUE CONFIRMA LA REGLA. Control360 guarda UNA sede
 * por vacante, así que una convocatoria abierta en varios municipios no cabe en
 * su modelo y las `zonas` viven solo aquí (empleos/zonas.ts). Se heredan
 * mientras la sede que manda Control360 sea una de ellas; si la vacante se mudó
 * a otro municipio, las zonas se descartan y manda Control360, como siempre. Así la lista estática es respaldo puro: el día que todas las
 * vacantes tengan su flyer en Control360, aquí no queda nada que mantener.
 */
import { vacantes as vacantesEstaticas, type Vacante } from '../../data/vacantes';
import type { Entorno } from '../pqrs/config';
import { leerPreguntas } from './preguntas';
import { sedeEntreZonas } from './zonas';

/** Variable de entorno con la URL pública de Control360. */
export const VARIABLE_URL = 'C360_VACANTES_URL';

/** Secreto compartido con Control360 (el mismo del webhook de revalidación). */
export const VARIABLE_SECRETO = 'EMPLEOS_WEBHOOK_SECRET';

/** Cuánto se espera a Control360 antes de usar la lista estática. */
export const TIEMPO_MAXIMO_MS = 10_000;

/**
 * En una función (ISR o postular), cuánto se reutiliza una lectura. Solo para
 * que un mismo render (página + formulario) y una ráfaga de revalidaciones no
 * pidan lo mismo varias veces; más largo haría que una revalidación sirviera
 * datos viejos guardados en la memoria del proceso.
 */
export const MEMORIA_EN_FUNCION_MS = 2_000;

export type FuenteVacantes = 'control360' | 'estatica';

export interface ResultadoVacantes {
  fuente: FuenteVacantes;
  vacantes: Vacante[];
  /** Por qué se cayó a la lista estática (solo cuando `fuente` es `estatica`). */
  motivo?: string;
}

/** Mismo alfabeto que exige Control360 y que usa la URL /empleos/<slug>/. */
const FORMA_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const textos = (x: unknown): string[] =>
  Array.isArray(x) ? x.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
const texto = (x: unknown): string => String(x ?? '').trim();

/** "2026-10-10" o "2026-10-10T15:04:05Z" → ISO normalizado; cualquier otra cosa → ''. */
const fechaIso = (x: unknown): string => {
  const v = texto(x);
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return '';
  const t = Date.parse(v);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
};

/** El flyer de Control360 llega como URL absoluta (su bucket); cualquier otra cosa no se usa. */
const urlImagen = (x: unknown): string => {
  const v = texto(x);
  return /^https?:\/\/\S+$/.test(v) ? v : '';
};

/**
 * Control360 manda el WhatsApp extra como dígitos (10 sin indicativo o 12-13
 * con él). Aquí toma la forma que usan las páginas: `numero` con el indicativo
 * de Colombia para wa.me / tel:, y `texto` legible ("310 878 8754").
 */
export function whatsappDesdeDigitos(x: unknown): { numero: string; texto: string } | null {
  const d = texto(x).replace(/\D+/g, '');
  if (d.length < 10 || d.length > 13) return null;
  const numero = d.length === 10 ? `57${d}` : d;
  const local = d.slice(-10);
  return { numero, texto: `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` };
}

/**
 * Convierte el JSON de Control360 en vacantes del sitio, o explica por qué no.
 * Es pura: no toca red ni entorno. Las entradas sin slug válido o sin cargo se
 * descartan una a una; si no queda ninguna, se considera que no hay lista.
 */
export function leerVacantesRemotas(
  json: unknown,
  estaticas: readonly Vacante[] = vacantesEstaticas,
): { ok: true; vacantes: Vacante[] } | { ok: false; motivo: string } {
  if (!json || typeof json !== 'object') return { ok: false, motivo: 'la respuesta no es un objeto' };
  const { version, vacantes } = json as { version?: unknown; vacantes?: unknown };
  if (version !== 1) return { ok: false, motivo: `versión desconocida (${String(version)})` };
  if (!Array.isArray(vacantes)) return { ok: false, motivo: 'falta la lista "vacantes"' };

  const porSlug = new Map(estaticas.map((v) => [v.slug, v]));
  const salida: Vacante[] = [];
  const vistos = new Set<string>();
  for (const cruda of vacantes) {
    if (!cruda || typeof cruda !== 'object') continue;
    const o = cruda as Record<string, unknown>;
    const slug = texto(o.slug);
    const cargo = texto(o.cargo);
    if (!FORMA_SLUG.test(slug) || !cargo || vistos.has(slug)) continue;
    vistos.add(slug);
    const base = porSlug.get(slug);
    // Las preguntas de filtro vienen SOLO de Control360 (sin la regla que
    // descarta); si no trae, el formulario no las pinta.
    const preguntas = leerPreguntas(o.preguntas);
    // Lo que Control360 trae manda; lo que no trae se hereda de la lista
    // estática (mismo slug), y si tampoco está ahí, simplemente no se pinta.
    const imagen = urlImagen(o.imagen) || base?.imagen || '';
    // Las zonas: de Control360 el día que las mande y, mientras tanto, de la
    // lista estática, pero solo si su sede sigue siendo una de ellas.
    const ciudad = texto(o.ciudad);
    const zonasPropias = textos(o.zonas);
    const zonas = zonasPropias.length
      ? zonasPropias
      : base?.zonas && sedeEntreZonas(ciudad, base.zonas)
        ? [...base.zonas]
        : [];
    const habilidades = textos(o.habilidades);
    const ofrecemos = textos(o.ofrecemos);
    const whatsappExtra = whatsappDesdeDigitos(o.whatsappExtra) ?? (base?.whatsappExtra ? { ...base.whatsappExtra } : null);
    const salario = texto(o.salario) || base?.salario || '';
    const jornada = texto(o.jornada) || base?.jornada || '';
    // Fecha del último cambio, si Control360 la manda (para el sitemap). Solo
    // se acepta una fecha ISO real; lo demás se ignora.
    const actualizada = fechaIso(o.actualizada);
    // Publicación y cierre, para Google Empleos (JobPosting). Hoy Control360
    // no las manda; se aceptan con los nombres más probables.
    const publicada = fechaIso(o.publicada ?? o.creada ?? o.fechaPublicacion);
    const vence = fechaIso(o.vence ?? o.validThrough ?? o.cierre);
    salida.push({
      slug,
      cargo,
      ciudad,
      ...(zonas.length ? { zonas } : {}),
      tipo: texto(o.tipo),
      resumen: texto(o.resumen),
      imagen,
      descripcion: textos(o.descripcion),
      requisitos: textos(o.requisitos),
      funciones: textos(o.funciones),
      ...(preguntas.length ? { preguntas } : {}),
      ...(habilidades.length ? { habilidades } : base?.habilidades ? { habilidades: [...base.habilidades] } : {}),
      ...(ofrecemos.length ? { ofrecemos } : base?.ofrecemos ? { ofrecemos: [...base.ofrecemos] } : {}),
      ...(whatsappExtra ? { whatsappExtra } : {}),
      ...(salario ? { salario } : {}),
      ...(jornada ? { jornada } : {}),
      ...(actualizada ? { actualizada } : {}),
      ...(publicada ? { publicada } : {}),
      ...(vence ? { vence } : {}),
    });
  }
  // Lista vacía de verdad = RRHH no tiene nada publicado, y así se muestra.
  // Lista con entradas pero ninguna válida = algo raro: mejor la estática.
  if (salida.length === 0 && vacantes.length > 0) {
    return { ok: false, motivo: 'ninguna vacante de Control360 tiene slug y cargo válidos' };
  }
  return { ok: true, vacantes: salida };
}

/** En Astro el build y las funciones corren en Node, así que `process.env` existe. */
function entornoActual(): Entorno {
  return typeof process === 'undefined' ? {} : (process.env as Entorno);
}

export function urlVacantes(env: Entorno = entornoActual()): string | null {
  const valor = (env as Record<string, string | undefined>)[VARIABLE_URL]?.trim();
  return valor && /^https?:\/\//.test(valor) ? valor : null;
}

/**
 * Cómo pide el SERVIDOR la lista: con el secreto compartido, `?fresco=1` +
 * Bearer (Control360 responde sin la caché de su CDN); sin él, la URL tal cual.
 */
export function pedidoVacantes(url: string, env: Entorno): { url: string; headers: Record<string, string> } {
  const secreto = (env as Record<string, string | undefined>)[VARIABLE_SECRETO]?.trim();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (!secreto) return { url, headers };
  const fresca = new URL(url);
  fresca.searchParams.set('fresco', '1');
  return { url: fresca.toString(), headers: { ...headers, authorization: `Bearer ${secreto}` } };
}

/**
 * Trae las vacantes, de Control360 si se puede y de la lista estática si no.
 * Recibe `fetch` y el entorno como parámetros para poder probarse sin red.
 */
export async function resolverVacantes(opciones: {
  env?: Entorno;
  fetchFn?: typeof fetch;
  estaticas?: readonly Vacante[];
} = {}): Promise<ResultadoVacantes> {
  const estaticas = [...(opciones.estaticas ?? vacantesEstaticas)];
  const env = opciones.env ?? entornoActual();
  const url = urlVacantes(env);
  if (!url) return { fuente: 'estatica', vacantes: estaticas, motivo: `sin ${VARIABLE_URL}` };

  const fetchFn = opciones.fetchFn ?? fetch;
  const pedido = pedidoVacantes(url, env);
  try {
    const respuesta = await fetchFn(pedido.url, {
      headers: pedido.headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    if (!respuesta.ok) {
      return { fuente: 'estatica', vacantes: estaticas, motivo: `Control360 respondió ${respuesta.status}` };
    }
    const leidas = leerVacantesRemotas(await respuesta.json(), estaticas);
    if (!leidas.ok) return { fuente: 'estatica', vacantes: estaticas, motivo: leidas.motivo };
    return { fuente: 'control360', vacantes: leidas.vacantes };
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    return { fuente: 'estatica', vacantes: estaticas, motivo: `no se pudo leer Control360: ${motivo}` };
  }
}

let memoria: { promesa: Promise<ResultadoVacantes>; desde: number } | null = null;

/**
 * ¿Se está compilando? La integración de astro.config.mjs marca el proceso del
 * build; en una función de Vercel esa marca no existe.
 */
function enBuild(): boolean {
  return typeof process !== 'undefined' && process.env.EMPLEOS_LECTURA_UNICA === '1';
}

/**
 * Las vacantes para las páginas, el formulario y la validación. En el build,
 * una sola lectura por proceso (lo piden varias páginas y no tiene sentido ir
 * a Control360 cada vez). En una función (ISR o postular), una lectura vale
 * solo MEMORIA_EN_FUNCION_MS: cada regeneración tiene que ver lo último que
 * guardó RRHH. Deja en el log de dónde salieron.
 */
export function cargarVacantes(): Promise<ResultadoVacantes> {
  const ahora = Date.now();
  if (memoria && (enBuild() || ahora - memoria.desde < MEMORIA_EN_FUNCION_MS)) return memoria.promesa;
  const promesa = resolverVacantes().then((r) => {
    if (r.fuente === 'control360') {
      console.log(`[empleos] ${r.vacantes.length} vacantes leídas de Control360`);
    } else {
      console.warn(`[empleos] vacantes de src/data/vacantes.ts (${r.motivo})`);
    }
    return r;
  });
  memoria = { promesa, desde: ahora };
  return promesa;
}

/** Solo para pruebas: olvida la lectura anterior. */
export function olvidarVacantesCargadas(): void {
  memoria = null;
}
