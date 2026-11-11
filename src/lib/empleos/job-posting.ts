/**
 * Ficha `JobPosting` (schema.org) de cada vacante, para Google Empleos.
 *
 * Va en /empleos/<slug>/ (VacanteDetalle.astro). Con ella Google puede mostrar
 * la vacante en su buscador de empleos, con cargo, ciudad, tipo de contrato y
 * empresa, y enlazar a la página.
 *
 * QUÉ NO ES UN EMPLEO. "Buscamos vehículos" es una convocatoria para vincular
 * vehículo propio, no un cargo: publicarla como empleo sería información falsa
 * para Google (y una penalización segura). `esEmpleo()` la deja fuera por su
 * slug, por mencionar vehículos en el cargo o por llegar con el tipo
 * "Convocatoria abierta".
 *
 * FECHAS. Control360 hoy no manda fecha de publicación. Se usa, en este orden:
 * `publicada`, `actualizada` (ambas solo si Control360 las manda) y, si no hay
 * ninguna, el día de hoy en Colombia, que es cuando esta copia de la página se
 * generó. `validThrough` solo sale si Control360 manda `vence`.
 */
import { contactoEmpleo, type Vacante } from '../../data/vacantes';
import { direccionSede } from '../datos-estructurados';
import { empresa } from '../../data/site';

/** Slugs que nunca son empleo. */
const NO_SON_EMPLEO: ReadonlySet<string> = new Set(['buscamos-vehiculos']);

/** ¿La vacante es un empleo de verdad (y por tanto lleva JobPosting)? */
export function esEmpleo(v: Pick<Vacante, 'slug' | 'cargo' | 'tipo'>): boolean {
  if (NO_SON_EMPLEO.has(v.slug)) return false;
  if (/veh[ií]culo/i.test(v.cargo) || /veh[ií]culo/i.test(v.slug)) return false;
  if (/^convocatoria/i.test(v.tipo.trim())) return false;
  return true;
}

/** Tipo de contrato de Control360 → `employmentType` de schema.org. */
export function tipoEmpleo(tipo: string): string {
  const t = tipo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/practica|pasant|aprendiz/.test(t)) return 'INTERN';
  if (/medio tiempo|tiempo parcial|parcial/.test(t)) return 'PART_TIME';
  if (/temporal|obra o labor/.test(t)) return 'TEMPORARY';
  if (/prestacion de servicios|contratista|independiente/.test(t)) return 'CONTRACTOR';
  if (/por dias|por horas|jornal/.test(t)) return 'PER_DIEM';
  if (/voluntari/.test(t)) return 'VOLUNTEER';
  if (/tiempo completo|completo|indefinido|fijo/.test(t)) return 'FULL_TIME';
  return 'OTHER';
}

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const lista = (titulo: string, items: readonly string[] | undefined) =>
  items && items.length > 0
    ? `<p><strong>${escapar(titulo)}</strong></p><ul>${items.map((i) => `<li>${escapar(i)}</li>`).join('')}</ul>`
    : '';

/** Descripción en HTML (Google la admite así): párrafos, funciones, requisitos… */
export function descripcionHtml(v: Vacante): string {
  const partes = [
    ...(v.descripcion.length ? v.descripcion : [v.resumen]).map((p) => `<p>${escapar(p)}</p>`),
    lista('Funciones principales', v.funciones),
    lista('Requisitos', v.requisitos),
    lista('Habilidades deseables', v.habilidades),
    lista('Ofrecemos', v.ofrecemos),
    v.jornada ? `<p><strong>Jornada:</strong> ${escapar(v.jornada)}</p>` : '',
    v.salario ? `<p><strong>Salario:</strong> ${escapar(v.salario)}</p>` : '',
    `<p>Postúlate en dstunja.com o escribe a ${escapar(contactoEmpleo.email)}.</p>`,
  ];
  return partes.filter(Boolean).join('');
}

/** "AAAA-MM-DD" de hoy en Colombia. */
export function hoyEnColombia(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);
}

/** Un lugar de trabajo: la sede si es Tunja; si no, la ciudad y el departamento. */
function lugar(ciudad: string) {
  const [municipio = '', departamento = ''] = ciudad.split(',').map((s) => s.trim());
  if (!municipio || /^tunja$/i.test(municipio)) return { '@type': 'Place', address: direccionSede() };
  return {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      addressLocality: municipio,
      ...(departamento ? { addressRegion: departamento } : {}),
      addressCountry: 'CO',
    },
  };
}

/**
 * Dónde se trabaja: la sede, o una entrada por municipio cuando la convocatoria
 * está abierta en varios (`zonas`). Google admite `jobLocation` como lista y es
 * la única forma de que la vacante salga en las búsquedas de las tres ciudades.
 */
function lugares(v: Vacante) {
  const zonas = (v.zonas ?? []).map((z) => z.trim()).filter(Boolean);
  const unicas = [...new Set(zonas)];
  if (unicas.length < 2) return lugar(v.ciudad);
  return unicas.map(lugar);
}

/**
 * El JSON-LD de la vacante, o `null` si no es un empleo.
 *
 * @param opciones.url    URL canónica de la página de la vacante
 * @param opciones.logo   URL absoluta del logo de la empresa
 * @param opciones.ahora  para pruebas
 */
export function jobPosting(
  v: Vacante,
  opciones: { url: string; logo: string; ahora?: Date },
): Record<string, unknown> | null {
  if (!esEmpleo(v)) return null;
  const datePosted = (v.publicada ?? v.actualizada)?.slice(0, 10) || hoyEnColombia(opciones.ahora);
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: v.cargo,
    description: descripcionHtml(v),
    datePosted,
    ...(v.vence ? { validThrough: v.vence } : {}),
    employmentType: tipoEmpleo(v.tipo),
    identifier: { '@type': 'PropertyValue', name: empresa.razonSocial, value: v.slug },
    hiringOrganization: {
      '@type': 'Organization',
      name: empresa.razonSocial,
      sameAs: 'https://dstunja.com',
      logo: opciones.logo,
    },
    jobLocation: lugares(v),
    url: opciones.url,
    directApply: false,
  };
}
