// PRUEBAS DEL ENVÍO A CONTROL360 — firma, cuerpo, apagado y fallos que no rompen nada.
//
// Por qué existe: si la firma o el nombre de un campo no coinciden con lo que espera Control360,
//   las postulaciones se rechazan allá en silencio y el correo sigue llegando, así que nadie lo
//   notaría. Estas pruebas fijan el contrato.
// Dónde corre: vitest (npm test), sin red: fetch se reemplaza.
// Cuidados: el vector de la firma se calculó con el HMAC de Python, no con el de Node, para que la
//   prueba no se compare consigo misma.

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AUTORIZACION_SHA256, AUTORIZACION_TEXTO, AUTORIZACION_VERSION } from './autorizacion';
import {
  CABECERA_FIRMA,
  CABECERA_TIMESTAMP,
  configControl360,
  cuerpoParaControl360,
  enviarAControl360,
  firmar,
} from './control360';
import type { PostulacionValidada } from './postulacion';

const bytes = new TextEncoder().encode('%PDF-1.4 hoja de vida de prueba');
const datos: PostulacionValidada = {
  nombre: 'Ana Prueba',
  correo: 'ana@example.com',
  telefono: '3001234567',
  municipio: 'Tunja',
  cargo: 'Vendedor TAT',
  experiencia: '',
  autorizacion: true,
  turnstileToken: 'tok',
  sinVerificar: false,
  codigoTurnstile: '',
  idEnvio: '',
  hojaDeVida: {
    nombreOriginal: 'hoja de vida.pdf',
    nombreSeguro: 'hoja-de-vida.pdf',
    mime: 'application/pdf',
    extension: '.pdf',
    tamano: bytes.length,
    bytes,
  },
};
const env = { C360_POSTULACIONES_URL: 'https://c360.example/api/talento/postulaciones/dst', C360_POSTULACIONES_SECRET: 's3' };

describe('la firma', () => {
  it('coincide con un HMAC calculado aparte (Python): `timestamp.` + cuerpo, en hexadecimal', () => {
    expect(firmar('secreto-de-prueba', '1760000000', '{"a":1}')).toBe(
      '93f654e8860243b6fdebe7a47ce0f51d4816d53afb85c525715c3e4b945ac73b',
    );
  });
});

describe('el cuerpo', () => {
  it('lleva exactamente los campos que lee Control360', () => {
    const c = JSON.parse(cuerpoParaControl360(datos, 'id-1'));
    expect(Object.keys(c).sort()).toEqual(
      ['archivo', 'autorizacion', 'autorizacionVersion', 'cargo', 'correo', 'envioId', 'experiencia', 'municipio', 'nombre', 'telefono'].sort(),
    );
    expect(c.autorizacion).toBe(true);
    expect(c.autorizacionVersion).toBe(AUTORIZACION_VERSION);
    expect(c.experiencia).toBeNull();
    expect(Buffer.from(c.archivo.base64, 'base64')).toEqual(Buffer.from(bytes));
    expect(c.archivo.nombre).toBe('hoja de vida.pdf');
  });
});

describe('apagado por defecto', () => {
  it('sin las dos variables no envía nada', async () => {
    const fetchImpl = vi.fn();
    expect(configControl360({ C360_POSTULACIONES_URL: 'https://x' })).toBeNull();
    expect(await enviarAControl360(datos, {}, { fetchImpl })).toEqual({ resultado: 'apagado' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('el envío', () => {
  it('firma lo mismo que manda, con el timestamp en segundos', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }));
    const r = await enviarAControl360(datos, env, { fetchImpl, ahoraSeg: 1760000000, envioId: 'id-2' });
    expect(r).toEqual({ resultado: 'aceptada', estado: 201 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const cab = init.headers as Record<string, string>;
    expect(url).toBe(env.C360_POSTULACIONES_URL);
    expect(cab[CABECERA_TIMESTAMP]).toBe('1760000000');
    expect(cab[CABECERA_FIRMA]).toBe(firmar('s3', '1760000000', init.body as string));
  });

  it('un rechazo de Control360 vuelve como resultado, no como excepción', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await enviarAControl360(datos, env, { fetchImpl })).toEqual({ resultado: 'rechazada', estado: 401 });
  });

  it('si la red falla o tarda demasiado, tampoco lanza', async () => {
    const red = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await enviarAControl360(datos, env, { fetchImpl: red })).toEqual({ resultado: 'error', detalle: 'red' });
    const lenta = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, rechazar) => {
      init?.signal?.addEventListener('abort', () => rechazar(Object.assign(new Error('abortado'), { name: 'AbortError' })));
    }));
    expect(await enviarAControl360(datos, env, { fetchImpl: lenta as unknown as typeof fetch, esperaMs: 20 })).toEqual({
      resultado: 'error',
      detalle: 'tiempo-agotado',
    });
  });
});

describe('el texto de autorización', () => {
  it('sigue siendo el que Control360 tiene registrado con su versión', () => {
    expect(createHash('sha256').update(AUTORIZACION_TEXTO, 'utf8').digest('hex')).toBe(AUTORIZACION_SHA256);
  });

  it('es la v2 de octubre de 2026, con la huella que Control360 publicó para ella', () => {
    // La huella va CLAVADA aquí también: si alguien cambia la constante y el texto a la vez,
    // la prueba de arriba seguiría pasando y esta no.
    expect(AUTORIZACION_VERSION).toBe('v2-2026-10');
    expect(AUTORIZACION_SHA256).toBe('e1e950999901f0bb848f4594da01289f372f6985078fb9c5373f5dd7d79e62d8');
  });

  it('cubre lo que la v1 no decía', () => {
    expect(AUTORIZACION_TEXTO).toContain('DISTRIBUCIONES SANTIAGO DE TUNJA S.A.S, NIT 900.417.808-1');
    expect(AUTORIZACION_TEXTO).toContain('proveedores tecnológicos ubicados fuera de Colombia');
    expect(AUTORIZACION_TEXTO).toContain('La decisión final siempre la toma una persona de Talento Humano.');
    expect(AUTORIZACION_TEXTO).toContain('ghsantiagodetunja@gmail.com');
    expect(AUTORIZACION_TEXTO).toContain('dos (2) años');
    expect(AUTORIZACION_TEXTO).toContain('dstunja.com/privacidad');
  });
});
