/**
 * Vacantes abiertas en VARIAS zonas a la vez.
 *
 * El problema: Control360 guarda UNA sede por vacante (el campo «ciudad»), y
 * su modelo no tiene dónde decir que la misma convocatoria está abierta en tres
 * municipios. Cuando RRHH abre «Vendedor TAT» para Tunja, Chiquinquirá y
 * Barbosa, Control360 manda «Tunja, Boyacá» y quien entra a /empleos/ cree que
 * solo hay cupo en Tunja.
 *
 * La solución: `Vacante.zonas` (src/data/vacantes.ts) lista los municipios y
 * SOLO sirve para lo que lee la persona: la tarjeta del listado, el encabezado
 * de /empleos/<slug>/ y la ficha de Google Empleos.
 *
 * LO QUE NO CAMBIA. `ciudad` sigue siendo la sede, y sigue siendo lo único que
 * mira la pregunta automática de traslado (ubicacion.ts). Eso es a propósito:
 * esa pregunta tiene que calcularse IGUAL aquí y en Control360, porque si aquí
 * no se hace y allá se espera, Control360 rechaza la postulación por faltar una
 * obligatoria. Las zonas no entran en esa cuenta.
 */
import type { Vacante } from '../../data/vacantes';
import { ciudadDeSede, normalizar } from './ubicacion';

/** Lo que hace falta para hablar de la ubicación de una vacante. */
export type ConUbicacion = Pick<Vacante, 'ciudad'> & { zonas?: readonly string[] };

/** Municipio de una zona o sede: «Barbosa, Santander» → «Barbosa». */
const municipio = (zona: string) => ciudadDeSede(zona).trim();

/** Las zonas con municipio de verdad, sin repetidas y en su orden. */
export function municipiosDeZonas(zonas: readonly string[] | undefined): string[] {
  const salida: string[] = [];
  const vistos = new Set<string>();
  for (const zona of zonas ?? []) {
    const m = municipio(String(zona ?? ''));
    const clave = normalizar(m);
    if (!m || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(m);
  }
  return salida;
}

/** ¿La vacante está abierta en más de un municipio? */
export function tieneVariasZonas(v: ConUbicacion): boolean {
  return municipiosDeZonas(v.zonas).length > 1;
}

/** «Tunja», «Tunja y Barbosa», «Tunja, Chiquinquirá y Barbosa». */
export function listaEnEspanol(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/**
 * El texto de ubicación que se muestra. Con una sola zona (o ninguna) sale la
 * sede tal cual la escribió Control360 —«Tunja, Boyacá»—, que es como se ha
 * visto siempre; con varias, los municipios: «Tunja, Chiquinquirá y Barbosa».
 */
export function textoUbicacion(v: ConUbicacion): string {
  const municipios = municipiosDeZonas(v.zonas);
  return municipios.length > 1 ? listaEnEspanol(municipios) : v.ciudad;
}

/**
 * ¿La sede que manda Control360 es una de las zonas de la lista estática?
 *
 * Es el permiso para heredar las zonas del repositorio. Mientras Control360
 * siga diciendo «Tunja» y el repositorio «Tunja, Chiquinquirá y Barbosa», las
 * dos hablan de la misma convocatoria y se muestran las tres. El día que RRHH
 * mueva la vacante a un municipio que no está en la lista, esto da `false` y
 * manda Control360, como con todos los demás campos.
 */
export function sedeEntreZonas(ciudad: string, zonas: readonly string[] | undefined): boolean {
  const sede = normalizar(municipio(ciudad));
  if (!sede) return false;
  return municipiosDeZonas(zonas).some((m) => normalizar(m) === sede);
}
