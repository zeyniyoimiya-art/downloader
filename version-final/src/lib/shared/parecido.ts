// «¿Este archivo del disco es el que apunta el historial?»
//
// El historial guarda una ruta calculada, y esa ruta puede dejar de coincidir
// con el archivo real por motivos perfectly normales:
//
//   · el motor sanitizó el nombre a su manera (emoji, ｜, «/» → «⁄»…);
//   · se descargó antes en otra carpeta de salida;
//   · el archivo se movió a la carpeta del autor;
//   · el post-proceso cambió la extensión (.m4a → .mp3, .webm → .mp4).
//
// Resultado: la tarjeta decía «El archivo ya no está en esa ruta» aunque el
// archivo estuviera ahí mismo. Aquí vive la comparación, aparte y sin tocar
// disco, para poder probarla a fondo.

/** Minúsculas, sin acentos, sin emoji/puntuación, espacios simples. */
export function normalizar(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes
    .toLowerCase()
    // emoji y símbolos: se van (los nombres chinos se quedan)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** «Canción [dQw4w9WgXcQ] (taller).mp3» → «canción» */
export function nucleo(nombreConExtension: string): string {
  const sinExt = nombreConExtension.replace(/\.[a-z0-9]{1,5}$/i, "");
  return sinExt
    .replace(/\[[A-Za-z0-9_-]{6,20}\]/g, " ") // [videoId]
    .replace(/\((?:taller|transcode|\d+p|\d+k)\)/gi, " ")
    .replace(/_(?:audio|video|photo)$/i, " ");
}

export type Motivo = "exacta" | "id" | "titulo" | "parecido";

export interface Pista {
  /** Ruta guardada en el historial (con su nombre de archivo). */
  path: string;
  title?: string;
  videoId?: string;
}

/**
 * Puntúa una ruta candidata contra la pista del historial.
 * 0 = no es; 100 = es, seguro. Se acepta a partir de 70.
 */
export function puntuar(candidato: string, pista: Pista): { nota: number; motivo: Motivo | null } {
  const nombre = candidato.split(/[\\/]/).pop() ?? candidato;
  const nombreGuardado = pista.path.split(/[\\/]/).pop() ?? pista.path;
  const extC = (nombre.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
  const extG = (nombreGuardado.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();

  // 1. Mismo nombre exacto (ruta distinta): es el mismo archivo, movido.
  if (nombre.toLowerCase() === nombreGuardado.toLowerCase()) {
    return { nota: extC === extG || !extG ? 100 : 92, motivo: "exacta" };
  }

  const id = (pista.videoId ?? pista.path.match(/\[([A-Za-z0-9_-]{6,20})\]/)?.[1] ?? "").trim();
  const nC = normalizar(nucleo(nombre));
  const nG = normalizar(nucleo(nombreGuardado));
  const nT = normalizar(pista.title ?? "");
  const penal = extC && extG && extC !== extG ? 12 : 0; // otra extensión: probable conversión

  // 2. El identificador del vídeo dentro del nombre: la prueba más fuerte
  //    cuando el título cambió o el motor lo recortó.
  if (id && nombre.includes(`[${id}]`)) return { nota: 96 - penal, motivo: "id" };

  // 3. Mismo «núcleo» que la ruta guardada (sin [id] ni sufijos).
  if (nG && nC === nG) return { nota: 94 - penal, motivo: "titulo" };

  // 4. Mismo núcleo que el TÍTULO del historial (el archivo se llamó como el
  //    título y la ruta guardada tenía otra forma).
  if (nT && nC === nT) return { nota: 90 - penal, motivo: "titulo" };

  // 5. Uno contiene al otro y el trozo común es largo (títulos recortados por
  //    el sistema de archivos, «…» al final, etc.).
  const comparar = (a: string, b: string) => {
    if (!a || !b) return 0;
    const corto = a.length <= b.length ? a : b;
    const largo = a.length <= b.length ? b : a;
    if (corto.length < 8) return 0;
    if (!largo.startsWith(corto)) return 0;
    return corto.length >= 24 ? 80 - penal : 72 - penal;
  };
  const porGuardada = comparar(nC, nG);
  if (porGuardada) return { nota: porGuardada, motivo: "parecido" };
  const porTitulo = comparar(nC, nT);
  if (porTitulo) return { nota: porTitulo - 2, motivo: "parecido" };

  return { nota: 0, motivo: null };
}

/** Nota mínima para aceptar un candidato. */
export const UMBRAL = 70;

/** Elige el mejor candidato; a igualdad de nota, el más reciente. */
export function mejorCandidato<T extends { ruta: string }>(
  candidatos: T[],
  pista: Pista,
  mtime?: (ruta: string) => number,
): (T & { nota: number; motivo: Motivo }) | null {
  let mejor: (T & { nota: number; motivo: Motivo }) | null = null;
  for (const c of candidatos) {
    const { nota, motivo } = puntuar(c.ruta, pista);
    if (!motivo || nota < UMBRAL) continue;
    if (!mejor || nota > mejor.nota) { mejor = { ...c, nota, motivo }; continue; }
    if (nota === mejor.nota && mtime) {
      if (mtime(c.ruta) > mtime(mejor.ruta)) mejor = { ...c, nota, motivo };
    }
  }
  return mejor;
}
