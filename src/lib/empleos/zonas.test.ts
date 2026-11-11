/**
 * Pruebas de las zonas de una vacante (src/lib/empleos/zonas.ts).
 *
 * Lo que importa: que una vacante de una sola sede se siga viendo EXACTAMENTE
 * igual que antes («Tunja, Boyacá»), y que la de varias diga los tres
 * municipios tanto en la tarjeta como en el detalle.
 */
import { describe, expect, it } from 'vitest';
import { vacantePorSlug } from '../../data/vacantes';
import { listaEnEspanol, municipiosDeZonas, sedeEntreZonas, textoUbicacion } from './zonas';

describe('municipiosDeZonas', () => {
  it('se queda con el municipio y descarta el departamento', () => {
    expect(municipiosDeZonas(['Tunja, Boyacá', 'Barbosa, Santander'])).toEqual(['Tunja', 'Barbosa']);
  });

  it('ignora vacías y repetidas (aunque cambien tildes o mayúsculas)', () => {
    expect(municipiosDeZonas(['Tunja, Boyacá', '  ', 'TUNJA', 'Chiquinquira', 'Chiquinquirá'])).toEqual([
      'Tunja',
      'Chiquinquira',
    ]);
  });

  it('sin zonas es una lista vacía', () => {
    expect(municipiosDeZonas(undefined)).toEqual([]);
  });
});

describe('listaEnEspanol', () => {
  it('une con comas y una "y" al final', () => {
    expect(listaEnEspanol(['Tunja'])).toBe('Tunja');
    expect(listaEnEspanol(['Tunja', 'Barbosa'])).toBe('Tunja y Barbosa');
    expect(listaEnEspanol(['Tunja', 'Chiquinquirá', 'Barbosa'])).toBe('Tunja, Chiquinquirá y Barbosa');
  });
});

describe('textoUbicacion', () => {
  it('sin zonas muestra la sede tal cual', () => {
    expect(textoUbicacion({ ciudad: 'Tunja, Boyacá' })).toBe('Tunja, Boyacá');
  });

  it('con una sola zona también: no se pierde el departamento', () => {
    expect(textoUbicacion({ ciudad: 'Barbosa, Santander', zonas: ['Barbosa, Santander'] })).toBe('Barbosa, Santander');
  });

  it('con varias zonas nombra los municipios', () => {
    expect(
      textoUbicacion({
        ciudad: 'Tunja, Boyacá',
        zonas: ['Tunja, Boyacá', 'Chiquinquirá, Boyacá', 'Barbosa, Santander'],
      }),
    ).toBe('Tunja, Chiquinquirá y Barbosa');
  });
});

describe('sedeEntreZonas', () => {
  const ZONAS = ['Tunja, Boyacá', 'Chiquinquirá, Boyacá', 'Barbosa, Santander'];

  it('reconoce la sede aunque venga con departamento, sin tildes o en mayúsculas', () => {
    expect(sedeEntreZonas('Tunja, Boyacá', ZONAS)).toBe(true);
    expect(sedeEntreZonas('CHIQUINQUIRA', ZONAS)).toBe(true);
    expect(sedeEntreZonas('Barbosa', ZONAS)).toBe(true);
  });

  it('una sede de otro municipio no está entre las zonas', () => {
    expect(sedeEntreZonas('Duitama, Boyacá', ZONAS)).toBe(false);
  });

  it('sin zonas o sin sede, no hay nada que heredar', () => {
    expect(sedeEntreZonas('Tunja, Boyacá', undefined)).toBe(false);
    expect(sedeEntreZonas('', ZONAS)).toBe(false);
  });
});

describe('la vacante real de Vendedor TAT', () => {
  const vacante = vacantePorSlug('vendedor-tat')!;

  it('está abierta en Tunja, Chiquinquirá y Barbosa', () => {
    expect(textoUbicacion(vacante)).toBe('Tunja, Chiquinquirá y Barbosa');
  });

  it('conserva Tunja como sede, que es lo que mira la pregunta de traslado', () => {
    expect(vacante.ciudad).toBe('Tunja, Boyacá');
  });
});
