/**
 * Pruebas de la fuente de vacantes (src/lib/empleos/vacantes-fuente.ts):
 * Control360 primero y la lista estática como respaldo.
 *
 * Lo que más importa es que la página NUNCA se quede sin vacantes: sin
 * variable, con la URL caída, con un JSON raro o vacío, sale la lista de
 * src/data/vacantes.ts. Y que lo que sí viene de Control360 conserve el flyer
 * y los extras de la lista estática cuando el slug coincide.
 */
import { describe, expect, it } from 'vitest';
import type { Vacante } from '../../data/vacantes';
import { cargosDe, CARGO_ESPONTANEO } from './cargos';
import {
  leerVacantesRemotas,
  pedidoVacantes,
  resolverVacantes,
  urlVacantes,
  VARIABLE_SECRETO,
  VARIABLE_URL,
  whatsappDesdeDigitos,
} from './vacantes-fuente';

const ESTATICA: Vacante = {
  slug: 'vendedor-tat',
  cargo: 'Vendedor TAT (estático)',
  ciudad: 'Tunja, Boyacá',
  tipo: 'Tiempo completo',
  resumen: 'Resumen estático.',
  imagen: '/img/empleos/perfil-de-ventas.jpeg',
  descripcion: ['Párrafo estático.'],
  requisitos: ['Requisito estático.'],
  habilidades: ['Comunicación'],
  ofrecemos: ['Salario base'],
  whatsappExtra: { numero: '573000000000', texto: '300 000 0000' },
};
const ESTATICAS = [ESTATICA];

const REMOTO = {
  version: 1,
  vacantes: [
    {
      slug: 'vendedor-tat',
      cargo: 'Vendedor TAT',
      ciudad: 'Duitama, Boyacá',
      tipo: 'Tiempo completo',
      resumen: 'Resumen desde Control360.',
      descripcion: ['Párrafo 1.'],
      requisitos: ['Moto propia', 'Licencia A2'],
      funciones: ['Visitar tiendas'],
    },
    {
      slug: 'auxiliar-de-bodega',
      cargo: 'Auxiliar de Bodega',
      ciudad: 'Tunja, Boyacá',
      tipo: '',
      resumen: '',
      descripcion: [],
      requisitos: [],
      funciones: [],
    },
  ],
};

const respuesta = (cuerpo: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('leerVacantesRemotas', () => {
  it('convierte el JSON de Control360 en vacantes del sitio, en orden', () => {
    const r = leerVacantesRemotas(REMOTO, ESTATICAS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vacantes.map((v) => v.slug)).toEqual(['vendedor-tat', 'auxiliar-de-bodega']);
    expect(r.vacantes[0].requisitos).toEqual(['Moto propia', 'Licencia A2']);
    expect(r.vacantes[0].funciones).toEqual(['Visitar tiendas']);
  });

  it('el texto manda Control360; el flyer y los extras los hereda de la lista estática por slug', () => {
    const r = leerVacantesRemotas(REMOTO, ESTATICAS);
    if (!r.ok) throw new Error(r.motivo);
    const [vendedor, bodega] = r.vacantes;
    expect(vendedor.cargo).toBe('Vendedor TAT');
    expect(vendedor.ciudad).toBe('Duitama, Boyacá');
    expect(vendedor.imagen).toBe(ESTATICA.imagen);
    expect(vendedor.ofrecemos).toEqual(['Salario base']);
    expect(vendedor.habilidades).toEqual(['Comunicación']);
    expect(vendedor.whatsappExtra).toEqual(ESTATICA.whatsappExtra);
    expect(bodega.imagen).toBe('');
    expect(bodega.ofrecemos).toBeUndefined();
  });

  it('lo que Control360 trae manda sobre la lista estática: imagen, ofrecemos, habilidades, WhatsApp, salario y jornada', () => {
    const r = leerVacantesRemotas(
      {
        version: 1,
        vacantes: [
          {
            slug: 'vendedor-tat',
            cargo: 'Vendedor TAT',
            imagen: 'https://x.supabase.co/storage/v1/object/public/talento-vacantes/a/b/1760000000000.jpg',
            ofrecemos: ['Salario base', 'Comisiones'],
            habilidades: ['Liderazgo'],
            whatsappExtra: '573108788754',
            salario: '$1.600.000 + comisiones',
            jornada: 'Lunes a sábado',
          },
        ],
      },
      ESTATICAS,
    );
    if (!r.ok) throw new Error(r.motivo);
    const [v] = r.vacantes;
    expect(v.imagen).toBe('https://x.supabase.co/storage/v1/object/public/talento-vacantes/a/b/1760000000000.jpg');
    expect(v.ofrecemos).toEqual(['Salario base', 'Comisiones']);
    expect(v.habilidades).toEqual(['Liderazgo']);
    expect(v.whatsappExtra).toEqual({ numero: '573108788754', texto: '310 878 8754' });
    expect(v.salario).toBe('$1.600.000 + comisiones');
    expect(v.jornada).toBe('Lunes a sábado');
  });

  it('solo hereda de la lista estática lo que Control360 NO trae (campo por campo)', () => {
    const r = leerVacantesRemotas(
      {
        version: 1,
        vacantes: [
          // Trae ofrecemos pero no imagen ni habilidades ni WhatsApp: esos tres se heredan.
          { slug: 'vendedor-tat', cargo: 'Vendedor TAT', ofrecemos: ['Bonos'], habilidades: [], imagen: '', salario: '' },
        ],
      },
      ESTATICAS,
    );
    if (!r.ok) throw new Error(r.motivo);
    const [v] = r.vacantes;
    expect(v.ofrecemos).toEqual(['Bonos']);
    expect(v.habilidades).toEqual(['Comunicación']);
    expect(v.imagen).toBe(ESTATICA.imagen);
    expect(v.whatsappExtra).toEqual(ESTATICA.whatsappExtra);
    expect(v).not.toHaveProperty('salario');
    expect(v).not.toHaveProperty('jornada');
  });

  it('hereda las zonas de la lista estática mientras la sede de Control360 sea una de ellas', () => {
    const conZonas = [{ ...ESTATICA, zonas: ['Tunja, Boyacá', 'Chiquinquirá, Boyacá', 'Barbosa, Santander'] }];
    const r = leerVacantesRemotas(
      { version: 1, vacantes: [{ slug: 'vendedor-tat', cargo: 'Vendedor TAT', ciudad: 'Chiquinquirá, Boyacá' }] },
      conZonas,
    );
    if (!r.ok) throw new Error(r.motivo);
    expect(r.vacantes[0].ciudad).toBe('Chiquinquirá, Boyacá');
    expect(r.vacantes[0].zonas).toEqual(['Tunja, Boyacá', 'Chiquinquirá, Boyacá', 'Barbosa, Santander']);
  });

  it('si Control360 mudó la vacante a otro municipio, las zonas viejas se descartan', () => {
    const conZonas = [{ ...ESTATICA, zonas: ['Tunja, Boyacá', 'Chiquinquirá, Boyacá'] }];
    // REMOTO trae esta misma vacante en Duitama.
    const r = leerVacantesRemotas(REMOTO, conZonas);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.vacantes[0].ciudad).toBe('Duitama, Boyacá');
    expect(r.vacantes[0]).not.toHaveProperty('zonas');
  });

  it('las zonas de Control360 mandan el día que las mande', () => {
    const conZonas = [{ ...ESTATICA, zonas: ['Tunja, Boyacá'] }];
    const r = leerVacantesRemotas(
      {
        version: 1,
        vacantes: [{ slug: 'vendedor-tat', cargo: 'Vendedor TAT', ciudad: 'Tunja, Boyacá', zonas: ['Tunja', 'Sogamoso'] }],
      },
      conZonas,
    );
    if (!r.ok) throw new Error(r.motivo);
    expect(r.vacantes[0].zonas).toEqual(['Tunja', 'Sogamoso']);
  });

  it('una vacante sin zonas en ningún lado no estrena el campo', () => {
    const r = leerVacantesRemotas(REMOTO, ESTATICAS);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.vacantes[0]).not.toHaveProperty('zonas');
    expect(r.vacantes[1]).not.toHaveProperty('zonas');
  });

  it('una imagen que no es URL absoluta no se usa (la página no puede buscarla en public/ por ese nombre)', () => {
    const r = leerVacantesRemotas(
      { version: 1, vacantes: [{ slug: 'nueva', cargo: 'Nueva', imagen: '../../etc/passwd' }, { slug: 'otra', cargo: 'Otra', imagen: 'x/y.jpg' }] },
      ESTATICAS,
    );
    if (!r.ok) throw new Error(r.motivo);
    expect(r.vacantes[0].imagen).toBe('');
    expect(r.vacantes[1].imagen).toBe('');
    expect(r.vacantes[0]).not.toHaveProperty('whatsappExtra');
  });

  it('descarta entradas sin slug válido, sin cargo o repetidas', () => {
    const r = leerVacantesRemotas(
      {
        version: 1,
        vacantes: [
          { slug: 'Con Mayúsculas', cargo: 'X' },
          { slug: 'sin-cargo' },
          { slug: 'bueno', cargo: 'Bueno' },
          { slug: 'bueno', cargo: 'Repetido' },
          'basura',
          null,
        ],
      },
      ESTATICAS,
    );
    expect(r.ok && r.vacantes.map((v) => v.cargo)).toEqual(['Bueno']);
  });

  it('trae las preguntas de filtro de Control360 (sin la regla) y no inventa ninguna', () => {
    const r = leerVacantesRemotas(
      {
        version: 1,
        vacantes: [
          {
            slug: 'vendedor-tat',
            cargo: 'Vendedor TAT',
            preguntas: [
              { id: 'moto', texto: '¿Tienes moto propia?', tipo: 'SI_NO', obligatoria: true, regla: { descarta_si: 'NO' } },
              { id: 'ciudad', texto: '¿Dónde vives?', tipo: 'OPCION', opciones: ['Tunja', 'Duitama'], obligatoria: false },
            ],
          },
          { slug: 'sin-preguntas', cargo: 'Sin preguntas' },
        ],
      },
      ESTATICAS,
    );
    if (!r.ok) throw new Error(r.motivo);
    expect(r.vacantes[0].preguntas).toEqual([
      { id: 'moto', texto: '¿Tienes moto propia?', tipo: 'SI_NO', obligatoria: true },
      { id: 'ciudad', texto: '¿Dónde vives?', tipo: 'OPCION', opciones: ['Tunja', 'Duitama'], obligatoria: false },
    ]);
    expect(r.vacantes[1]).not.toHaveProperty('preguntas');
  });

  it('rechaza lo que no tiene la forma esperada', () => {
    expect(leerVacantesRemotas(null, ESTATICAS).ok).toBe(false);
    expect(leerVacantesRemotas({ version: 2, vacantes: [] }, ESTATICAS).ok).toBe(false);
    expect(leerVacantesRemotas({ version: 1 }, ESTATICAS).ok).toBe(false);
    // Entradas que existen pero ninguna sirve: algo raro, mejor la estática.
    expect(leerVacantesRemotas({ version: 1, vacantes: [{ slug: 'MAL SLUG', cargo: 'x' }] }, ESTATICAS)).toEqual({
      ok: false,
      motivo: 'ninguna vacante de Control360 tiene slug y cargo válidos',
    });
  });

  it('una lista vacía es una respuesta: RRHH cerró todas y la página lo dice', () => {
    expect(leerVacantesRemotas({ version: 1, vacantes: [] }, ESTATICAS)).toEqual({ ok: true, vacantes: [] });
  });
});

describe('whatsappDesdeDigitos', () => {
  it('10 dígitos → le pone el 57; 12 ya con indicativo → tal cual; texto legible 3-3-4', () => {
    expect(whatsappDesdeDigitos('3108788754')).toEqual({ numero: '573108788754', texto: '310 878 8754' });
    expect(whatsappDesdeDigitos('573108788754')).toEqual({ numero: '573108788754', texto: '310 878 8754' });
    expect(whatsappDesdeDigitos('+57 310 878 8754')).toEqual({ numero: '573108788754', texto: '310 878 8754' });
  });

  it('lo que no tiene entre 10 y 13 dígitos no es un WhatsApp', () => {
    expect(whatsappDesdeDigitos('310 878')).toBeNull();
    expect(whatsappDesdeDigitos('')).toBeNull();
    expect(whatsappDesdeDigitos(null)).toBeNull();
    expect(whatsappDesdeDigitos('12345678901234')).toBeNull();
  });
});

describe('urlVacantes', () => {
  it('solo acepta una URL http(s)', () => {
    expect(urlVacantes({})).toBeNull();
    expect(urlVacantes({ [VARIABLE_URL]: '   ' })).toBeNull();
    expect(urlVacantes({ [VARIABLE_URL]: 'control360app.com/api' })).toBeNull();
    expect(urlVacantes({ [VARIABLE_URL]: ' https://control360app.com/api/talento/vacantes/dst ' })).toBe(
      'https://control360app.com/api/talento/vacantes/dst',
    );
  });
});

describe('resolverVacantes', () => {
  const env = { [VARIABLE_URL]: 'https://control360app.com/api/talento/vacantes/dst' };

  it('con Control360 sano, usa sus vacantes', async () => {
    const r = await resolverVacantes({ env, fetchFn: respuesta(REMOTO), estaticas: ESTATICAS });
    expect(r.fuente).toBe('control360');
    expect(r.vacantes).toHaveLength(2);
  });

  it('sin la variable, usa la lista estática sin salir a la red', async () => {
    let llamadas = 0;
    const fetchFn = (async () => { llamadas += 1; return new Response('{}'); }) as unknown as typeof fetch;
    const r = await resolverVacantes({ env: {}, fetchFn, estaticas: ESTATICAS });
    expect(r.fuente).toBe('estatica');
    expect(r.vacantes).toEqual(ESTATICAS);
    expect(llamadas).toBe(0);
  });

  it('con el secreto, el servidor pide ?fresco=1 con Bearer y sin caché; sin él, la URL tal cual', async () => {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const espia = (async (url: string, init: RequestInit) => {
      pedidos.push({ url: String(url), init });
      return new Response(JSON.stringify(REMOTO), { status: 200 });
    }) as unknown as typeof fetch;

    await resolverVacantes({ env: { ...env, [VARIABLE_SECRETO]: ' s3creto ' }, fetchFn: espia, estaticas: ESTATICAS });
    await resolverVacantes({ env, fetchFn: espia, estaticas: ESTATICAS });

    expect(pedidos[0].url).toBe('https://control360app.com/api/talento/vacantes/dst?fresco=1');
    expect((pedidos[0].init.headers as Record<string, string>).authorization).toBe('Bearer s3creto');
    expect(pedidos[0].init.cache).toBe('no-store');
    expect(pedidos[1].url).toBe('https://control360app.com/api/talento/vacantes/dst');
    expect(pedidos[1].init.headers).not.toHaveProperty('authorization');
  });

  it('pedidoVacantes respeta los parámetros que ya traiga la URL', () => {
    const p = pedidoVacantes('https://c360.test/api/x?a=1', { [VARIABLE_SECRETO]: 'k' });
    expect(p.url).toBe('https://c360.test/api/x?a=1&fresco=1');
  });

  it('Control360 sano con lista vacía: cero vacantes, no la lista estática', async () => {
    const vacio = await resolverVacantes({ env, fetchFn: respuesta({ version: 1, vacantes: [] }), estaticas: ESTATICAS });
    expect(vacio.fuente).toBe('control360');
    expect(vacio.vacantes).toEqual([]);
  });

  it('con la URL caída (503), con error de red o con JSON raro, cae a la estática', async () => {
    const caida = await resolverVacantes({ env, fetchFn: respuesta({ ok: false }, 503), estaticas: ESTATICAS });
    expect(caida.fuente).toBe('estatica');
    expect(caida.motivo).toContain('503');

    const sinRed = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const red = await resolverVacantes({ env, fetchFn: sinRed, estaticas: ESTATICAS });
    expect(red.fuente).toBe('estatica');
    expect(red.motivo).toContain('ECONNREFUSED');

    const raro = await resolverVacantes({ env, fetchFn: respuesta({ version: 1, vacantes: [{}] }), estaticas: ESTATICAS });
    expect(raro.fuente).toBe('estatica');
    expect(raro.vacantes).toEqual(ESTATICAS);
  });

  it('la lista estática que devuelve es una copia', async () => {
    const r = await resolverVacantes({ env: {}, estaticas: ESTATICAS });
    expect(r.vacantes).not.toBe(ESTATICAS);
  });
});

describe('cargosDe', () => {
  it('los cargos del formulario salen de la lista que se resolvió, más la espontánea al final', () => {
    const r = leerVacantesRemotas(REMOTO, ESTATICAS);
    if (!r.ok) throw new Error(r.motivo);
    expect(cargosDe(r.vacantes)).toEqual(['Vendedor TAT', 'Auxiliar de Bodega', CARGO_ESPONTANEO]);
  });
});
