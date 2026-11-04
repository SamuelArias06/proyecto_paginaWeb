/**
 * POST /api/empleos/diagnostico — el formulario de Empleos cuenta por qué no
 * pudo enviar una postulación.
 *
 * No guarda nada ni contesta nada: escribe una línea en el registro de Vercel y
 * responde `204`. El porqué, qué viaja y qué no, está en
 * src/lib/empleos/diagnostico.ts.
 *
 * Como toda función de este proyecto, SOLO existe en Vercel. Fuera (un `astro
 * preview`, el espejo estático) esta ruta no responde JSON y el aviso se pierde
 * sin consecuencias: el formulario lo manda sin esperar la respuesta.
 */
import type { APIRoute } from 'astro';
import type { Entorno } from '../../../lib/empleos/config';
import { atenderDiagnostico } from '../../../lib/empleos/diagnostico';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { estado } = await atenderDiagnostico(request, process.env as Entorno);
  return new Response(null, { status: estado, headers: { 'cache-control': 'no-store' } });
};

/** Cualquier otro método sobre esta ruta es un error, no un 404 confuso. */
export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { allow: 'POST' } });
