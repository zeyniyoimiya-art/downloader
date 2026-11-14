// Apple Music: el sitio que ningún motor sabe leer, y por qué.
//
// `yt-dlp` responde literalmente «Unsupported URL» a cualquier link de
// music.apple.com, porque el audio de Apple va con DRM (FairPlay). No es un
// fallo de configuración: no hay nada que descargar de ahí. La app antes
// decía «Ese formato no existe en este contenido», que es cierto pero no
// ayuda a nadie.
//
// Lo que SÍ se puede hacer, y es lo que hace este módulo:
//
//   1. Pedir los metadatos a la API pública de iTunes (`/lookup`, sin claves ni
//      sesión): título, artista, álbum, carátula en 1400 px y `previewUrl`.
//   2. Buscar esa canción en YouTube con yt-dlp y bajarla con sus metadatos
//      (es el mismo camino que el plan B de Spotify).
//   3. Si YouTube no la da, bajar la **vista previa de 30 s** que Apple publica
//      sin DRM, con aviso claro de que es la vista previa.
//
// Nunca se simula: si no se puede, el trabajo falla diciendo qué pasó.

/** ¿Es un link de Apple Music / iTunes? */
export function esUrlApple(url: string): boolean {
  return /^https?:\/\/(music|itunes)\.apple\.com\//i.test(url.trim());
}

export interface IdApple {
  tipo: "song" | "album" | "playlist" | "artist" | "otro";
  id: string;
  /** Código de país del link (/bo/, /us/…), que cambia el catálogo. */
  pais: string;
}

/**
 * Saca el id y el tipo de un link de Apple Music.
 *
 *   /bo/song/fake-love-orchestral-version-remix/1742176281   → song 1742176281
 *   /bo/album/fake-love/1742176034?i=1742176281              → song 1742176281
 *   /bo/album/fake-love/1742176034                           → album 1742176034
 *   /bo/playlist/…/pl.abc123                                 → playlist pl.abc123
 */
export function idApple(url: string): IdApple | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (!/(^|\.)(music|itunes)\.apple\.com$/i.test(u.hostname)) return null;
  const partes = u.pathname.split("/").filter(Boolean);
  // El país es el primer segmento cuando es un código de dos letras (/bo/,
  // /us/…). Si no viene, el catálogo por defecto es el de EE. UU.
  const pais = /^[a-z]{2}$/i.test(partes[0] ?? "") ? partes[0].toLowerCase() : "us";

  // «?i=» manda: es la canción concreta dentro de un álbum.
  const i = u.searchParams.get("i");
  if (i && /^\d+$/.test(i)) return { tipo: "song", id: i, pais };

  // Tras la palabra clave puede venir un «slug» y DESPUÉS el id:
  //   /bo/song/fake-love-orchestral-version-remix/1742176281
  //   /es/playlist/lo-mejor/pl.a1b2c3
  // Así que no vale con mirar sólo el segmento siguiente.
  const tipos = ["song", "album", "playlist", "artist"] as const;
  type Tipo = (typeof tipos)[number];
  for (let k = 0; k < partes.length; k++) {
    const tipo = partes[k].toLowerCase();
    if (!(tipos as readonly string[]).includes(tipo)) continue;
    const cual = tipo as Tipo;
    for (let j = k + 1; j < partes.length; j++) {
      const seg = partes[j];
      if (/^pl\.[A-Za-z0-9]+$/.test(seg)) return { tipo: "playlist", id: seg, pais };
      if (/^\d+$/.test(seg)) return { tipo: cual, id: seg, pais };
    }
  }
  return null;
}

export interface PistaApple {
  title: string;
  artist: string;
  album?: string;
  /** Carátula cuadrada grande (1400 px), que es la que trae el CDN de Apple. */
  artwork?: string;
  /** Vista previa de 30 s sin DRM (m4a). */
  previewUrl?: string;
  durationMs?: number;
  genero?: string;
  anio?: number;
}

interface ResultadoITunes {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
  releaseDate?: string;
}

/** La carátula de 100 px se pide al mismo CDN en 1400 px. */
export function artworkGrande(url100: string | undefined): string | undefined {
  if (!url100) return undefined;
  return url100.replace(/\/\d+x\d+bb\.(jpg|png)$/i, "/1400x1400bb.$1");
}

/** Traduce un resultado de iTunes a lo que necesita el buscador. */
export function aPista(r: ResultadoITunes): PistaApple | null {
  const title = (r.trackName ?? "").trim();
  if (!title) return null;
  return {
    title,
    artist: (r.artistName ?? "").trim(),
    album: r.collectionName,
    artwork: artworkGrande(r.artworkUrl100),
    previewUrl: r.previewUrl,
    durationMs: r.trackTimeMillis,
    genero: r.primaryGenreName,
    anio: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) || undefined : undefined,
  };
}

/**
 * Metadatos por la API pública de iTunes. Sin claves, sin sesión.
 *
 * Un link de canción devuelve 1 pista; uno de álbum, todas las del álbum
 * (limitadas por quien llama).
 */
export async function pistasApple(url: string, limite = 30): Promise<PistaApple[]> {
  const ids = idApple(url);
  if (!ids) return [];
  if (ids.tipo === "playlist" || ids.tipo === "artist") return []; // iTunes no las sirve sin token
  const esAlbum = ids.tipo === "album";
  const consulta =
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(ids.id)}` +
    `&country=${encodeURIComponent(ids.pais)}` +
    (esAlbum ? `&entity=song&limit=${Math.max(1, Math.min(200, limite))}` : "");
  try {
    const r = await fetch(consulta, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { results?: ResultadoITunes[] };
    const res = j.results ?? [];
    // Un álbum devuelve primero la colección (wrapperType collection): se salta.
    return res
      .filter((x) => x.kind === "song" || (x.wrapperType === "track" && x.trackName))
      .map(aPista)
      .filter((x): x is PistaApple => !!x);
  } catch { return []; }
}

/** Sólo la primera pista (atajo para links de canción). */
export async function metadatosApple(url: string): Promise<PistaApple | null> {
  const p = await pistasApple(url, 1);
  return p[0] ?? null;
}

/** Texto de búsqueda para YouTube: «artista canción». */
export function consultaApple(p: PistaApple): string {
  return `${p.artist} ${p.title}`.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
}
