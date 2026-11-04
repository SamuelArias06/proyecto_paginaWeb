/**
 * Validación del multipart que manda el formulario de Empleos.
 *
 * No toca red ni almacenamiento: entra el `FormData` de la petición y sale un
 * objeto validado, con los bytes de la hoja de vida ya comprobados, o una lista
 * de errores en español. Devuelve TODOS los errores, no solo el primero.
 *
 * Las reglas de texto (`texto`, `limpiar`, `FORMA_CORREO`) son las de la PQRS,
 * importadas y no copiadas, para que las dos páginas tengan una sola idea de
 * qué es un correo válido o de qué caracteres se quitan.
 */
import { FORMA_CORREO, limpiar, texto } from '../pqrs/solicitud';
import { esCargoValido, vacanteDelCargo, type VacanteDelCargo } from './cargos';
import { CAMPO_HONEYPOT } from './config';
import { validarHojaDeVida } from './hoja-de-vida';
import { validarRespuestas, type RespuestaPregunta } from './preguntas';
import { limpiarMunicipio, preguntasConTraslado } from './ubicacion';

/** Nombres de los campos del multipart. Son los `name` del formulario. */
export const CAMPOS = {
  nombre: 'nombre',
  correo: 'correo',
  telefono: 'telefono',
  /** «Municipio donde vives» (obligatorio desde el 13·10, como en Control360). */
  municipio: 'municipio',
  cargo: 'cargo',
  /** Slug de la vacante elegida: desempata un cargo abierto en varias sedes. */
  vacante: 'vacante',
  experiencia: 'experiencia',
  autorizacion: 'autorizacion',
  hojaDeVida: 'hoja-de-vida',
  turnstileToken: 'turnstileToken',
  /*
   * Marca que el navegador NO pudo resolver el reto de Turnstile y manda la
   * postulación igual. La pone el formulario solo después de haber reintentado
   * (ver src/lib/turnstile-cliente.ts); el servidor la acepta, la cuenta con un
   * límite mucho más estrecho y marca el correo «[SIN VERIFICAR]».
   */
  sinVerificar: 'sin_verificar',
  /** Código de Cloudflare del fallo, para el registro. Nunca se muestra solo. */
  turnstileCodigo: 'turnstileCodigo',
  /**
   * Identifica la POSTULACIÓN, no la petición: el navegador manda el mismo
   * valor en los reintentos del envío (ver FormularioEmpleo.astro). Sirve de
   * llave de idempotencia de Control360, para que una respuesta perdida en una
   * red de celular no acabe creando dos veces la misma postulación allá.
   */
  idEnvio: 'idEnvio',
} as const;

/** Lo que manda el formulario en `sin_verificar` cuando el reto no se pudo pasar. */
const VALORES_SIN_VERIFICAR = new Set(['si', 'on', 'true', '1']);

/** Forma admitida de un código de Cloudflare: corto y sin nada raro dentro. */
const FORMA_CODIGO = /^[A-Za-z0-9_-]{1,24}$/;

/**
 * Forma admitida del `idEnvio`: un UUID, o el respaldo que arma el navegador
 * cuando `crypto.randomUUID` no existe. Se filtra por forma porque viaja a
 * Control360 como llave de idempotencia y acaba escrito en un registro.
 */
const FORMA_ID_ENVIO = /^[A-Za-z0-9-]{8,64}$/;

export interface HojaDeVidaValidada {
  /** Nombre con tildes y espacios, para mostrar en el correo. */
  nombreOriginal: string;
  /** Nombre saneado, con el que viaja el adjunto. */
  nombreSeguro: string;
  /** MIME deducido del contenido, no del que declaró el navegador. */
  mime: string;
  extension: string;
  tamano: number;
  bytes: Uint8Array;
}

export interface PostulacionValidada {
  nombre: string;
  correo: string;
  telefono: string;
  /** Limpio con `limpiarMunicipio` (src/lib/empleos/ubicacion.ts): «Tunja», «San josé de pare». */
  municipio: string;
  cargo: string;
  /** Vacío si no escribió nada: el campo es opcional. */
  experiencia: string;
  autorizacion: true;
  turnstileToken: string;
  /**
   * Llegó sin token porque el navegador no pudo resolver el reto.
   *
   * Solo vale si ADEMÁS el token viene vacío: con las dos cosas a la vez no se
   * sabría qué creer, y la marca no puede servir para saltarse una verificación
   * que sí se pudo hacer.
   */
  sinVerificar: boolean;
  /** Código de Cloudflare del fallo, o cadena vacía. Solo para el registro. */
  codigoTurnstile: string;
  /**
   * El que mandó el navegador, o cadena vacía si no vino o no tenía forma de
   * identificador. Llave de idempotencia de Control360.
   */
  idEnvio: string;
  hojaDeVida: HojaDeVidaValidada;
  /**
   * El filtro de Control360 (src/lib/empleos/preguntas.ts). `vacanteSlug` es la
   * vacante elegida (null si es espontánea o el cargo ya no está); `respuestas`
   * son las preguntas respondidas, o null cuando no hay ninguna que hacer (ni de
   * la vacante ni la de traslado): entonces no se manda nada y Control360 la deja
   * SIN FILTRO.
   */
  vacanteSlug?: string | null;
  respuestas?: RespuestaPregunta[] | null;
}

/** Inyectable en las pruebas: de dónde salen las preguntas de un cargo. */
export interface OpcionesValidacion {
  vacanteDe?: (cargo: string, slug?: string | null) => Promise<VacanteDelCargo | null>;
}

export type ResultadoPostulacion =
  | { ok: true; datos: PostulacionValidada }
  | { ok: false; errores: string[] };

const LIMITES = {
  nombre: 150,
  correo: 150,
  telefono: 30,
  cargo: 100,
  experiencia: 3000,
} as const;

/** Lo que manda la casilla de autorización cuando está marcada. */
const VALORES_AUTORIZACION = new Set(['si', 'on', 'true']);

/** ¿Rellenó el campo trampa? Solo un robot lo hace. */
export function esRobot(formulario: FormData): boolean {
  const valor = formulario.get(CAMPO_HONEYPOT);
  return typeof valor === 'string' && valor.trim() !== '';
}

/** Un archivo del multipart: en Node y en el navegador es un `File`. */
function esArchivo(valor: unknown): valor is File {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as File).arrayBuffer === 'function' &&
    typeof (valor as File).name === 'string' &&
    typeof (valor as File).size === 'number'
  );
}

export async function validarPostulacion(
  formulario: FormData,
  opciones: OpcionesValidacion = {},
): Promise<ResultadoPostulacion> {
  const errores: string[] = [];

  const nombre = limpiar(texto(formulario.get(CAMPOS.nombre)));
  if (nombre.length < 3) errores.push('El nombre completo es obligatorio.');
  else if (nombre.length > LIMITES.nombre) errores.push('El nombre es demasiado largo.');

  const correo = limpiar(texto(formulario.get(CAMPOS.correo)));
  if (!FORMA_CORREO.test(correo)) errores.push('El correo no tiene un formato válido.');
  else if (correo.length > LIMITES.correo) errores.push('El correo es demasiado largo.');

  const telefono = limpiar(texto(formulario.get(CAMPOS.telefono)));
  // El "57" inicial se descuenta para que un número escrito con indicativo no
  // parezca de más dígitos de los que tiene.
  const digitos = telefono.replace(/\D/g, '').replace(/^57/, '');
  if (digitos.length < 7 || digitos.length > 15) {
    errores.push('El teléfono debe tener entre 7 y 15 dígitos.');
  } else if (telefono.length > LIMITES.telefono) {
    errores.push('El teléfono es demasiado largo.');
  }

  // Como en el formulario de Control360: sin municipio no se recibe (400).
  const municipio = limpiarMunicipio(limpiar(texto(formulario.get(CAMPOS.municipio))));
  if (!municipio) errores.push('Escribe el municipio donde vives.');

  const cargo = limpiar(texto(formulario.get(CAMPOS.cargo)));
  if (cargo.length === 0) errores.push('Elige el cargo al que te postulas.');
  else if (cargo.length > LIMITES.cargo || !(await esCargoValido(cargo))) {
    errores.push(
      'El cargo no es uno de los que ofrece el formulario. Recarga la página e inténtalo de nuevo.',
    );
  }

  // Las preguntas de filtro de la vacante elegida (las del cargo y las suyas) y,
  // si vive en otro municipio, la de traslado. Se exigen aquí y no solo en el
  // navegador: un multipart armado a mano no puede saltarse una obligatoria, y
  // Control360 rechazaría la postulación si faltara. Sin vacante (espontánea) o
  // sin ninguna pregunta no hay nada que validar ni mandar.
  const slug = limpiar(texto(formulario.get(CAMPOS.vacante))) || null;
  const vacante = cargo ? await (opciones.vacanteDe ?? vacanteDelCargo)(cargo, slug) : null;
  const preguntas = vacante ? preguntasConTraslado(vacante.preguntas, municipio, vacante.ciudad) : [];
  let respuestas: RespuestaPregunta[] | null = null;
  if (preguntas.length > 0) {
    const r = validarRespuestas(preguntas, (nombre) => texto(formulario.get(nombre)));
    errores.push(...r.errores);
    respuestas = r.respuestas;
  }

  // Opcional: con la hoja de vida adjunta, el relato es un complemento.
  const experiencia = limpiar(texto(formulario.get(CAMPOS.experiencia)));
  if (experiencia.length > LIMITES.experiencia) {
    errores.push(
      `El texto sobre tu experiencia no puede pasar de ${LIMITES.experiencia} caracteres.`,
    );
  }

  // La autorización de tratamiento de datos (Ley 1581 de 2012) es la única
  // casilla sin la que no se puede enviar: sin ella no hay base legal para
  // guardar el nombre, el teléfono ni la hoja de vida.
  const autorizacion = texto(formulario.get(CAMPOS.autorizacion)).toLowerCase();
  if (!VALORES_AUTORIZACION.has(autorizacion)) {
    errores.push('Falta la autorización de tratamiento de datos personales.');
  }

  const turnstileToken = texto(formulario.get(CAMPOS.turnstileToken));

  // La marca solo cuenta si NO vino token: si vino, se verifica y punto. Así
  // nadie puede mandar un token cualquiera y la marca a la vez para elegir por
  // qué puerta entra.
  const marca = texto(formulario.get(CAMPOS.sinVerificar)).toLowerCase();
  const sinVerificar = turnstileToken === '' && VALORES_SIN_VERIFICAR.has(marca);

  // El código viaja para el registro. Se filtra por forma porque acaba escrito
  // en el registro de Vercel y en el asunto de un correo: nada que no sea un
  // código corto entra.
  const codigoBruto = texto(formulario.get(CAMPOS.turnstileCodigo));
  const codigoTurnstile = FORMA_CODIGO.test(codigoBruto) ? codigoBruto : '';

  // No es obligatorio: un multipart armado a mano puede no traerlo, y entonces
  // el servidor pone el suyo como siempre. Nunca es motivo de rechazo.
  const idBruto = texto(formulario.get(CAMPOS.idEnvio));
  const idEnvio = FORMA_ID_ENVIO.test(idBruto) ? idBruto : '';

  const hojaDeVida = await revisarHojaDeVida(formulario.get(CAMPOS.hojaDeVida), errores);

  if (errores.length > 0 || !hojaDeVida || !municipio) {
    return { ok: false, errores };
  }

  return {
    ok: true,
    datos: {
      nombre,
      correo,
      telefono,
      municipio,
      cargo,
      experiencia,
      autorizacion: true,
      turnstileToken,
      sinVerificar,
      codigoTurnstile,
      idEnvio,
      hojaDeVida,
      vacanteSlug: vacante?.slug ?? null,
      respuestas,
    },
  };
}

/**
 * Lee los bytes UNA vez y los valida con las mismas reglas que el navegador.
 *
 * El `type` que declara el navegador se ignora: lo pone quien sube el archivo.
 * Lo que decide es el contenido.
 */
async function revisarHojaDeVida(
  valor: FormDataEntryValue | null,
  errores: string[],
): Promise<HojaDeVidaValidada | null> {
  if (!esArchivo(valor) || valor.size === 0 || valor.name === '') {
    errores.push('La hoja de vida es obligatoria: adjúntala en PDF, DOC o DOCX.');
    return null;
  }

  const bytes = new Uint8Array(await valor.arrayBuffer());
  const resultado = await validarHojaDeVida({
    nombre: valor.name,
    tamano: bytes.length,
    leer: async (inicio, fin) => bytes.subarray(inicio, Math.min(fin, bytes.length)),
  });

  if (!resultado.ok) {
    errores.push(resultado.error);
    return null;
  }

  return {
    nombreOriginal: limpiar(valor.name).slice(0, 255) || resultado.nombreSeguro,
    nombreSeguro: resultado.nombreSeguro,
    mime: resultado.mime,
    extension: resultado.extension,
    tamano: bytes.length,
    bytes,
  };
}
