/**
 * Equipo directivo que se muestra en /nosotros/.
 *
 * Los nombres, cargos y fotos de abajo son los reales. El orden del arreglo es
 * el de las tarjetas en la página.
 *
 * FOTOS
 * -----
 * Cada foto se nombra por la PERSONA, no por el cargo ('nikole-correal.webp' y no
 * 'talento-humano.webp'): los cargos se renombran cada tanto y arrastraban con
 * ellos el nombre del archivo.
 *
 * Si alguien entra sin foto, basta con dejar su ruta apuntando al archivo que
 * tendrá: mientras no exista se dibuja un marcador con sus iniciales, así que
 * la sección nunca se ve rota (ver `imagenOMarcador` en src/lib/imagenes.ts).
 *
 * La foto tiene que ser CUADRADA, porque la tarjeta la recorta en círculo. Las
 * que llegan del celular son verticales, así que no se suben tal cual: pasan
 * por `npm run fotos:equipo` (scripts/recortar-fotos-equipo.mjs), que recorta
 * un retrato de hombros para arriba con la cara del mismo tamaño en todas, lo
 * deja en 480x480 WebP y le quita los metadatos EXIF. Los originales sin
 * recortar NO van al repositorio —son fotos del personal—: viven en
 * `recursos/fotos-equipo/`, que .gitignore excluye.
 *
 * FRASES
 * ------
 * Las cinco están vacías a propósito y quedan PENDIENTES de que cada persona
 * aporte la suya. Antes había frases de ejemplo, pero al poner los nombres
 * reales pasaban a leerse como citas textuales de gente que nunca las dijo.
 * La tarjeta no dibuja nada cuando la frase está vacía, así que se pueden ir
 * llenando de una en una sin que la sección se descuadre.
 */

export interface Persona {
  /** Vacío = el cargo está sin cubrir; la tarjeta muestra «Próximamente». */
  nombre: string;
  cargo: string;
  /** Ruta dentro de public/. Vacío = marcador de posición. */
  foto: string;
  /** Frase corta de la persona (una o dos líneas). Vacío = no se muestra. */
  frase?: string;
}

export const equipo: Persona[] = [
  {
    nombre: 'Nelson Arias',
    cargo: 'Gerente General',
    foto: '/img/equipo/nelson-arias.webp',
    frase: '',
  },
  {
    nombre: 'Álvaro Arias',
    cargo: 'Gerencia Estratégica',
    foto: '/img/equipo/alvaro-arias.webp',
    frase: '',
  },
  {
    nombre: 'Camilo Acero',
    cargo: 'Gerente Comercial',
    foto: '/img/equipo/camilo-acero.webp',
    frase: '',
  },
  {
    nombre: 'Nikole Correal',
    cargo: 'Talento Humano',
    foto: '/img/equipo/nikole-correal.webp',
    frase: '',
  },
  {
    nombre: 'Julián Mejía',
    cargo: 'Líder Logístico',
    foto: '/img/equipo/julian-mejia.webp',
    frase: '',
  },
];
