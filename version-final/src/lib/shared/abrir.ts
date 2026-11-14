// ¿Qué hay que abrir en el sistema de archivos cuando pulsas «abrir carpeta»?
//
// ── EL ERROR QUE ESTO ARREGLA ───────────────────────────────────────────────
// La versión anterior lanzaba `explorer.exe <ruta>` con la ruta que hubiera en el
// historial. Si ese archivo ya no existía (borrado, movido, o un registro viejo
// con la ruta mal), Explorer no falla: se abre en su carpeta por defecto —casi
// siempre «Documentos»— dejando al usuario en un sitio que no tiene nada que ver.
// Aquí se decide ANTES de lanzar nada, y se dice la verdad cuando no está.
//
// Puro (sin fs): recibe lo que ya se comprobó en disco.

export type QueAbrir =
  /** Seleccionar el archivo dentro de su carpeta (lo que el usuario espera). */
  | { tipo: "seleccionar" }
  /** El archivo no está, pero su carpeta sí: se abre la carpeta y se avisa. */
  | { tipo: "carpeta"; aviso: string }
  /** No hay nada que abrir. */
  | { tipo: "nada"; error: string };

export interface EstadoRuta {
  /** La ruta en sí existe. */
  existe: boolean;
  /** Y es un archivo (no una carpeta). */
  esArchivo: boolean;
  /** Existe su carpeta contenedora. */
  existeCarpeta: boolean;
}

export function queAbrir(estado: EstadoRuta, esCarpetaPedida = false): QueAbrir {
  if (estado.existe) {
    // Si lo que existe es una carpeta (p. ej. se pidió abrir la carpeta de salida)
    // se abre tal cual; es lo que el usuario quiso.
    if (!estado.esArchivo || esCarpetaPedida) return { tipo: "seleccionar" };
    return { tipo: "seleccionar" };
  }
  if (estado.existeCarpeta) {
    return {
      tipo: "carpeta",
      aviso: "Ese archivo ya no está en su carpeta; se abre la carpeta",
    };
  }
  return {
    tipo: "nada",
    error: "Ni el archivo ni su carpeta existen: puede que hayas movido o borrado la descarga",
  };
}

/** ¿Se puede abrir esta ruta? (dentro de la carpeta de salida o de una conocida) */
export function rutaPermitida(destino: string, raices: string[], sep = "/"): boolean {
  const norm = (p: string) => (p.endsWith(sep) ? p.slice(0, -1) : p);
  const d = norm(destino);
  return raices.some((r) => {
    const raiz = norm(r);
    return d === raiz || d.startsWith(raiz + sep);
  });
}
