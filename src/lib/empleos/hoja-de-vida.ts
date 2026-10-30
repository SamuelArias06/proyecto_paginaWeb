/**
 * Reglas de la hoja de vida del formulario de Empleos.
 *
 * Igual que src/lib/adjuntos.ts, este módulo NO toca el DOM ni el entorno: lo
 * importan el navegador (para avisar antes de enviar) y la función de Vercel
 * (para decidir de verdad). Formatos, tope y texto de ayuda salen de aquí y de
 * ningún otro sitio, así que el aviso del campo y el rechazo del servidor no se
 * pueden contradecir.
 *
 * SOLO PDF, DOC Y DOCX. Una hoja de vida es un documento, no una foto. La
 * comprobación del contenido (bytes mágicos: `%PDF`, contenedor OLE2 para .doc
 * y ZIP con carpeta `word/` para .docx) la hace `validarArchivo` de
 * adjuntos.ts, a la que se le pasa esa lista de tipos para que un .png no
 * reciba un mensaje que hable de JPG y PNG.
 *
 * DECIDE EL CONTENIDO, NO EL NOMBRE (30·10·2026, `confiarEnElContenido`). Antes
 * la extensión del nombre se comprobaba PRIMERO, y un nombre sin extensión o
 * con otra se rechazaba con «formato no permitido» sin llegar a mirar los
 * bytes. En el PC eso no molesta a nadie: el nombre viene del sistema de
 * archivos y trae su «.pdf». EN EL CELULAR SÍ, y era la mitad del problema por
 * el que los candidatos no podían adjuntar su hoja de vida: el selector de
 * Android entrega el nombre que muestra el proveedor del archivo (Drive,
 * Descargas, Documentos de WhatsApp, Gmail), y muchos lo dan sin extensión.
 * Ahora manda el contenido: si los bytes son de un PDF, DOC o DOCX se acepta y
 * se le pone la extensión que le corresponde. No se pierde nada de seguridad
 * —lo que se exigía de verdad era el contenido, y se sigue exigiendo— y la
 * doble extensión sospechosa se sigue rechazando igual.
 *
 * LA LISTA DE `accept` LLEVA TAMBIÉN LOS MIME. La otra mitad del problema:
 * Chrome de Android traduce cada extensión del `accept` a un tipo MIME y le
 * pide al selector que esconda todo lo demás, así que un archivo cuyo proveedor
 * no declara bien el tipo sale en gris o no sale. Con los MIME escritos al
 * lado de las extensiones (y `application/octet-stream`, que es lo que declaran
 * los gestores de archivos que no saben de qué tipo es) el archivo se puede
 * elegir, y quien decide si vale es la validación de arriba, en el navegador y
 * otra vez en el servidor.
 *
 * TOPE DE 3 MB. El archivo viaja dentro del cuerpo de la petición a la función
 * de Vercel, y Vercel rechaza cuerpos de más de 4,5 MB con un 413 antes de que
 * nuestro código vea nada. Hasta octubre de 2026 el tope era 4 MB, pero desde
 * entonces la postulación sigue además a Control360 (control360.ts) con la hoja
 * de vida en base64, que engorda un 33 %: 4 MB serían 5,3 MB y Control360 la
 * rechazaría. Con 3 MB viajan 4,0 MB, y es el mismo tope que tiene Control360.
 * El formulario de PQRS admite 5 MB porque sus archivos no pasan por la función:
 * van del navegador a Vercel Blob (ver docs/PQRS-ADJUNTOS.md).
 */
import {
  EXTENSION_A_MIME,
  lectorDeBlob,
  validarArchivo,
  type ArchivoAValidar,
  type ResultadoValidacion,
} from '../adjuntos';

/** Peso máximo de la hoja de vida, en MB. Ver la cabecera para el porqué. */
export const MAX_MB_HOJA_DE_VIDA = 3;

/** Extensiones admitidas, con el punto y en minúsculas. */
export const EXTENSIONES_HOJA_DE_VIDA: readonly string[] = ['.pdf', '.doc', '.docx'];

/**
 * Valor del atributo `accept` del <input type="file">.
 *
 * Extensiones Y tipos MIME, por el selector de archivos de Android (ver la
 * cabecera). `application/octet-stream` entra a propósito: sin él, los gestores
 * de archivos que no declaran el tipo dejan el PDF del candidato sin poder
 * elegir. Es solo un filtro de comodidad; el formato lo decide `validarHojaDeVida`.
 */
export const ACEPTA_HOJA_DE_VIDA = [
  ...EXTENSIONES_HOJA_DE_VIDA,
  ...EXTENSIONES_HOJA_DE_VIDA.map((e) => EXTENSION_A_MIME[e] as string),
  'application/octet-stream',
].join(',');

/** Lista legible de formatos, para los mensajes. */
export const FORMATOS_HOJA_DE_VIDA = 'PDF, DOC o DOCX';

/** Texto de ayuda que se muestra junto al campo, antes de elegir nada. */
export const AYUDA_HOJA_DE_VIDA = `${FORMATOS_HOJA_DE_VIDA}, máximo ${MAX_MB_HOJA_DE_VIDA} MB.`;

/** MIME que debe tener el contenido de cada extensión admitida. */
export const MIME_HOJA_DE_VIDA: readonly string[] = EXTENSIONES_HOJA_DE_VIDA.map(
  (extension) => EXTENSION_A_MIME[extension] as string,
);

/**
 * Aplica todas las reglas a un archivo: peso, doble extensión sospechosa y que
 * el contenido sea de verdad un PDF, un DOC o un DOCX.
 *
 * Devuelve el MIME real y el nombre saneado —con la extensión del contenido,
 * aunque el nombre no la trajera—, que es el que va en el adjunto del correo y
 * en el archivo que recibe Control360.
 */
export function validarHojaDeVida(archivo: ArchivoAValidar): Promise<ResultadoValidacion> {
  return validarArchivo(archivo, {
    maxMb: MAX_MB_HOJA_DE_VIDA,
    mimesPermitidos: MIME_HOJA_DE_VIDA,
    formatosLegibles: FORMATOS_HOJA_DE_VIDA,
    confiarEnElContenido: true,
  });
}

/** Atajo de navegador: valida un File tal cual sale del <input type="file">. */
export function validarFileHojaDeVida(file: File): Promise<ResultadoValidacion> {
  return validarHojaDeVida({ nombre: file.name, tamano: file.size, leer: lectorDeBlob(file) });
}
