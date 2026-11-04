/**
 * Turnstile en el navegador.
 *
 * Un token de Turnstile es de UN SOLO USO y el formulario necesita varios: uno
 * por cada archivo que sube (cada `upload()` llama a /api/pqrs/token) y otro
 * para la radicación en /api/pqrs. Por eso el widget se monta en modo
 * `execution: 'execute'`, que no resuelve nada hasta que se le pide, y
 * `tokenTurnstile()` hace reset y vuelve a ejecutarlo cada vez.
 *
 * Con `appearance: 'interaction-only'` el recuadro solo se ve si Cloudflare
 * decide que hace falta una interacción; en el caso normal la persona no ve
 * nada y el formulario no cambia de aspecto.
 *
 * CUANDO CLOUDFLARE PIDE INTERACCIÓN, EL RELOJ SE PARA. Hubo un tope único de
 * 30 segundos desde que se pedía el token. Si Cloudflare decidía que hacía
 * falta marcar la casilla, ese tope seguía corriendo mientras la persona la
 * buscaba, y al vencer el formulario de Empleos daba el fallo por "no hay
 * función" y abría el `mailto:` SIN llamar a la API: en producción ni Vercel ni
 * Resend registraban nada. Ahora `before-interactive-callback` cambia el tope
 * corto por uno largo y avisa a quien pidió el token (`alPedirInteraccion`),
 * para que la página diga qué hay que hacer.
 *
 * LOS FALLOS LLEVAN MOTIVO (`ErrorTurnstile.motivo`), porque no todos piden lo
 * mismo: si el script de Cloudflare no cargó (un adblock, una red corporativa)
 * no hay forma de pasar la comprobación desde esta página; si la comprobación
 * falló o caducó, basta con volver a intentarlo.
 *
 * Y VOLVER A INTENTARLO LO HACE LA LIBRERÍA, no la persona. Un reto que falla
 * una vez (el 600010 y los demás códigos de la familia 600xxx son fallos de
 * ejecución del reto en el navegador) suele pasar al segundo intento con el
 * widget reiniciado. Antes eso se le pedía al candidato —«vuelve a pulsar
 * Enviar»— y muchos no volvían. Ahora `tokenTurnstile()` reinicia el widget y
 * reintenta una vez sola antes de rendirse. Lo heredan los tres formularios
 * que usan este módulo: Empleos, PQRS y Contacto administrativo.
 *
 * CADA FALLO TIENE UN CÓDIGO CORTO Y VISIBLE (`codigoVisible`), del estilo
 * «T-110200». No es para depurar: es para que un candidato que manda una
 * captura de pantalla nos diga la causa sin tener que abrir la consola.
 */

interface ApiTurnstile {
  render: (
    contenedor: HTMLElement,
    opciones: Record<string, unknown>,
  ) => string | undefined;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
    /** La llama el script de Cloudflare al terminar de cargar. */
    alTurnstileListo?: () => void;
  }
}

/**
 * Por qué no se obtuvo el token.
 *
 * - `no-cargo`: el script de Cloudflare no cargó o el widget no se montó. No
 *   hay manera de pasar la comprobación desde esta página.
 * - `fallo`: Cloudflare respondió con un error (`codigo` trae el suyo, por
 *   ejemplo 110200 si el dominio no está autorizado en el widget).
 * - `caducado`: la verificación interactiva o el token caducaron.
 * - `tiempo`: no llegó respuesta dentro del tope.
 * - `reemplazado`: se pidió otro token antes de que llegara este.
 */
export type MotivoTurnstile = 'no-cargo' | 'fallo' | 'caducado' | 'tiempo' | 'reemplazado';

export class ErrorTurnstile extends Error {
  constructor(
    readonly motivo: MotivoTurnstile,
    mensaje: string,
    readonly codigo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorTurnstile';
  }
}

/** Cuánto se espera un token cuando Cloudflare lo resuelve sin interacción. */
const ESPERA_MAXIMA_MS = 30_000;

/**
 * Cuánto se espera, a partir de que aparece la casilla, a que la persona la
 * marque. Cloudflare avisa antes con `timeout-callback` si su propio plazo
 * vence; este tope solo evita un botón en "Enviando…" para siempre si nunca
 * llegara ninguna respuesta.
 */
const ESPERA_INTERACCION_MS = 5 * 60_000;

/**
 * Cuántas veces se pide el token antes de rendirse. Dos: el original y un
 * reintento con el widget reiniciado.
 *
 * No más: cada intento que falla cuesta segundos de espera con el botón en
 * «Enviando…», y si el segundo tampoco pasa es que el problema no es pasajero
 * (el dominio no está autorizado, el WebView no soporta el reto). A partir de
 * ahí lo que sirve es seguir sin token, no insistir.
 */
const INTENTOS_TOKEN = 2;

/** Pausa entre el fallo y el reintento, para no repetir dentro del mismo hipo. */
const PAUSA_REINTENTO_MS = 600;

/**
 * Motivos que merecen un segundo intento.
 *
 * `no-cargo` no está: sin widget montado no hay nada que reiniciar. Tampoco
 * `reemplazado`, que significa que otro envío pidió un token después de este y
 * reintentar sería pelearse con él.
 */
const MOTIVOS_REINTENTABLES = new Set<MotivoTurnstile>(['fallo', 'caducado', 'tiempo']);

/** Abreviaturas para el código visible cuando Cloudflare no dio uno suyo. */
const ABREVIATURA: Record<MotivoTurnstile, string> = {
  'no-cargo': 'CARGA',
  fallo: 'FALLO',
  caducado: 'CADUCO',
  tiempo: 'ESPERA',
  reemplazado: 'REPETIDO',
};

/**
 * Código corto para enseñar en pantalla: «T-110200», «T-CARGA».
 *
 * Cuando Cloudflare da su propio número se usa ese, que es el que permite mirar
 * su tabla de códigos (110200 = el dominio no está autorizado en el widget,
 * 600010 = el reto no se pudo ejecutar en ese navegador). Si no, va la
 * abreviatura del motivo, que al menos distingue «no cargó el script» de «el
 * reto caducó».
 */
export function codigoVisible(fallo: ErrorTurnstile): string {
  const codigo = fallo.codigo?.trim();
  if (codigo && /^[A-Za-z0-9_-]{1,20}$/.test(codigo)) return `T-${codigo}`;
  return `T-${ABREVIATURA[fallo.motivo]}`;
}

function esperar(ms: number): Promise<void> {
  return new Promise((listo) => setTimeout(listo, ms));
}

export interface OpcionesToken {
  /** Se llama cuando Cloudflare enseña la casilla y hay que marcarla. */
  alPedirInteraccion?: () => void;
}

interface Pendiente {
  resolver: (token: string) => void;
  rechazar: (fallo: ErrorTurnstile) => void;
  pedirInteraccion: () => void;
}

let idWidget: string | null = null;
let cargado: Promise<void> | null = null;
let pendiente: Pendiente | null = null;

function resolverPendiente(token: string) {
  const actual = pendiente;
  pendiente = null;
  actual?.resolver(token);
}

function rechazarPendiente(fallo: ErrorTurnstile) {
  const actual = pendiente;
  pendiente = null;
  actual?.rechazar(fallo);
}

/**
 * Monta el widget. Se resuelve cuando Cloudflare ha cargado y el widget existe.
 *
 * Si el script de Cloudflare está bloqueado (un adblock, una red corporativa)
 * la promesa se rechaza con motivo `no-cargo` y quien llama decide: los
 * formularios caen al respaldo por correo en vez de dejar a la persona sin
 * poder escribir.
 */
export function prepararTurnstile(contenedor: HTMLElement, sitekey: string): Promise<void> {
  if (cargado) return cargado;

  const intento = new Promise<void>((resolver, rechazar) => {
    const montar = () => {
      if (!window.turnstile) {
        rechazar(new ErrorTurnstile('no-cargo', 'Turnstile no cargó.'));
        return;
      }
      /*
       * `render` PUEDE LANZAR, y lo que lance no es un ErrorTurnstile.
       *
       * Es código de Cloudflare corriendo en un navegador cualquiera: en un
       * WebView viejo, con el iframe bloqueado o con la API a medio cargar,
       * `render` tira una excepción suya. Sin este try, esa excepción salía de
       * aquí tal cual, los formularios no la reconocían como fallo de Turnstile
       * y la trataban como un fallo de RED: el candidato veía «no pudimos
       * conectar con el servidor» y SU POSTULACIÓN NO SALÍA. Convertida en
       * `no-cargo`, el envío sigue adelante sin verificar, que es lo que
       * siempre quiso este módulo.
       */
      try {
        idWidget =
          window.turnstile.render(contenedor, {
          sitekey,
          execution: 'execute',
          appearance: 'interaction-only',
          language: 'es',
          retry: 'never',
            callback: (token: string) => resolverPendiente(token),
            'before-interactive-callback': () => pendiente?.pedirInteraccion(),
            'error-callback': (codigo?: unknown) => {
              // El código va a la consola: es lo único que dice, por ejemplo,
              // que el dominio no está autorizado en el widget de Cloudflare.
              console.warn('[turnstile] error', codigo);
              rechazarPendiente(
                new ErrorTurnstile('fallo', 'La comprobación antirrobots falló.', String(codigo ?? '')),
              );
              return true;
            },
            'timeout-callback': () =>
              rechazarPendiente(
                new ErrorTurnstile('caducado', 'La verificación de seguridad no se completó a tiempo.'),
              ),
            'expired-callback': () =>
              rechazarPendiente(new ErrorTurnstile('caducado', 'La comprobación antirrobots caducó.')),
          }) ?? null;
      } catch (fallo) {
        console.warn('[turnstile] render lanzó', fallo);
        rechazar(new ErrorTurnstile('no-cargo', 'Turnstile no pudo montarse.'));
        return;
      }

      if (idWidget === null) {
        rechazar(new ErrorTurnstile('no-cargo', 'Turnstile no pudo montarse.'));
        return;
      }
      resolver();
    };

    if (window.turnstile) {
      montar();
      return;
    }

    window.alTurnstileListo = montar;

    // Montar el <script> tampoco es infalible: un WebView con la CSP del
    // anfitrión puede impedirlo. Igual que arriba, eso es `no-cargo`, no un
    // fallo que deba cortarle el envío a nadie.
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=alTurnstileListo';
    script.async = true;
    script.defer = true;
    script.addEventListener('error', () =>
      rechazar(new ErrorTurnstile('no-cargo', 'No se pudo cargar Turnstile.')),
    );
    document.head.append(script);
  });

  /*
   * UN INTENTO FALLIDO NO SE GUARDA EN LA CACHÉ.
   *
   * `cargado` existe para no pedir dos veces el script ni montar dos widgets.
   * Pero si se conservara también la promesa RECHAZADA, cada reintento
   * devolvería ese mismo rechazo sin volver a intentar nada: el «último
   * intento» que hacen los formularios justo antes de enviar sería una copia
   * del primer fallo, y la única salida para la persona sería recargar la
   * página. Un bloqueo momentáneo (una red que tarda, una conexión que se cae
   * al cambiar de wifi a datos) condenaba así el resto de la visita al respaldo
   * por correo, que no puede llevar la hoja de vida adjunta.
   *
   * Al fallar se limpia la caché para que la siguiente llamada vuelva a pedir
   * el script de Cloudflare de verdad. El `catch` deja además la promesa
   * atendida, así que un fallo de carga no sale por consola como
   * «unhandled rejection».
   */
  intento.catch(() => {
    if (cargado === intento) cargado = null;
  });

  cargado = intento;
  return intento;
}

/**
 * Pide un token nuevo, reintentando UNA vez si el reto falla.
 *
 * Cada intento reinicia el widget (`reset`) antes de ejecutarlo, que es lo que
 * saca a Turnstile de un estado de error: con `retry: 'never'` no se recupera
 * solo. Los motivos que no se arreglan reintentando (`no-cargo`, `reemplazado`)
 * salen a la primera.
 *
 * Si Cloudflare pide interacción, se llama a `alPedirInteraccion` y la espera
 * pasa del tope corto al largo: el tiempo que tarda la persona en marcar la
 * casilla no cuenta como un fallo. Eso ocurre dentro de cada intento, así que
 * una casilla marcada a destiempo puede consumir el primero y resolverse en el
 * segundo.
 */
export async function tokenTurnstile(opciones: OpcionesToken = {}): Promise<string> {
  let ultimo: ErrorTurnstile | null = null;

  for (let intento = 1; intento <= INTENTOS_TOKEN; intento += 1) {
    try {
      return await ejecutarTurnstile(opciones);
    } catch (bruto) {
      /*
       * NUNCA SALE DE AQUÍ ALGO QUE NO SEA UN ErrorTurnstile. Antes se
       * relanzaba cualquier otra excepción, y quien llamaba la confundía con un
       * fallo de red y perdía el envío. Cualquier cosa rara es un `fallo`:
       * reintentable, y si no, la postulación sale sin verificar.
       */
      const fallo =
        bruto instanceof ErrorTurnstile
          ? bruto
          : new ErrorTurnstile(
              'fallo',
              'La comprobación antirrobots falló.',
              undefined,
            );
      if (!(bruto instanceof ErrorTurnstile)) console.warn('[turnstile] fallo inesperado', bruto);
      ultimo = fallo;
      if (!MOTIVOS_REINTENTABLES.has(fallo.motivo) || intento === INTENTOS_TOKEN) break;
      console.warn('[turnstile] reintento tras', fallo.motivo, fallo.codigo ?? '');
      await esperar(PAUSA_REINTENTO_MS);
    }
  }

  throw ultimo ?? new ErrorTurnstile('fallo', 'La comprobación antirrobots falló.');
}

/** Un intento suelto: reinicia el widget, lo ejecuta y espera el token. */
function ejecutarTurnstile(opciones: OpcionesToken): Promise<string> {
  if (!window.turnstile || idWidget === null) {
    return Promise.reject(new ErrorTurnstile('no-cargo', 'Turnstile no está listo.'));
  }

  // Si quedaba una petición sin resolver se descarta: solo hay un widget y no
  // puede atender dos ejecuciones a la vez.
  rechazarPendiente(
    new ErrorTurnstile('reemplazado', 'Se pidió otro token antes de que llegara este.'),
  );

  return new Promise<string>((resolver, rechazar) => {
    const vencer = (mensaje: string) => () =>
      rechazarPendiente(new ErrorTurnstile('tiempo', mensaje));

    let temporizador = setTimeout(
      vencer('La comprobación antirrobots tardó demasiado.'),
      ESPERA_MAXIMA_MS,
    );

    pendiente = {
      resolver: (token) => {
        clearTimeout(temporizador);
        resolver(token);
      },
      rechazar: (fallo) => {
        clearTimeout(temporizador);
        rechazar(fallo);
      },
      pedirInteraccion: () => {
        clearTimeout(temporizador);
        temporizador = setTimeout(
          vencer('La verificación de seguridad no se completó a tiempo.'),
          ESPERA_INTERACCION_MS,
        );
        opciones.alPedirInteraccion?.();
      },
    };

    /*
     * `reset` y `execute` también son código de Cloudflare y también lanzan
     * («widget not found» cuando el iframe se murió, por ejemplo). Lanzar aquí
     * dentro rechaza esta promesa con un error crudo que los formularios no
     * reconocen, y eso acabó enseñándose como un fallo de red mientras la
     * postulación se quedaba sin enviar. Se convierte en `fallo`, que además es
     * reintentable.
     */
    try {
      window.turnstile!.reset(idWidget!);
      window.turnstile!.execute(idWidget!);
    } catch (fallo) {
      console.warn('[turnstile] execute lanzó', fallo);
      rechazarPendiente(new ErrorTurnstile('fallo', 'La comprobación antirrobots falló.'));
    }
  });
}
