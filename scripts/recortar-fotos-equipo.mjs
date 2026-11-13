/**
 * Recorta las fotos del equipo directivo a un cuadrado centrado en la cara.
 *
 *   node scripts/recortar-fotos-equipo.mjs            (escribe los .webp)
 *   node scripts/recortar-fotos-equipo.mjs --revisar  (no escribe, solo informa)
 *   npm run fotos:equipo
 *
 * POR QUÉ EXISTE
 * --------------
 * Las fotos llegan como verticales de celular (960x1280), y la tarjeta de
 * /nosotros/ las muestra en un círculo de 112 px. Si se sube el vertical tal
 * cual, `object-fit: cover` recorta por el centro geométrico de la imagen, que
 * en una foto de medio cuerpo cae en el pecho: la cara queda arriba, cortada
 * por el borde del círculo. El encuadre hay que decidirlo mirando cada foto, y
 * eso es lo que guarda la tabla RECORTES de abajo.
 *
 * Los originales NO están en el repositorio: son fotos del personal y viven en
 * `recursos/fotos-equipo/`, que .gitignore excluye. Lo que se publica es solo
 * el .webp ya recortado. Por eso el script existe aunque se ejecute pocas
 * veces: deja escritas las medidas de cada cara, así que regenerar las fotos
 * (otro tamaño, otra calidad, otro encuadre) no obliga a volver a medirlas.
 *
 * CÓMO SE CALCULA EL RECORTE
 * --------------------------
 * De cada foto se guardan cuatro puntos medidos sobre el original: la
 * coronilla (lo más alto del pelo), el mentón, la línea de los ojos y el eje
 * vertical de la cara. El cuadrado sale de ahí con dos reglas, iguales para
 * todas, que son las que hacen que las fotos se lean como un juego aunque unas
 * se tomaran de cerca y otras de lejos:
 *
 *   - PROPORCION_CABEZA: la cabeza (coronilla -> mentón) ocupa ese tanto del
 *     lado del cuadrado. Iguala el "zoom" entre fotos.
 *   - ALTURA_OJOS: la línea de los ojos cae a esa altura del recorte, en todas.
 *     Al 40 % la nariz queda cerca del centro del círculo, que es donde el ojo
 *     busca la cara.
 *
 *   lado      = (mentón - coronilla) / PROPORCION_CABEZA
 *   arriba    = ojos - lado * ALTURA_OJOS
 *   izquierda = eje - lado / 2
 *
 * La cabeza estuvo al 40 % en la primera versión (medio cuerpo, con hombros y
 * parte del pecho). Se subió al 58 % porque en el círculo de 112 px las caras
 * se veían pequeñas: ahora es un retrato de hombros para arriba.
 *
 * CUÁNDO AJUSTAR UNA FOTO A MANO
 * ------------------------------
 * Las dos reglas fijan la altura de los ojos, así que lo que queda libre sobre
 * la cabeza depende de cada persona: quien tiene mucho pelo por encima de los
 * ojos se acerca más al borde. Si una foto se queda con menos de AIRE_MINIMO
 * libre sobre la coronilla, el script falla y no la escribe. El arreglo es
 * darle a esa fila su propia `proporcion`, un poco menor que la general: la
 * cabeza sale algo más pequeña, pero los ojos siguen a la misma altura que en
 * las demás.
 *
 * EDITAR AQUÍ: para añadir una foto, deja el original en
 * `recursos/fotos-equipo/` y agrega su fila a RECORTES. Mide los cuatro puntos
 * en píxeles del original (origen arriba a la izquierda). Lo más cómodo es
 * ampliar la zona de la cabeza con una cuadrícula encima: a ojo sobre la foto
 * entera es fácil equivocarse por 20 o 30 px, y con la cabeza al 58 % eso ya se
 * nota. Después revisa el resultado: el círculo de la tarjeta recorta las
 * esquinas del cuadrado, así que se ve menos de lo que muestra el .webp.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

/** Originales sin recortar. Fuera del repositorio a propósito (.gitignore). */
const ORIGENES = 'recursos/fotos-equipo';

/** Destino publicado: lo que src/data/equipo.ts referencia por su ruta. */
const DESTINO = 'public/img/equipo';

/**
 * Lado del cuadrado final, en píxeles.
 *
 * La tarjeta muestra el círculo a 112 px (`h-28 w-28` en src/pages/nosotros.astro),
 * así que 480 cubre de sobra hasta una pantalla 4x. No hay copia @2x porque a
 * 112 px de ancho ningún navegador llegaría a pedirla: el archivo de 480 ya es
 * la versión grande. Si algún día el avatar crece, subir este número y volver
 * a ejecutar el script es todo lo que hace falta.
 */
const LADO = 480;

/** Calidad de WebP. 86 deja cada foto entre 13 y 24 KB sin artefactos en la piel. */
const CALIDAD = 86;

/** Parte del lado del cuadrado que ocupa la cabeza, de la coronilla al mentón. */
const PROPORCION_CABEZA = 0.58;

/** Altura de la línea de los ojos dentro del recorte, medida desde arriba. */
const ALTURA_OJOS = 0.4;

/**
 * Mínimo libre sobre la coronilla, como parte del lado del cuadrado.
 *
 * Por debajo de esto el pelo roza el borde del círculo y la foto se ve cortada,
 * aunque técnicamente quepa. Con 480 px de salida, un 5 % son 24 px.
 */
const AIRE_MINIMO = 0.05;

/**
 * Medidas de cada cara sobre su original. Casi todos son verticales de
 * celular a 960x1280; el de Camilo Acero llegó a 1200x1600. Cada fila se
 * mide en píxeles de SU propio archivo, así que mezclar tamaños no rompe
 * nada, pero tampoco se pueden copiar medidas de una fila a otra.
 *
 * El orden es el mismo de las tarjetas, solo para que sea fácil de leer: el
 * que manda en la página es el de src/data/equipo.ts.
 *
 * `proporcion` es opcional y sustituye a PROPORCION_CABEZA en esa foto (ver
 * «Cuándo ajustar una foto a mano» arriba). Hoy ninguna lo necesita.
 */
const RECORTES = [
  {
    // Nelson Arias — Gerente General. Cabeza algo inclinada: los ojos están a
    // 412 y 422, y se toma el promedio.
    original: 'nelson-arias.jpg',
    salida: 'nelson-arias.webp',
    coronilla: 275,
    menton: 560,
    ojos: 417,
    eje: 490,
  },
  {
    // Álvaro Arias — Gerencia Estratégica. Tomada de lejos, así que su cuadrado
    // es el más pequeño (~345 px) y se amplía a 480. No se nota: 345 px siguen
    // cubriendo los 112 px del círculo incluso en una pantalla 3x. También con
    // la cabeza inclinada: ojos a 351 y 367.
    original: 'alvaro-arias.jpg',
    salida: 'alvaro-arias.webp',
    coronilla: 260,
    menton: 460,
    ojos: 359,
    eje: 450,
  },
  {
    // Camilo Acero — Gerente Comercial. Foto nueva (sentado al escritorio),
    // y la única que NO viene a 960x1280: son 1200x1600, así que sus medidas
    // están en la escala de ESA foto y no se pueden comparar con las demás.
    // Se tomó de lejos y la cara queda arriba del encuadre; sin recortar, el
    // `object-fit: cover` del círculo se quedaba con el pecho y el escritorio.
    original: 'camilo-acero.webp',
    salida: 'camilo-acero.webp',
    coronilla: 423,
    menton: 705,
    ojos: 572,
    eje: 576,
  },
  {
    // Nikole Correal — Talento Humano. Entró en noviembre de 2026 en lugar de
    // Erika Abril, cuya fila se retiró con su foto. Tampoco viene a 960x1280:
    // son 899x1599, así que sus medidas están en la escala de ESA foto. Lleva
    // gafas, y la línea de los ojos es la de las pupilas detrás del cristal,
    // no la del armazón. La cara está algo girada hacia su derecha: las
    // pupilas se centran en 388 y el contorno del mentón en 390.
    original: 'nikole-correal.jpeg',
    salida: 'nikole-correal.webp',
    coronilla: 484,
    menton: 832,
    ojos: 652,
    eje: 390,
  },
  {
    // Catalina Aparicio — Líder Logístico. Entró en noviembre de 2026 en lugar
    // de Julián Mejía, cuya fila se retiró con su foto. Es la foto más grande
    // que ha llegado —3120x4160, cámara trasera en vez de selfie—, así que sus
    // medidas están en la escala de ESA foto y son del orden de tres veces las
    // de las demás filas. Lleva gafas: la línea de los ojos es la de las
    // pupilas detrás del cristal. La coronilla se midió sobre la masa del pelo
    // y no sobre los pelos sueltos, que suben unos 30 px más.
    original: 'catalina-aparicio.jpeg',
    salida: 'catalina-aparicio.webp',
    coronilla: 870,
    menton: 1830,
    ojos: 1380,
    eje: 1512,
  },
];

const soloRevisar = process.argv.includes('--revisar');

/** El cuadrado de recorte de una fila, a partir de sus medidas y las dos reglas. */
function calcularRecorte(fila) {
  const proporcion = fila.proporcion ?? PROPORCION_CABEZA;
  const lado = Math.round((fila.menton - fila.coronilla) / proporcion);
  const arriba = Math.round(fila.ojos - lado * ALTURA_OJOS);
  const izquierda = Math.round(fila.eje - lado / 2);
  const aire = (fila.coronilla - arriba) / lado;
  return { proporcion, lado, arriba, izquierda, aire };
}

/**
 * Lo que impide usar un recorte, en palabras.
 *
 * Son las equivocaciones fáciles al medir o copiar una fila: puntos en orden
 * imposible, un cuadrado que se sale de la foto (sharp fallaría con un
 * «extract_area» que no dice qué foto era) o una cabeza pegada al borde.
 */
function problemasDe(fila, recorte, ancho, alto) {
  const { lado, arriba, izquierda, aire } = recorte;
  const problemas = [];
  if (!(fila.coronilla < fila.ojos && fila.ojos < fila.menton)) {
    problemas.push('las medidas no van coronilla < ojos < mentón');
  }
  if (izquierda < 0) problemas.push(`se sale por la izquierda (${izquierda})`);
  if (arriba < 0) problemas.push(`se sale por arriba (${arriba})`);
  if (izquierda + lado > ancho) problemas.push(`se sale por la derecha (${izquierda + lado} > ${ancho})`);
  if (arriba + lado > alto) problemas.push(`se sale por abajo (${arriba + lado} > ${alto})`);
  if (aire < AIRE_MINIMO) {
    problemas.push(
      `la cabeza queda cortada o pegada arriba (${(aire * 100).toFixed(1)} % libre, mínimo ` +
        `${AIRE_MINIMO * 100} %): dale a esta fila una \`proporcion\` menor`,
    );
  }
  return problemas;
}

async function procesar(fila) {
  const rutaOriginal = join(ORIGENES, fila.original);
  const rutaSalida = join(DESTINO, fila.salida);
  const nombre = fila.salida.padEnd(20);

  if (!existsSync(rutaOriginal)) {
    console.log(`  · ${nombre} SIN ORIGINAL (${rutaOriginal})`);
    return { saltada: true };
  }

  const entrada = sharp(rutaOriginal);
  const { width, height } = await entrada.metadata();
  const recorte = calcularRecorte(fila);
  const problemas = problemasDe(fila, recorte, width, height);
  if (problemas.length > 0) {
    console.log(`  ✗ ${nombre} ${problemas.join('; ')}`);
    return { error: true };
  }

  const { proporcion, lado, arriba, izquierda, aire } = recorte;
  // `rotate()` sin argumentos aplica la orientación del EXIF y la descarta, para
  // que una foto de celular guardada de lado no salga girada. sharp no copia el
  // resto de metadatos salvo que se le pida con withMetadata(), así que el .webp
  // sale sin EXIF: ni orientación, ni fecha, ni GPS.
  const salida = await entrada
    .rotate()
    .extract({ left: izquierda, top: arriba, width: lado, height: lado })
    .resize(LADO, LADO)
    .webp({ quality: CALIDAD })
    .toBuffer();

  const detalle =
    `cabeza ${Math.round(proporcion * 100)} %  ` +
    `recorte ${lado}px en (${izquierda}, ${arriba})  ` +
    `aire ${(aire * 100).toFixed(1)} %  ` +
    `-> ${LADO}x${LADO}${lado < LADO ? ` (ampliada x${(LADO / lado).toFixed(2)})` : ''}  ` +
    `${(salida.length / 1024).toFixed(1)} KB`;

  if (soloRevisar) {
    console.log(`  · ${nombre} ${detalle} (no escrito)`);
    return { revisada: true };
  }

  mkdirSync(dirname(rutaSalida), { recursive: true });
  // Se escriben los bytes del buffer tal cual. Pasarlos otra vez por
  // `sharp(salida).toFile(...)` parece equivalente pero NO lo es: descomprime
  // el WebP y lo vuelve a comprimir con la calidad por defecto (80), así que
  // la foto quedaría con dos codificaciones encima y CALIDAD no serviría de
  // nada.
  writeFileSync(rutaSalida, salida);
  console.log(`  ✓ ${nombre} ${detalle}`);
  return { escrita: true };
}

console.log(
  soloRevisar
    ? `Revisando ${RECORTES.length} foto(s) del equipo (no se escribe nada):`
    : `Recortando ${RECORTES.length} foto(s) del equipo a ${LADO}x${LADO} WebP:`,
);

const resultados = [];
for (const fila of RECORTES) resultados.push(await procesar(fila));

const conError = resultados.filter((r) => r.error).length;
const sinOriginal = resultados.filter((r) => r.saltada).length;

if (sinOriginal > 0) {
  console.log(
    `\n${sinOriginal} foto(s) sin original. Los originales no están en el repositorio:\n` +
      `déjalos en ${ORIGENES}/ (ver la cabecera de este archivo).`,
  );
}
if (conError > 0) {
  console.error(`\n${conError} foto(s) con problemas. No se escribió ninguna de esas.`);
  process.exit(1);
}
