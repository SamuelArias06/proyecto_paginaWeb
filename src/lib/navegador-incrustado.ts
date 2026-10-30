/**
 * ¿Estamos dentro del navegador de otra aplicación?
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Las vacantes circulan por WhatsApp: alguien
 * comparte el flyer con el enlace a /empleos/ y el candidato lo abre DENTRO de
 * WhatsApp, no en Chrome. Eso no es un navegador normal, es un WebView que la
 * aplicación anfitriona incrusta, y un WebView solo puede abrir el selector de
 * archivos si la aplicación se tomó el trabajo de implementarlo
 * (`onShowFileChooser` en Android). Varias no lo hacen: el candidato toca «Hoja
 * de vida» y NO PASA NADA. Ni un error, ni un selector, nada. Desde el PC el
 * mismo formulario funciona, que es exactamente lo que nos reportaron.
 *
 * Esto no se puede arreglar desde la página: si el WebView no abre el selector,
 * no hay API que lo fuerce. Lo único que se puede hacer —y es lo que hace
 * FormularioEmpleo.astro con esta función— es DECIRLO ANTES de que la persona
 * se dé por vencida, y ofrecerle abrir la página en su navegador de verdad.
 *
 * CÓMO SE DETECTA. Por el `User-Agent`, que para esto es la única señal que hay.
 * Se mira en este orden:
 *
 *  1. Las aplicaciones que se firman en el UA (Instagram, Facebook, TikTok,
 *     Snapchat, LinkedIn, Line, WeChat...). Son las fáciles.
 *  2. `wv`, el token que Android pone en el UA de TODO WebView. WhatsApp no se
 *     firma de ninguna otra forma, así que este es el que lo pilla. Un navegador
 *     de verdad en Android (Chrome, Samsung Internet, Firefox) nunca lo lleva.
 *  3. En iOS, un WKWebView incrustado: `AppleWebKit` sin `Safari/` y sin los
 *     tokens de Chrome (`CriOS`) ni Firefox (`FxiOS`). El Safari de verdad y las
 *     vistas tipo SafariViewController sí llevan `Safari/`, y esas abren
 *     archivos bien.
 *
 * SIN FALSOS POSITIVOS CAROS. Equivocarse aquí no rompe nada: el aviso es una
 * franja que explica cómo abrir la página en el navegador, y el formulario sigue
 * funcionando debajo. Y en cuanto la persona adjunta su hoja de vida, el aviso
 * se oculta solo.
 *
 * Este módulo no toca el DOM: recibe el UA como parámetro para poder probarlo.
 */

/** Aplicaciones que se identifican en el UA cuando incrustan un navegador. */
const APLICACIONES: ReadonlyArray<{ patron: RegExp; nombre: string }> = [
  { patron: /\bFBAN\/|\bFBAV\/|\bFB_IAB\b/i, nombre: 'Facebook' },
  { patron: /\bInstagram\b/i, nombre: 'Instagram' },
  { patron: /\bTikTok\b|\bBytedanceWebview\b|\bmusical_ly\b/i, nombre: 'TikTok' },
  { patron: /\bSnapchat\b/i, nombre: 'Snapchat' },
  { patron: /\bLinkedIn(App)?\b/i, nombre: 'LinkedIn' },
  { patron: /\bMicroMessenger\b/i, nombre: 'WeChat' },
  { patron: /\bLine\//i, nombre: 'Line' },
  { patron: /\bTwitter\b/i, nombre: 'X' },
];

export interface NavegadorIncrustado {
  /** Cómo llamar a la aplicación anfitriona en el aviso, si se sabe cuál es. */
  aplicacion: string | null;
  /** Android admite el enlace `intent://` que abre la página en Chrome. */
  esAndroid: boolean;
}

/**
 * Devuelve los datos del navegador incrustado, o `null` si es un navegador
 * normal (que es el caso de casi todo el tráfico de escritorio).
 */
export function navegadorIncrustado(ua: string): NavegadorIncrustado | null {
  if (!ua) return null;

  const esAndroid = /\bAndroid\b/i.test(ua);
  const aplicacion = APLICACIONES.find((a) => a.patron.test(ua))?.nombre ?? null;
  if (aplicacion) return { aplicacion, esAndroid };

  // Android: `wv` está en el UA de cualquier WebView y en el de ningún
  // navegador. Es lo que delata al navegador de WhatsApp, que no se firma.
  if (esAndroid && /;\s*wv\b|\bwv\)/i.test(ua)) return { aplicacion: null, esAndroid };

  // iOS: WKWebView incrustado. El Safari de verdad lleva `Safari/`.
  const esIOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);
  if (esIOS && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) {
    return { aplicacion: null, esAndroid: false };
  }

  return null;
}

/**
 * Enlace que saca la página del WebView y la abre en Chrome, en Android.
 *
 * Es el esquema `intent://` del propio Android. Si Chrome no está instalado, el
 * `browser_fallback_url` deja el enlace en una página normal en vez de dejar la
 * pulsación sin respuesta. En iOS no hay nada equivalente: ahí el aviso solo
 * puede explicar cómo hacerlo y ofrecer copiar el enlace.
 */
export function enlaceAbrirEnChrome(url: string): string {
  const sinEsquema = url.replace(/^https?:\/\//, '');
  const respaldo = encodeURIComponent(url);
  return `intent://${sinEsquema}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${respaldo};end`;
}
