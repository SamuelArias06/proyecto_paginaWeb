/**
 * Vacantes y convocatorias abiertas.
 *
 * Cada entrada genera una tarjeta en /empleos/ y su propia página de detalle
 * en /empleos/<slug>/, con el flyer completo, los requisitos, lo que ofrece la
 * empresa y los datos de contacto.
 *
 * IMÁGENES
 * --------
 * El campo `imagen` apunta a un archivo dentro de public/img/empleos/. Si el
 * archivo no existe todavía se muestra un marcador de posición con el nombre
 * del cargo, así que nada se ve roto. La extensión del archivo real puede
 * diferir de la que está escrita aquí: se busca por nombre.
 *
 * La ruta se escribe desde la raíz de public/ y NO se le aplica `ruta()` aquí:
 * de eso se encarga `imagenOMarcador` (src/lib/imagenes.ts), que es quien la
 * consume en las dos páginas. Así la misma cadena sirve en Vercel (sin `base`)
 * y en GitHub Pages (con `/proyecto_paginaWeb`).
 */
import type { PreguntaVacante } from '../lib/empleos/preguntas';

/** Contacto de selección de personal, común a todas las convocatorias. */
export const contactoEmpleo = {
  email: 'ghsantiagodetunja@gmail.com',
  whatsapp: { numero: '573106232429', texto: '310 623 2429' },
} as const;

export interface Vacante {
  /** Identificador para la URL: /empleos/<slug>/ */
  slug: string;
  cargo: string;
  /**
   * La sede de la vacante ("Tunja, Boyacá"), tal como la guarda Control360.
   * Es lo que compara la pregunta automática de traslado (empleos/ubicacion.ts),
   * así que NO se le agregan municipios: para eso está `zonas`.
   */
  ciudad: string;
  /**
   * Municipios donde está abierta la MISMA convocatoria, cuando son varios
   * ("Vendedor TAT" en Tunja, Chiquinquirá y Barbosa). Control360 solo guarda
   * una sede por vacante, así que esto se mantiene aquí y se hereda cuando la
   * sede que manda Control360 es una de estas (empleos/zonas.ts).
   *
   * Con una sola zona —o sin el campo— se sigue viendo `ciudad` tal cual.
   */
  zonas?: string[];
  tipo: string;
  /** Frase corta para la tarjeta del listado. */
  resumen: string;
  /**
   * Ruta dentro de public/ (lista estática) o URL absoluta del flyer que
   * Talento Humano subió en Control360. Vacío = marcador de posición.
   */
  imagen: string;
  /** Párrafos de la descripción larga (página de detalle). */
  descripcion: string[];
  requisitos: string[];
  /**
   * Qué hace la persona en el día a día ("Funciones principales" del flyer).
   * Va aparte de `requisitos` porque son cosas distintas: el requisito filtra
   * quién puede postularse, la función describe el trabajo.
   */
  funciones?: string[];
  /** "Habilidades deseables": suman, pero sin ellas igual se puede postular. */
  habilidades?: string[];
  /** Qué ofrece la empresa. */
  ofrecemos?: string[];
  /** Segundo número de WhatsApp, si la convocatoria lo tiene. */
  whatsappExtra?: { numero: string; texto: string };
  /**
   * Salario tal como lo escribió Talento Humano en Control360 ("$1.600.000 +
   * comisiones" o un rango). Solo llega si allá lo marcaron para mostrar.
   */
  salario?: string;
  /** Jornada u horario ("Lunes a sábado, 7 a.m. – 4 p.m."), desde Control360. */
  jornada?: string;
  /**
   * Preguntas de filtro que Talento Humano escribió en Control360 para esta
   * vacante (src/lib/empleos/preguntas.ts). Solo llegan de Control360: la lista
   * estática no las tiene, y sin ellas el formulario queda como siempre.
   */
  preguntas?: PreguntaVacante[];
  /**
   * Cuándo cambió la vacante por última vez (fecha ISO), si Control360 la manda.
   * Solo la usa el sitemap de empleos como `lastmod`; sin ella no se inventa.
   */
  actualizada?: string;
  /**
   * Cuándo se publicó (fecha ISO), si Control360 la manda. Es el `datePosted`
   * de Google Empleos (src/lib/empleos/job-posting.ts).
   */
  publicada?: string;
  /** Hasta cuándo recibe postulaciones (fecha ISO), si Control360 la manda. */
  vence?: string;
}

/**
 * EDITAR AQUÍ: vacantes reales.
 * Si el arreglo queda vacío, /empleos/ muestra el mensaje de "no hay vacantes
 * abiertas" y la persona igual puede dejar su hoja de vida.
 *
 * El orden es el que se ve en la página: primero los cargos comerciales, luego
 * las demás áreas y de último la convocatoria de vehículos, que no es un cargo
 * sino una invitación a vincular vehículo propio.
 */
export const vacantes: Vacante[] = [
  {
    slug: 'supervisor-ventas-tat',
    cargo: 'Supervisor de Ventas TAT',
    ciudad: 'Tunja, Boyacá',
    tipo: 'Tiempo completo',
    resumen: 'Lidera y acompaña en calle al equipo de ventas TAT de la zona.',
    imagen: '/img/empleos/supervision-de-ventas.jpeg',
    descripcion: [
      'En Distribuciones Santiago de Tunja buscamos personas con experiencia en liderazgo comercial, que quieran hacer parte de nuestro equipo y aportar al crecimiento del área de ventas.',
      'También se valora la experiencia en cargos de liderazgo comercial o supervisión de equipos de ventas.',
    ],
    requisitos: [
      'Formación técnica, tecnológica o profesional en administración de empresas, mercadeo y ventas, gestión comercial o afines',
      'Mínimo 1 año de experiencia en ventas o cargos similares',
      'Excelente comunicación y fluidez verbal',
      'Liderazgo y capacidad para trabajar en equipo',
      'Preferiblemente con moto propia, para desplazamiento en la zona',
      'Disponibilidad para viajar dentro de la zona asignada',
      'Orientación a resultados y actitud proactiva',
    ],
    funciones: [
      'Acompañamiento y seguimiento al equipo de ventas',
      'Revisión de resultados y cumplimiento de objetivos',
      'Organización y planeación de rutas',
      'Seguimiento a clientes y creación de nuevos',
      'Desarrollo de estrategias para el crecimiento del canal',
    ],
    ofrecemos: [
      'Salario base',
      'Comisiones',
      'Bonos por cumplimiento',
      'Crecimiento laboral',
      'Buen ambiente laboral',
    ],
  },
  {
    /*
     * El cargo lleva la zona en el nombre a propósito. El `<select>` del
     * formulario usa `cargo` como valor de la opción (src/lib/empleos/cargos.ts),
     * así que dos vacantes de supervisión con el mismo texto saldrían como dos
     * opciones idénticas y quien recibe la postulación no sabría a cuál de las
     * dos se presentó la persona. Por eso la de Tunja es "TAT" y esta, "Barbosa".
     */
    slug: 'supervisor-ventas-barbosa',
    cargo: 'Supervisor de Ventas Barbosa',
    ciudad: 'Barbosa, Santander',
    tipo: 'Tiempo completo',
    resumen: 'Lidera el equipo de ventas de la zona de Barbosa. Requiere moto propia.',
    imagen: '/img/empleos/supervisor-de-ventas-barbosa.jpeg',
    descripcion: [
      'En Distribuciones Santiago de Tunja buscamos personas con experiencia en liderazgo comercial, que quieran hacer parte de nuestro equipo y aportar al crecimiento del área de ventas.',
      'La convocatoria es para la zona de Barbosa, Santander, preferiblemente para quien ya resida allí.',
    ],
    requisitos: [
      'Formación tecnológica o profesional en administración de empresas, mercadeo y ventas, gestión comercial o afines',
      'Mínimo 1 año de experiencia en ventas o cargos similares',
      'Moto propia: es indispensable para el cargo',
      'Preferiblemente residir en Barbosa, Santander',
    ],
    funciones: [
      'Acompañamiento y seguimiento al equipo de ventas',
      'Revisión de resultados y cumplimiento de objetivos',
      'Organización y planeación de rutas',
      'Seguimiento a clientes y creación de nuevos',
      'Desarrollo de estrategias para el crecimiento del canal',
    ],
    habilidades: [
      'Comunicación asertiva',
      'Liderazgo',
      'Pensamiento estratégico',
      'Organización y disciplina',
      'Trabajo en equipo',
      'Proactividad',
    ],
  },
  {
    slug: 'vendedor-tat',
    cargo: 'Vendedor TAT',
    ciudad: 'Tunja, Boyacá',
    zonas: ['Tunja, Boyacá', 'Chiquinquirá, Boyacá', 'Barbosa, Santander'],
    tipo: 'Tiempo completo',
    resumen: 'Atiende la ruta de tiendas asignada y toma el pedido en el punto de venta.',
    imagen: '/img/empleos/perfil-de-ventas.jpeg',
    descripcion: [
      'En Distribuciones Santiago de Tunja buscamos personas con actitud comercial, orientación al cliente y muchas ganas de crecer en el área de ventas TAT.',
      'También se valora la experiencia en cargos similares o en el sector de consumo masivo.',
    ],
    requisitos: [
      'Técnico, tecnólogo o profesional en áreas administrativas, comerciales, de mercadeo o afines',
      'Mínimo 1 año de experiencia en ventas TAT',
      'Fluidez verbal y excelente comunicación',
      'Preferiblemente con moto propia, para desplazamiento en la zona',
      'Disponibilidad para viajar dentro de la zona asignada',
      'Actitud proactiva, responsable y con enfoque en resultados',
    ],
    funciones: [
      'Visitar y asesorar clientes en el canal TAT',
      'Toma de pedidos y seguimiento a clientes',
      'Realizar la comercialización del portafolio de productos',
      'Crear y fidelizar nuevos clientes',
      'Apoyar en el cumplimiento de los objetivos comerciales',
    ],
    habilidades: [
      'Comunicación asertiva',
      'Orientación al cliente',
      'Trabajo en equipo',
      'Proactividad',
      'Iniciativa',
    ],
    ofrecemos: ['Salario base', 'Comisiones', 'Bonos por cumplimiento'],
  },
  {
    slug: 'facturacion',
    cargo: 'Facturación',
    ciudad: 'Tunja, Boyacá',
    tipo: 'Tiempo completo',
    resumen: 'Elabora y revisa las facturas de venta y compra, y apoya la gestión documental.',
    imagen: '/img/empleos/facturacion.jpeg',
    descripcion: [
      'En Distribuciones Santiago de Tunja buscamos personas con experiencia en procesos de facturación y gestión documental, que quieran hacer parte de nuestro equipo.',
    ],
    requisitos: [
      'Técnico, tecnólogo o profesional en áreas administrativas, contables, financieras o afines',
      'Experiencia mínima de 6 meses en procesos de facturación o áreas administrativas',
      'Se valoran conocimientos en herramientas ofimáticas (Excel, Word) y atención al detalle',
    ],
    funciones: [
      'Elaboración y revisión de facturas de venta y compra',
      'Manejo y control de documentos contables y tributarios',
      'Registro y actualización de información en el sistema',
      'Apoyo en procesos administrativos del área',
      'Seguimiento a pagos y cartera, según necesidad',
    ],
    habilidades: [
      'Comunicación asertiva',
      'Organización y responsabilidad',
      'Manejo de herramientas ofimáticas',
      'Atención al detalle',
      'Trabajo en equipo',
    ],
  },
  {
    slug: 'auxiliar-administrativo',
    cargo: 'Auxiliar Administrativo',
    ciudad: 'Tunja, Boyacá',
    tipo: 'Tiempo completo',
    resumen:
      'Apoya la operación diaria de la oficina: inventarios, control de caja y manejo de información.',
    imagen: '/img/empleos/auxiliar-administrativo.jpeg',
    descripcion: [
      'Si te gusta el trabajo en equipo, la organización y los retos, esta oportunidad es para ti.',
      'En Distribuciones Santiago de Tunja buscamos un auxiliar administrativo con experiencia en el cargo, que quiera hacer parte de una empresa sólida y en constante evolución.',
    ],
    requisitos: [
      'Experiencia de 1 año en el cargo',
      'Tecnólogo o profesional',
      'Conocimiento en inventarios y control de caja',
      'Manejo de Excel y herramientas informáticas',
      'Manejo de bases de datos',
    ],
    habilidades: [
      'Trabajo en equipo',
      'Organización y atención al detalle',
      'Responsabilidad y compromiso',
      'Proactividad frente a los retos del día a día',
    ],
    ofrecemos: [
      'Buen ambiente laboral',
      'Oportunidades de crecimiento',
      'Formar parte de una empresa sólida y en constante evolución',
    ],
  },
  {
    slug: 'logistica',
    cargo: 'Líder Logístico',
    ciudad: 'Tunja, Boyacá',
    tipo: 'Tiempo completo',
    resumen: 'Recibe, almacena y despacha la mercancía que sale a las rutas de distribución.',
    imagen: '/img/empleos/perfil-de-logistica.jpeg',
    descripcion: [
      'En Distribuciones Santiago de Tunja buscamos personas con actitud, compromiso y ganas de ser parte de un gran equipo en el área de logística.',
    ],
    requisitos: [
      'Experiencia o formación en logística, distribución, almacenamiento o administración de inventarios',
      'Se valora la experiencia previa en procesos de distribución y manejo de mercancía',
    ],
    funciones: [
      'Recepción de productos y verificación de pedidos',
      'Almacenamiento y organización de mercancía',
      'Control de inventarios',
      'Alistamiento y despacho de pedidos',
      'Apoyo en procesos de distribución',
    ],
    habilidades: [
      'Organización y orden',
      'Responsabilidad y compromiso',
      'Trabajo en equipo',
      'Atención al detalle',
    ],
  },
  {
    slug: 'talento-humano',
    cargo: 'Talento Humano',
    ciudad: 'Tunja, Boyacá',
    tipo: 'Tiempo completo',
    resumen: 'Apoya los procesos de selección, contratación y bienestar del equipo.',
    imagen: '/img/empleos/talento-humano.jpeg',
    descripcion: [
      'Buscamos perfiles con formación o experiencia en áreas relacionadas con la gestión del talento humano.',
    ],
    requisitos: [
      'Formación técnica, tecnológica o profesional en administración de empresas, gestión del talento humano, administración de recursos humanos o afines',
      'Se valora la experiencia en procesos de selección, contratación y gestión de personal',
    ],
    funciones: [
      'Apoyo en procesos de selección y contratación',
      'Manejo y organización de la documentación del personal',
      'Apoyo en bienestar y clima laboral',
      'Seguimiento a procesos de talento humano',
      'Apoyo en actividades administrativas del área',
    ],
    habilidades: [
      'Comunicación asertiva',
      'Trabajo en equipo',
      'Organización y responsabilidad',
      'Proactividad y disposición para aprender',
    ],
  },
  {
    slug: 'practicante-sistemas',
    cargo: 'Practicante de Ingeniería de Sistemas',
    ciudad: 'Tunja, Boyacá',
    tipo: 'Práctica / pasantía',
    resumen: 'Pon en práctica tus conocimientos en proyectos reales de tecnología y datos.',
    imagen: '/img/empleos/practicante-sistemas.jpeg',
    descripcion: [
      'Si te apasiona la tecnología, los sistemas y quieres poner en práctica tus conocimientos, esta oportunidad es para ti.',
    ],
    requisitos: [
      'Ser estudiante de Ingeniería de Sistemas o carreras afines',
      'Contar con disponibilidad para realizar la práctica',
      'Tener interés en aprender y aportar a proyectos de tecnología y mejora continua',
    ],
    habilidades: [
      'Conocimientos en bases de datos (SQL, MySQL, PostgreSQL, etc.)',
      'Manejo de lenguajes de programación (Python, Java, C#, entre otros)',
      'Interés en análisis de datos y automatización de procesos',
      'Trabajo en equipo, comunicación y proactividad',
      'Mentalidad de aprendizaje continuo y solución de problemas',
    ],
    ofrecemos: [
      'Un equipo de trabajo que te apoya y te guía',
      'Experiencia en proyectos reales del sector de consumo masivo',
      'Excelente ambiente laboral',
    ],
  },
  {
    slug: 'buscamos-vehiculos',
    cargo: 'Buscamos Vehículos',
    ciudad: 'Tunja y alrededores',
    tipo: 'Convocatoria abierta',
    resumen: 'Vinculamos vehículos para recibir y entregar pedidos en Tunja y alrededores.',
    imagen: '/img/empleos/buscamos-vehiculos.png',
    descripcion: [
      'Estamos vinculando vehículos para recibir y entregar pedidos en Tunja y alrededores.',
      'Si tu vehículo está en buen estado y con los documentos al día, escríbenos y te contamos las condiciones de la ruta disponible.',
    ],
    requisitos: [
      'Vehículos en buen estado',
      'Documentos al día: SOAT, técnico-mecánica, impuestos y seguro',
      'Capacidad para carga de pedidos',
      'Disponibilidad y compromiso',
    ],
    ofrecemos: ['Alianzas estables', 'Oportunidad de crecimiento', 'Pagos puntuales'],
    whatsappExtra: { numero: '573108788754', texto: '310 878 8754' },
  },
];

/** Búsqueda por slug, para la página de detalle. */
export function vacantePorSlug(slug: string): Vacante | undefined {
  return vacantes.find((v) => v.slug === slug);
}
