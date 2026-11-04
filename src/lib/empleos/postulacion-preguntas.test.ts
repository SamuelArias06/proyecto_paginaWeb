// PRUEBAS DEL FORMULARIO CON PREGUNTAS DE FILTRO — validarPostulacion con una vacante que las trae.
//
// Por qué existe: postular.test.ts usa la lista estática (sin preguntas). Aquí se inyecta la vacante
//   para comprobar que el servidor exige las obligatorias, que una vacante sin preguntas deja
//   `respuestas` en null (Control360 → SIN FILTRO) y que el cuerpo firmado las lleva.
// Dónde corre: vitest (npm test), sin red.

import { describe, expect, it } from 'vitest';
import { cuerpoParaControl360 } from './control360';
import { nombreCampo, type PreguntaVacante } from './preguntas';
import { validarPostulacion } from './postulacion';

const PDF_MINIMO = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

const PREGUNTAS: PreguntaVacante[] = [
  { id: 'moto', texto: '¿Tienes moto propia?', tipo: 'SI_NO', obligatoria: true },
  { id: 'exp', texto: '¿Cuántos años de experiencia tienes?', tipo: 'NUMERO', obligatoria: false },
];

const vacanteDe = async (cargo: string, slug?: string | null) =>
  cargo === 'Vendedor TAT'
    ? { slug: 'vendedor-tat', ciudad: 'Tunja, Boyacá', preguntas: PREGUNTAS }
    : cargo === 'Facturación'
      ? slug === 'facturacion-duitama'
        ? { slug: 'facturacion-duitama', ciudad: 'Duitama, Boyacá', preguntas: [] }
        : { slug: 'facturacion', ciudad: 'Tunja y alrededores', preguntas: [] }
      : null;

function formulario(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    nombre: 'Cristian Amaya',
    correo: 'practicaspasantiasdst@gmail.com',
    telefono: '310 623 2429',
    municipio: 'Tunja',
    cargo: 'Vendedor TAT',
    experiencia: '',
    autorizacion: 'si',
    turnstileToken: 'token',
    ...extra,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  f.set('hoja-de-vida', new File([new Uint8Array(PDF_MINIMO)], 'cv.pdf', { type: 'application/pdf' }));
  return f;
}

/*
 * EL idEnvio: identifica la POSTULACIÓN, no la petición.
 *
 * El navegador manda el mismo valor en los tres intentos del envío, y
 * postular.ts lo usa como llave de idempotencia de Control360: así una
 * respuesta que se perdió en la red de un celular no acaba creando dos veces la
 * misma postulación. Nunca es obligatorio ni motivo de rechazo.
 */
describe('el idEnvio de los reintentos', () => {
  const conPreguntas = { [nombreCampo('moto')]: 'SI' };

  it('un UUID se conserva tal cual', async () => {
    const id = '0b2b9b2e-3f4a-4c7d-8b1e-9f0a1b2c3d4e';
    const r = await validarPostulacion(formulario({ ...conPreguntas, idEnvio: id }), { vacanteDe });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.idEnvio).toBe(id);
  });

  it('el respaldo del navegador sin `crypto.randomUUID` también vale', async () => {
    const id = 'm9x2k1-a7b3c9d1';
    const r = await validarPostulacion(formulario({ ...conPreguntas, idEnvio: id }), { vacanteDe });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.idEnvio).toBe(id);
  });

  it('sin idEnvio la postulación se acepta igual, y queda vacío', async () => {
    const r = await validarPostulacion(formulario(conPreguntas), { vacanteDe });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.idEnvio).toBe('');
  });

  /*
   * Viaja a Control360 y acaba escrito en un registro, así que lo que no tenga
   * forma de identificador se descarta en vez de rechazar la postulación: el
   * servidor pondrá el suyo, como hacía antes de que esto existiera.
   */
  it('lo que no tiene forma de identificador se descarta, sin rechazar nada', async () => {
    for (const malo of ['corto', 'con espacios aqui', 'a'.repeat(65), 'punto.y.coma;', '<script>']) {
      const r = await validarPostulacion(formulario({ ...conPreguntas, idEnvio: malo }), {
        vacanteDe,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.datos.idEnvio).toBe('');
    }
  });
});

describe('validarPostulacion con preguntas de filtro', () => {
  it('exige la obligatoria y la devuelve junto a los demás errores', async () => {
    const r = await validarPostulacion(formulario(), { vacanteDe });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores).toEqual(['Falta responder: «¿Tienes moto propia?».']);
  });

  it('con las respuestas, salen validadas y con el slug de la vacante', async () => {
    const r = await validarPostulacion(
      formulario({ [nombreCampo('moto')]: 'SI', [nombreCampo('exp')]: '2' }),
      { vacanteDe },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.vacanteSlug).toBe('vendedor-tat');
    expect(r.datos.respuestas).toEqual([
      { id: 'moto', texto_pregunta: '¿Tienes moto propia?', respuesta: 'SI' },
      { id: 'exp', texto_pregunta: '¿Cuántos años de experiencia tienes?', respuesta: '2' },
    ]);
  });

  it('una vacante sin preguntas deja respuestas en null y el cuerpo a Control360 no las lleva', async () => {
    const r = await validarPostulacion(formulario({ cargo: 'Facturación' }), { vacanteDe });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.vacanteSlug).toBe('facturacion');
    expect(r.datos.respuestas).toBeNull();
    const cuerpo = JSON.parse(cuerpoParaControl360(r.datos, 'id-1'));
    expect(cuerpo).not.toHaveProperty('respuestas');
    expect(cuerpo).not.toHaveProperty('vacanteSlug');
  });

  it('la espontánea no tiene vacante: sin slug, sin respuestas, y el formulario queda como hoy', async () => {
    const r = await validarPostulacion(formulario({ cargo: 'Otro / hoja de vida espontánea' }), { vacanteDe });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.vacanteSlug).toBeNull();
    expect(r.datos.respuestas).toBeNull();
  });

  it('el cuerpo firmado a Control360 lleva vacanteSlug y respuestas {id, texto_pregunta, respuesta}', async () => {
    const r = await validarPostulacion(formulario({ [nombreCampo('moto')]: 'no' }), { vacanteDe });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cuerpo = JSON.parse(cuerpoParaControl360(r.datos, 'id-2'));
    expect(cuerpo.vacanteSlug).toBe('vendedor-tat');
    expect(cuerpo.respuestas).toEqual([{ id: 'moto', texto_pregunta: '¿Tienes moto propia?', respuesta: 'NO' }]);
    expect(Object.keys(cuerpo.respuestas[0]).sort()).toEqual(['id', 'respuesta', 'texto_pregunta']);
  });
});

describe('municipio y pregunta de traslado (Control360, 13·10)', () => {
  it('sin municipio no se recibe, con el mismo mensaje que Control360', async () => {
    const r = await validarPostulacion(formulario({ municipio: '', [nombreCampo('moto')]: 'SI' }), { vacanteDe });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores).toEqual(['Escribe el municipio donde vives.']);
  });

  it('el municipio sale limpio y viaja siempre en el cuerpo firmado', async () => {
    const r = await validarPostulacion(
      formulario({ municipio: '  san  josé de pare ,boyacá ', cargo: 'Otro / hoja de vida espontánea' }),
      { vacanteDe },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.municipio).toBe('San josé de pare, boyacá');
    const cuerpo = JSON.parse(cuerpoParaControl360(r.datos, 'e1'));
    expect(cuerpo.municipio).toBe('San josé de pare, boyacá');
    // Espontánea: sin vacante no hay sede con qué comparar ni pregunta que hacer.
    expect(cuerpo).not.toHaveProperty('respuestas');
  });

  it('si vive en la sede (con o sin tildes y mayúsculas) no se pregunta el traslado', async () => {
    const r = await validarPostulacion(formulario({ municipio: 'TUNJA', [nombreCampo('moto')]: 'SI' }), { vacanteDe });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.respuestas?.map((x) => x.id)).toEqual(['moto']);
  });

  it('si vive en otro municipio, la de traslado es obligatoria', async () => {
    const r = await validarPostulacion(formulario({ municipio: 'Bogotá', [nombreCampo('moto')]: 'SI' }), { vacanteDe });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores).toEqual(['Falta responder: «¿Puedes vivir o trabajar en Tunja?».']);
  });

  it('la respuesta de traslado va con las demás, con el id que espera Control360', async () => {
    const r = await validarPostulacion(
      formulario({ municipio: 'Bogotá', [nombreCampo('moto')]: 'SI', [nombreCampo('c360-traslado')]: 'NO' }),
      { vacanteDe },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cuerpo = JSON.parse(cuerpoParaControl360(r.datos, 'e2'));
    expect(cuerpo.respuestas).toEqual([
      { id: 'moto', texto_pregunta: '¿Tienes moto propia?', respuesta: 'SI' },
      { id: 'c360-traslado', texto_pregunta: '¿Puedes vivir o trabajar en Tunja?', respuesta: 'NO' },
    ]);
  });

  it('una vacante vieja sin preguntas solo agrega la de traslado («Tunja y alrededores» es Tunja)', async () => {
    const enTunja = await validarPostulacion(formulario({ cargo: 'Facturación', municipio: 'tunja' }), { vacanteDe });
    expect(enTunja.ok && enTunja.datos.respuestas).toBeNull();

    const fuera = await validarPostulacion(
      formulario({ cargo: 'Facturación', municipio: 'Paipa', [nombreCampo('c360-traslado')]: 'Sí' }),
      { vacanteDe },
    );
    expect(fuera.ok).toBe(true);
    if (!fuera.ok) return;
    expect(fuera.datos.vacanteSlug).toBe('facturacion');
    expect(fuera.datos.respuestas).toEqual([
      { id: 'c360-traslado', texto_pregunta: '¿Puedes vivir o trabajar en Tunja?', respuesta: 'SI' },
    ]);
  });

  it('el slug elegido desempata un cargo abierto en varias sedes', async () => {
    const r = await validarPostulacion(
      formulario({ cargo: 'Facturación', vacante: 'facturacion-duitama', municipio: 'Duitama' }),
      { vacanteDe },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.datos.vacanteSlug).toBe('facturacion-duitama');
    expect(r.datos.respuestas).toBeNull();
  });
});
