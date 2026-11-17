// Lectura del volcado JSON de gallery-dl.
//
// gallery-dl imprime una LISTA de entradas con sangría (varias líneas), no un
// JSON por línea como yt-dlp. Cada entrada es `[número, objeto]` y la del
// archivo lleva la URL real de la imagen. Aquí se extrae lo que la interfaz
// necesita: la portada de la vista previa y el texto del post.

type Fila = unknown[] | Record<string, unknown>;

function objetoDe(fila: Fila): Record<string, unknown> | null {
  if (Array.isArray(fila)) {
    // La última posición es el objeto con los datos; las anteriores son números
    // de control ("#1", tipo de mensaje…).
    const alReves = [...fila].reverse().find((x) => x && typeof x === "object" && !Array.isArray(x));
    return (alReves as Record<string, unknown>) ?? null;
  }
  return fila && typeof fila === "object" ? fila : null;
}

/** Todas las filas útiles del volcado, en orden. */
export function filasDeGallerydl(volcado: unknown): Record<string, unknown>[] {
  const filas = Array.isArray(volcado) ? volcado : [volcado];
  return filas.map((f) => objetoDe(f as Fila)).filter((o): o is Record<string, unknown> => !!o);
}

const ES_IMAGEN = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/**
 * Portada (la imagen real del post) o "" si no hay.
 * Antes se descartaba y una foto de Instagram/X salía sin vista previa: la
 * ficha enseñaba un icono genérico aunque la imagen existiera.
 */
export function portadaDeGallerydl(volcado: unknown): string {
  for (const o of filasDeGallerydl(volcado)) {
    for (const clave of ["url", "file_url", "image", "preview", "thumbnail"]) {
      const v = o[clave];
      // Sólo URLs de imagen: meter una URL de vídeo en un <img> es un cuadro roto.
      if (typeof v === "string" && /^https?:\/\//.test(v) && ES_IMAGEN.test(v)) return v;
    }
  }
  return "";
}

/** Texto del post (para el título de la ficha), sin saltos ni espacios dobles. */
export function textoDeGallerydl(volcado: unknown): string {
  for (const o of filasDeGallerydl(volcado)) {
    const t = o.content ?? o.description ?? o.title ?? o.caption;
    if (typeof t === "string" && t.trim()) return t.replace(/\s+/g, " ").trim().slice(0, 300);
  }
  return "";
}

/** Autor del post, con los nombres que usan los distintos extractores. */
export function autorDeGallerydl(volcado: unknown): string {
  for (const o of filasDeGallerydl(volcado)) {
    const crudo = o.author ?? o.user ?? o.username ?? o.owner ?? "";
    if (typeof crudo === "string") { if (crudo.trim()) return crudo.trim(); continue; }
    if (crudo && typeof crudo === "object") {
      const a = crudo as Record<string, unknown>;
      const n = a.nick ?? a.name ?? a.username ?? a.display_name;
      if (typeof n === "string" && n.trim()) return n.trim();
    }
    if (typeof o.username === "string" && o.username.trim()) return o.username.trim();
  }
  return "";
}

/** Número de elementos del post (carrusel), si lo dice. */
export function totalDeGallerydl(volcado: unknown): number | undefined {
  for (const o of filasDeGallerydl(volcado)) {
    if (typeof o.count === "number" && o.count > 0) return o.count;
  }
  return undefined;
}
