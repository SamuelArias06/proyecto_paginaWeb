/**
 * Pruebas del RELOJ de un intento de correo.
 *
 * Van en un archivo aparte porque el `vi.mock('resend')` que hace falta aquí
 * —uno que se cuelga a propósito— vale para todo el archivo, y mezclarlo con
 * las pruebas del camino normal escondería qué está simulado en cada caso.
 *
 * QUÉ SE PROTEGE. El SDK de Resend no acepta un timeout, así que una llamada
 * colgada se quedaba colgada y los únicos segundos que la cortaban eran los de
 * la función de Vercel. Cuando esos se agotan, Vercel responde 504 y NADA del
 * código posterior corre: en particular `ponerASalvo` (./postular.ts), que es
 * quien guarda la hoja de vida en el Blob cuando el correo no sale. O sea que
 * Resend lento costaba la postulación entera, que es justo lo que esa red de
 * seguridad existe para evitar. Con el reloj, el intento falla rápido, se
 * reintenta, y si no hay manera la postulación acaba guardada.
 */
import { describe, expect, it, vi } from 'vitest';

/** Si está puesto, `send` no resuelve nunca: simula a Resend colgado. */
let colgado = false;
/** Cuántas veces se llamó a `send`. */
let llamadas = 0;

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async () => {
        llamadas += 1;
        if (colgado) return new Promise(() => {});
        return { data: { id: 'correo-de-prueba' }, error: null };
      },
    };
  },
}));

const { ESPERA_CORREO_MS, INTENTOS_CORREO, enviarCorreoPostulacion, enviarConReintentos } =
  await import('./correo');
const env = { RESEND_API_KEY: 're_prueba' };

const bytes = new TextEncoder().encode('%PDF-1.4 hoja de vida de prueba');
const datos = {
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
  vacanteSlug: null,
  respuestas: [],
} as unknown as Parameters<typeof enviarCorreoPostulacion>[0];

/** Las pausas entre reintentos no se esperan de verdad. */
const SIN_ESPERA = async () => {};

describe('el reloj de un intento', () => {
  it('por defecto son ocho segundos, los mismos que Control360', () => {
    expect(ESPERA_CORREO_MS).toBe(8000);
  });

  it('Resend colgado NO cuelga el intento: falla y dice por qué', async () => {
    colgado = true;
    llamadas = 0;

    const r = await enviarCorreoPostulacion(datos, env, new Date(), { esperaMs: 20 });

    expect(r.ok).toBe(false);
    // El motivo nombra el reloj, para distinguirlo de un rechazo de Resend.
    expect(r.error).toContain('no respondió');
    expect(llamadas).toBe(1);
  });

  it('colgado en todos los intentos, se agotan y se devuelve el fallo (no se cuelga)', async () => {
    colgado = true;
    llamadas = 0;

    const r = await enviarConReintentos(datos, env, { esperaMs: 20 }, new Date(), SIN_ESPERA);

    expect(r.ok).toBe(false);
    expect(r.intentos).toBe(INTENTOS_CORREO);
    // Lo que importa: la función VUELVE. Antes se quedaba esperando hasta que
    // Vercel la cortaba con un 504, y entonces el respaldo no llegaba a correr.
    expect(llamadas).toBe(INTENTOS_CORREO);
  });

  it('si Resend responde a tiempo, el reloj no estorba', async () => {
    colgado = false;
    llamadas = 0;

    const r = await enviarConReintentos(datos, env, { esperaMs: 20 }, new Date(), SIN_ESPERA);

    expect(r.ok).toBe(true);
    expect(r.intentos).toBe(1);
    expect(llamadas).toBe(1);
  });
});
