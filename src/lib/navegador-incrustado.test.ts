/**
 * Pruebas de la detección del navegador incrustado.
 *
 * Los `User-Agent` de aquí son reales, copiados tal cual. Importa que estén
 * completos: lo que distingue al WebView de WhatsApp de Chrome de Android es un
 * «; wv)» en medio de la cadena, y lo que distingue a un WKWebView del Safari
 * de verdad es la AUSENCIA de «Safari/». Recortar un UA se lleva la señal.
 *
 * Los dos lados cuestan dinero, así que los dos están probados: no avisar deja
 * al candidato tocando un campo que no hace nada, y avisar a quien no le pasa
 * nada ensucia el formulario con una franja que no viene al caso.
 */
import { describe, expect, it } from 'vitest';
import { enlaceAbrirEnChrome, navegadorIncrustado } from './navegador-incrustado';

// --- Navegadores incrustados (hay que avisar) --------------------------------

const INCRUSTADOS: Array<[string, string, string | null]> = [
  [
    'el navegador de WhatsApp en Android (solo se delata por «; wv»)',
    'Mozilla/5.0 (Linux; Android 13; SM-A135M Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36',
    null,
  ],
  [
    'un WebView de Android sin modelo («Android 10; K; wv»)',
    'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.81 Mobile Safari/537.36',
    null,
  ],
  [
    'Instagram en iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113 (iPhone13,2; iOS 17_1_1; es_CO; es; scale=3.00; 1170x2532; 517617703)',
    'Instagram',
  ],
  [
    'Facebook en iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 [FBAN/FBIOS;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.1;FBID/phone;FBLC/es_LA]',
    'Facebook',
  ],
  [
    'TikTok en Android',
    'Mozilla/5.0 (Linux; Android 12; V2111 Build/SP1A.210812.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.153 Mobile Safari/537.36 BytedanceWebview/d8a21c6',
    'TikTok',
  ],
  [
    'un WKWebView de iOS sin firma de aplicación (no lleva «Safari/»)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    null,
  ],
];

describe('navegadores incrustados: hay que avisar', () => {
  for (const [que, ua, aplicacion] of INCRUSTADOS) {
    it(que, () => {
      const resultado = navegadorIncrustado(ua);
      expect(resultado).not.toBeNull();
      expect(resultado?.aplicacion).toBe(aplicacion);
    });
  }

  it('en Android marca `esAndroid` para poder ofrecer «Abrir en Chrome»', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SM-A135M Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36';
    expect(navegadorIncrustado(ua)?.esAndroid).toBe(true);
  });

  it('en iOS no, porque allí no hay `intent://`', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113';
    expect(navegadorIncrustado(ua)?.esAndroid).toBe(false);
  });
});

// --- Navegadores de verdad (no hay nada que avisar) --------------------------

const NAVEGADORES: Array<[string, string]> = [
  [
    'Chrome en Android',
    'Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Samsung Internet',
    'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Firefox en Android',
    'Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
  ],
  [
    'Safari en iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  ],
  [
    'Chrome en iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.169 Mobile/15E148 Safari/604.1',
  ],
  [
    'Chrome en Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ],
  ['un UA vacío', ''],
];

describe('navegadores de verdad: no se avisa nada', () => {
  for (const [que, ua] of NAVEGADORES) {
    it(que, () => {
      expect(navegadorIncrustado(ua)).toBeNull();
    });
  }
});

// --- El enlace de salida -----------------------------------------------------

describe('enlaceAbrirEnChrome', () => {
  it('arma el `intent://` con la misma dirección y con respaldo', () => {
    const enlace = enlaceAbrirEnChrome('https://dstunja.com/empleos/');
    expect(enlace).toBe(
      'intent://dstunja.com/empleos/#Intent;scheme=https;package=com.android.chrome;' +
        'S.browser_fallback_url=https%3A%2F%2Fdstunja.com%2Fempleos%2F;end',
    );
  });

  it('conserva el fragmento y los parámetros de la dirección actual', () => {
    const enlace = enlaceAbrirEnChrome('https://dstunja.com/empleos/mensajero-tunja/?ref=wa');
    expect(enlace).toContain('intent://dstunja.com/empleos/mensajero-tunja/?ref=wa#Intent;');
  });
});
