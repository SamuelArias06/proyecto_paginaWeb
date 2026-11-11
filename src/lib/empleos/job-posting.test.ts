import { describe, expect, it } from 'vitest';
import { vacantes as estaticas, type Vacante } from '../../data/vacantes';
import { descripcionHtml, esEmpleo, hoyEnColombia, jobPosting, tipoEmpleo } from './job-posting';
import { leerVacantesRemotas } from './vacantes-fuente';

const OPCIONES = {
  url: 'https://dstunja.com/empleos/vendedor-tat/',
  logo: 'https://dstunja.com/logo-distribuciones.png',
  ahora: new Date('2026-10-10T03:00:00Z'), // 9 de octubre en Colombia
};

const base: Vacante = {
  slug: 'vendedor-tat',
  cargo: 'Vendedor TAT',
  ciudad: 'Tunja, Boyacá',
  tipo: 'Tiempo completo',
  resumen: 'Atiende la ruta de tiendas.',
  imagen: '',
  descripcion: ['Buscamos personas con actitud <comercial> & ganas.'],
  requisitos: ['Mínimo 1 año de experiencia'],
  funciones: ['Toma de pedidos'],
};

describe('esEmpleo', () => {
  it('excluye la convocatoria de vehículos (slug, cargo o tipo)', () => {
    expect(esEmpleo({ slug: 'buscamos-vehiculos', cargo: 'Buscamos Vehículos', tipo: 'Convocatoria abierta' })).toBe(false);
    expect(esEmpleo({ slug: 'flota', cargo: 'Vincula tu vehículo', tipo: 'Otro' })).toBe(false);
    expect(esEmpleo({ slug: 'otra', cargo: 'Algo', tipo: 'Convocatoria abierta' })).toBe(false);
  });

  it('acepta los cargos normales', () => {
    expect(esEmpleo(base)).toBe(true);
    expect(esEmpleo({ slug: 'practicante-sistemas', cargo: 'Practicante de Sistemas', tipo: 'Práctica / pasantía' })).toBe(true);
  });

  it('en la lista estática solo "buscamos-vehiculos" queda fuera', () => {
    const fuera = estaticas.filter((v) => !esEmpleo(v)).map((v) => v.slug);
    expect(fuera).toEqual(['buscamos-vehiculos']);
  });
});

describe('tipoEmpleo', () => {
  it('mapea los tipos de Control360 a employmentType', () => {
    expect(tipoEmpleo('Tiempo completo')).toBe('FULL_TIME');
    expect(tipoEmpleo('Práctica / pasantía')).toBe('INTERN');
    expect(tipoEmpleo('Medio tiempo')).toBe('PART_TIME');
    expect(tipoEmpleo('Temporal')).toBe('TEMPORARY');
    expect(tipoEmpleo('Prestación de servicios')).toBe('CONTRACTOR');
    expect(tipoEmpleo('Por días')).toBe('PER_DIEM');
    expect(tipoEmpleo('Algo raro')).toBe('OTHER');
  });
});

describe('jobPosting', () => {
  it('arma la ficha completa de una vacante de Tunja', () => {
    const j = jobPosting(base, OPCIONES)!;
    expect(j['@context']).toBe('https://schema.org');
    expect(j['@type']).toBe('JobPosting');
    expect(j.title).toBe('Vendedor TAT');
    expect(j.employmentType).toBe('FULL_TIME');
    expect(j.datePosted).toBe('2026-10-09');
    expect(j).not.toHaveProperty('validThrough');
    expect(j.url).toBe(OPCIONES.url);
    expect(j.hiringOrganization).toEqual({
      '@type': 'Organization',
      name: 'Distribuciones Santiago de Tunja S.A.S.',
      sameAs: 'https://dstunja.com',
      logo: OPCIONES.logo,
    });
    expect(j.jobLocation).toEqual({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Cra 2 Este #58-79',
        addressLocality: 'Tunja',
        addressRegion: 'Boyacá',
        addressCountry: 'CO',
      },
    });
  });

  it('usa las fechas de Control360 cuando llegan', () => {
    const j = jobPosting({ ...base, publicada: '2026-10-01T12:00:00.000Z', vence: '2026-11-01T00:00:00.000Z' }, OPCIONES)!;
    expect(j.datePosted).toBe('2026-10-01');
    expect(j.validThrough).toBe('2026-11-01T00:00:00.000Z');
    expect(jobPosting({ ...base, actualizada: '2026-09-20T00:00:00.000Z' }, OPCIONES)!.datePosted).toBe('2026-09-20');
  });

  it('fuera de Tunja usa la ciudad y el departamento de la vacante', () => {
    const j = jobPosting({ ...base, ciudad: 'Barbosa, Santander' }, OPCIONES)!;
    expect(j.jobLocation).toEqual({
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: 'Barbosa', addressRegion: 'Santander', addressCountry: 'CO' },
    });
  });

  it('con varias zonas emite una ubicación por municipio', () => {
    const j = jobPosting({ ...base, zonas: ['Tunja, Boyacá', 'Chiquinquirá, Boyacá', 'Barbosa, Santander'] }, OPCIONES)!;
    expect(Array.isArray(j.jobLocation)).toBe(true);
    expect(j.jobLocation).toEqual([
      {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Cra 2 Este #58-79',
          addressLocality: 'Tunja',
          addressRegion: 'Boyacá',
          addressCountry: 'CO',
        },
      },
      {
        '@type': 'Place',
        address: { '@type': 'PostalAddress', addressLocality: 'Chiquinquirá', addressRegion: 'Boyacá', addressCountry: 'CO' },
      },
      {
        '@type': 'Place',
        address: { '@type': 'PostalAddress', addressLocality: 'Barbosa', addressRegion: 'Santander', addressCountry: 'CO' },
      },
    ]);
  });

  it('con una sola zona sigue siendo un lugar, no una lista', () => {
    const j = jobPosting({ ...base, zonas: ['Tunja, Boyacá'] }, OPCIONES)!;
    expect(Array.isArray(j.jobLocation)).toBe(false);
  });

  it('no emite nada para "buscamos-vehiculos"', () => {
    const vehiculos = estaticas.find((v) => v.slug === 'buscamos-vehiculos')!;
    expect(vehiculos).toBeDefined();
    expect(jobPosting(vehiculos, OPCIONES)).toBeNull();
  });

  it('la descripción es HTML con el texto escapado', () => {
    const html = descripcionHtml(base);
    expect(html).toContain('<p>Buscamos personas con actitud &lt;comercial&gt; &amp; ganas.</p>');
    expect(html).toContain('<strong>Requisitos</strong></p><ul><li>Mínimo 1 año de experiencia</li></ul>');
    expect(html).toContain('<strong>Funciones principales</strong>');
    expect(html).not.toContain('Habilidades deseables');
  });

  it('es JSON serializable y válido', () => {
    const j = jobPosting(base, OPCIONES);
    expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  });
});

describe('fechas de Control360', () => {
  it('lee publicada y vence (o sus alias) y descarta lo que no es fecha', () => {
    const r = leerVacantesRemotas({
      version: 1,
      vacantes: [
        { slug: 'a', cargo: 'A', publicada: '2026-10-01', vence: '2026-10-31' },
        { slug: 'b', cargo: 'B', creada: '2026-09-15T10:00:00Z', cierre: 'pronto' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vacantes[0].publicada).toBe('2026-10-01T00:00:00.000Z');
    expect(r.vacantes[0].vence).toBe('2026-10-31T00:00:00.000Z');
    expect(r.vacantes[1].publicada).toBe('2026-09-15T10:00:00.000Z');
    expect(r.vacantes[1]).not.toHaveProperty('vence');
  });
});

describe('hoyEnColombia', () => {
  it('usa la fecha de Bogotá, no la UTC', () => {
    expect(hoyEnColombia(new Date('2026-10-10T04:59:00Z'))).toBe('2026-10-09');
    expect(hoyEnColombia(new Date('2026-10-10T05:00:00Z'))).toBe('2026-10-10');
  });
});
