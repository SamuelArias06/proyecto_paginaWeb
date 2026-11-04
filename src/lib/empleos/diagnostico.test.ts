/**
 * Pruebas del testigo de fallos del formulario de Empleos.
 *
 * Lo que importa de este módulo es lo que NO hace: no se cree nada de lo que le
 * llega (el cuerpo lo escribe el navegador de cualquiera), no escribe en el
 * registro saltos de línea que partirían la entrada en dos, y no devuelve nunca
 * un error a una página que ya está enseñando un fallo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_BYTES_DIAGNOSTICO,
  atenderDiagnostico,
  sanearDiagnostico,
} from './diagnostico';
import type { Entorno } from './config';

const ENTORNO = {} as Entorno;

function peticion(cuerpo: string, ip = '10.0.0.1'): Request {
  return new Request('https://dstunja.com/api/empleos/diagnostico', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: cuerpo,
  });
}

let registrado: string[] = [];

beforeEach(() => {
  registrado = [];
  vi.spyOn(console, 'warn').mockImplementation((...partes: unknown[]) => {
    registrado.push(partes.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Saneado ----------------------------------------------------------------

describe('sanearDiagnostico', () => {
  it('deja pasar un aviso normal', () => {
    const d = sanearDiagnostico({
      paso: 'red',
      error: 'TypeError',
      mensaje: 'Failed to fetch',
      bytes: 2_600_000,
      intentos: 3,
      red: '3g',
      incrustado: 'Instagram',
      ua: 'Mozilla/5.0 (Linux; Android 13; wv)',
    });
    expect(d.paso).toBe('red');
    expect(d.error).toBe('TypeError');
    expect(d.bytes).toBe(2_600_000);
    expect(d.intentos).toBe(3);
  });

  it('un paso que no está en la lista se queda en «inesperado»', () => {
    expect(sanearDiagnostico({ paso: 'cualquier-cosa' }).paso).toBe('inesperado');
    expect(sanearDiagnostico({}).paso).toBe('inesperado');
    expect(sanearDiagnostico(null).paso).toBe('inesperado');
    expect(sanearDiagnostico('no soy un objeto').paso).toBe('inesperado');
  });

  it('los saltos de línea no pueden partir la entrada del registro', () => {
    const d = sanearDiagnostico({
      paso: 'red',
      mensaje: 'primera\n[empleos/postular] enviada {"falso":true}\nsegunda',
    });
    expect(d.mensaje).not.toContain('\n');
    expect(d.mensaje).toContain('primera');
  });

  it('recorta los textos largos y los números imposibles', () => {
    const d = sanearDiagnostico({
      paso: 'red',
      mensaje: 'x'.repeat(5000),
      ua: 'u'.repeat(5000),
      bytes: -5,
      intentos: 1e9,
    });
    expect(d.mensaje).toHaveLength(200);
    expect(d.ua).toHaveLength(200);
    expect(d.bytes).toBe(0);
    expect(d.intentos).toBe(99);
  });

  it('un número que llega como texto se entiende, y la basura vale 0', () => {
    expect(sanearDiagnostico({ bytes: '2048' }).bytes).toBe(2048);
    expect(sanearDiagnostico({ bytes: 'muchos' }).bytes).toBe(0);
    expect(sanearDiagnostico({ bytes: 12.9 }).bytes).toBe(12);
  });

  it('un objeto donde se esperaba texto no se cuela', () => {
    const d = sanearDiagnostico({ paso: 'red', mensaje: { raro: true }, ua: ['a'] });
    expect(d.mensaje).toBe('');
    expect(d.ua).toBe('');
  });
});

// --- El endpoint ------------------------------------------------------------

describe('atenderDiagnostico', () => {
  it('escribe UNA línea en el registro y responde 204', async () => {
    const respuesta = await atenderDiagnostico(
      peticion(JSON.stringify({ paso: 'red', error: 'TypeError', bytes: 2_600_000 })),
      ENTORNO,
    );
    expect(respuesta.estado).toBe(204);
    expect(registrado).toHaveLength(1);
    expect(registrado[0]).toContain('[empleos/diagnostico]');
    expect(registrado[0]).toContain('"paso":"red"');
    expect(registrado[0]).toContain('"bytes":2600000');
  });

  it('un cuerpo que no es JSON no escribe nada, y tampoco falla', async () => {
    const respuesta = await atenderDiagnostico(peticion('esto no es json'), ENTORNO);
    expect(respuesta.estado).toBe(204);
    expect(respuesta.linea).toBeNull();
    expect(registrado).toHaveLength(0);
  });

  it('un cuerpo vacío no escribe nada', async () => {
    const respuesta = await atenderDiagnostico(peticion(''), ENTORNO);
    expect(respuesta.estado).toBe(204);
    expect(registrado).toHaveLength(0);
  });

  it('un cuerpo demasiado grande se descarta sin leerlo como JSON', async () => {
    const grande = JSON.stringify({ paso: 'red', mensaje: 'x'.repeat(MAX_BYTES_DIAGNOSTICO) });
    const respuesta = await atenderDiagnostico(peticion(grande), ENTORNO);
    expect(respuesta.estado).toBe(204);
    expect(registrado).toHaveLength(0);
  });

  /*
   * El registro de Vercel no es un sitio donde nadie pueda escribir lo que
   * quiera: con un límite por IP, llenarlo de ruido cuesta más que un bucle.
   */
  it('hay un límite por IP, y al pasarlo deja de escribir', async () => {
    const cuerpo = JSON.stringify({ paso: 'red' });
    for (let i = 0; i < 12; i += 1) {
      await atenderDiagnostico(peticion(cuerpo, '10.0.0.9'), ENTORNO);
    }
    expect(registrado).toHaveLength(12);

    const pasado = await atenderDiagnostico(peticion(cuerpo, '10.0.0.9'), ENTORNO);
    expect(pasado.estado).toBe(204);
    expect(pasado.linea).toBeNull();
    expect(registrado).toHaveLength(12);
  });

  it('el límite es por IP: otra IP sigue pudiendo avisar', async () => {
    const cuerpo = JSON.stringify({ paso: 'red' });
    for (let i = 0; i < 13; i += 1) {
      await atenderDiagnostico(peticion(cuerpo, '10.0.0.10'), ENTORNO);
    }
    const otra = await atenderDiagnostico(peticion(cuerpo, '10.0.0.11'), ENTORNO);
    expect(otra.linea).not.toBeNull();
  });
});
