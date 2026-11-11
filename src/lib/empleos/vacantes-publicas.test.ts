/**
 * Pruebas de la vista pública de las vacantes (src/lib/empleos/vacantes-publicas.ts),
 * que alimenta el JSON que lee Control360.
 *
 * Lo que más importa es que no se cuele nada que no se decidió publicar: ni la
 * imagen del flyer ni ningún campo nuevo que se agregue a `Vacante` mañana.
 */
import { describe, expect, it } from 'vitest';
import { vacantes, type Vacante } from '../../data/vacantes';
import { CAMPOS_PUBLICOS, vacantePublica, vacantesPublicas } from './vacantes-publicas';

/** Una vacante con todos los campos opcionales llenos, para ver qué se descarta. */
const COMPLETA: Vacante = {
  slug: 'prueba',
  cargo: 'Cargo de prueba',
  ciudad: 'Tunja, Boyacá',
  zonas: ['Tunja, Boyacá', 'Barbosa, Santander'],
  tipo: 'Tiempo completo',
  resumen: 'Resumen.',
  imagen: '/img/empleos/prueba.jpeg',
  descripcion: ['Párrafo.'],
  requisitos: ['Requisito.'],
  funciones: ['Función.'],
  habilidades: ['Habilidad.'],
  ofrecemos: ['Beneficio.'],
  whatsappExtra: { numero: '573000000000', texto: '300 000 0000' },
};

describe('vacantePublica', () => {
  it('deja exactamente los campos permitidos', () => {
    expect(Object.keys(vacantePublica(COMPLETA)).sort()).toEqual([...CAMPOS_PUBLICOS].sort());
  });

  it('publica las zonas, y [] cuando la vacante tiene una sola sede', () => {
    expect(vacantePublica(COMPLETA).zonas).toEqual(['Tunja, Boyacá', 'Barbosa, Santander']);
    const { zonas: _sinZonas, ...sinZonas } = COMPLETA;
    expect(vacantePublica(sinZonas).zonas).toEqual([]);
  });

  it('usa [] cuando la vacante no tiene funciones', () => {
    const { funciones: _sinFunciones, ...sinFunciones } = COMPLETA;
    expect(vacantePublica(sinFunciones).funciones).toEqual([]);
  });

  it('no deja salir imágenes ni URLs', () => {
    const texto = JSON.stringify(vacantePublica(COMPLETA));
    expect(texto).not.toContain('imagen');
    expect(texto).not.toContain('/img/');
    expect(texto).not.toMatch(/https?:\/\//);
    expect(texto).not.toContain('573000000000');
  });
});

describe('vacantesPublicas con los datos reales', () => {
  const cuerpo = vacantesPublicas(vacantes);

  it('lleva versión 1 y una entrada por vacante', () => {
    expect(cuerpo.version).toBe(1);
    expect(cuerpo.vacantes).toHaveLength(vacantes.length);
  });

  it('respeta el orden de src/data/vacantes.ts', () => {
    expect(cuerpo.vacantes.map((v) => v.slug)).toEqual(vacantes.map((v) => v.slug));
  });

  it('cada vacante tiene exactamente los campos permitidos y funciones es arreglo', () => {
    for (const v of cuerpo.vacantes) {
      expect(Object.keys(v).sort()).toEqual([...CAMPOS_PUBLICOS].sort());
      expect(Array.isArray(v.funciones)).toBe(true);
    }
  });

  it('ninguna vacante filtra imágenes ni URLs', () => {
    const texto = JSON.stringify(cuerpo);
    expect(texto).not.toContain('imagen');
    expect(texto).not.toContain('/img/');
    expect(texto).not.toMatch(/https?:\/\//);
  });
});
