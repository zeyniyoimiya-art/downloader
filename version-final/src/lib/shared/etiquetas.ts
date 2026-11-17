// Etiquetas completas: de lo que el sitio sabe a lo que el archivo guarda.
//
// ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────
// `yt-dlp --embed-metadata` escribe cuatro cosas (título, subidor, fecha y
// descripción) y, en los sitios que no son tiendas, deja el álbum, el género y
// el número de pista vacíos. Y un MP3 con "Rick Astley - Never Gonna Give You
// Up (Official Video)" en `title` y "Rick Astley - Topic" en `artist` es un
// archivo que no sirve en ningún reproductor: se ve mal en el móvil y no hay
// forma de ordenarlo.
//
// Aquí vive la traducción: qué campos hay, cómo se limpian y cómo se llaman en
// cada familia de contenedor. Este módulo es PURO (sin red, sin procesos), así
// que se puede probar entero sin binarios.
//
// ── LO QUE SE COMPROBÓ EN VIVO (ffmpeg 7.0) ─────────────────────────────────
//   mp3  → ID3v2.3/2.4: TODOS los campos + letra (USLT) + carátula APIC
//   m4a  → ©nam/©ART/aART/©alb/©gen/©day/trkn/disk/©wrt/©cmt/©lyr + covr
//   flac → Vorbis comments + bloque PICTURE
//   opus/ogg → Vorbis comments en el STREAM (no en el contenedor) y SIN
//              carátula: el muxer de Ogg de ffmpeg rechaza `attached_pic`
//              («Unsupported codec id in stream 1») y no escribe
//              METADATA_BLOCK_PICTURE.
//   mkv/webm → etiquetas simples EN MAYÚSCULAS (TITLE, ARTIST, DATE_RELEASED…)
//              y la carátula como adjunto (`-attach`), no como pista de vídeo.
//   wav  → chunk INFO: título, artista, álbum, fecha, género, comentario.
//   aac/ac3/dts/mp2 → ADTS y compañía no llevan metadatos: no se toca nada.

/** Campos canónicos. Todos opcionales: lo que no se sepa, no se escribe. */
export interface Etiquetas {
  titulo?: string;
  artista?: string;
  album?: string;
  artistaAlbum?: string;
  genero?: string;
  /** ISO "2026-11-12" o sólo el año "1987". */
  fecha?: string;
  /** "3" o "3/12". */
  pista?: string;
  disco?: string;
  compositor?: string;
  comentario?: string;
  /** Letra sincronizada (LRC) si se encontró; si no, texto plano. */
  letra?: string;
  isrc?: string;
}

/** Familia de contenedor = cómo se escriben las etiquetas dentro. */
export type Familia = "id3" | "mp4" | "flac" | "vorbis" | "matroska" | "riff" | "ninguna";

const FAMILIAS: Record<string, Familia> = {
  mp3: "id3",
  // FLAC comparte los Vorbis comments con Ogg/Opus, pero SÍ admite el bloque
  // PICTURE: por eso tiene familia propia (la carátula cambia de comportamiento).
  flac: "flac",
  opus: "vorbis", ogg: "vorbis", oga: "vorbis", spx: "vorbis",
  m4a: "mp4", m4b: "mp4", mp4: "mp4", m4v: "mp4", mov: "mp4", "3gp": "mp4",
  mkv: "matroska", mka: "matroska", webm: "matroska",
  wav: "riff", aif: "riff", aiff: "riff",
};

/** ¿Se le pueden escribir etiquetas a este archivo? (por extensión) */
export function familiaDe(ruta: string): Familia {
  const ext = (ruta.split(/[\\/]/).pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  return FAMILIAS[ext] ?? "ninguna";
}

export function admiteEtiquetas(ruta: string): boolean {
  return familiaDe(ruta) !== "ninguna";
}

/**
 * ¿Se le puede incrustar carátula SIN recodificar el audio?
 * `motivo` se le cuenta al usuario cuando no se puede: nunca se calla.
 */
export function soporteCaratula(ruta: string): { si: boolean; modo: "pista" | "adjunto" | "no"; motivo?: string } {
  switch (familiaDe(ruta)) {
    case "id3": return { si: true, modo: "pista" };
    case "mp4": return { si: true, modo: "pista" };
    case "flac": return { si: true, modo: "pista" };
    case "matroska": return { si: true, modo: "adjunto" };
    // Vorbis no puede: ffmpeg no sabe escribir METADATA_BLOCK_PICTURE. Se podría
    // hacer a mano en base64, pero un comentario de 2 MB en un .opus es peor que
    // no tener carátula: el reproductor tarda en leer la cabecera.
    case "vorbis": return { si: false, modo: "no", motivo: "Ogg/Opus no admiten carátula incrustada con ffmpeg (sí etiquetas y letra)" };
    case "riff": return { si: false, modo: "no", motivo: "WAV/AIFF guardan etiquetas, pero no carátula" };
    default: return { si: false, modo: "no", motivo: "ese contenedor no guarda metadatos" };
  }
}

/** Clave real de cada campo según la familia del contenedor. */
const CLAVES: Record<Exclude<Familia, "ninguna">, Record<string, string>> = {
  id3: { titulo: "title", artista: "artist", album: "album", artistaAlbum: "album_artist", genero: "genre", fecha: "date", pista: "track", disco: "disc", compositor: "composer", comentario: "comment", letra: "lyrics", isrc: "ISRC" },
  mp4: { titulo: "title", artista: "artist", album: "album", artistaAlbum: "album_artist", genero: "genre", fecha: "date", pista: "track", disco: "disc", compositor: "composer", comentario: "comment", letra: "lyrics", isrc: "ISRC" },
  flac: { titulo: "title", artista: "artist", album: "album", artistaAlbum: "album_artist", genero: "genre", fecha: "date", pista: "track", disco: "disc", compositor: "composer", comentario: "comment", letra: "lyrics", isrc: "ISRC" },
  vorbis: { titulo: "title", artista: "artist", album: "album", artistaAlbum: "album_artist", genero: "genre", fecha: "date", pista: "track", disco: "disc", compositor: "composer", comentario: "comment", letra: "lyrics", isrc: "ISRC" },
  riff: { titulo: "title", artista: "artist", album: "album", genero: "genre", fecha: "date", comentario: "comment" },
  // Matroska: etiquetas simples en mayúsculas. `date` no existe; la fecha va en
  // DATE_RELEASED (comprobado: con `date` el muxer la tira sin avisar).
  matroska: { titulo: "TITLE", artista: "ARTIST", album: "ALBUM", genero: "GENRE", fecha: "DATE_RELEASED", pista: "PART_NUMBER", compositor: "COMPOSER", comentario: "COMMENT", letra: "LYRICS", isrc: "ISRC" },
};

const CAMPOS: (keyof Etiquetas)[] = ["titulo", "artista", "album", "artistaAlbum", "genero", "fecha", "pista", "disco", "compositor", "comentario", "letra", "isrc"];

/** Limpia un valor: sin saltos raros, sin NUL, sin espacios al borde. */
export function limpiar(v: unknown, max = 4000): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v)
    // NUL y los espacios de ancho cero que los sitios meten en los títulos se
    // sustituyen por un espacio: borrarlos sin más pegaba dos palabras
    // («Título» + «con» → «Títulocon»).
    .replace(/[\0\u200b-\u200d\ufeff]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    // Un título acaba siendo un nombre de archivo y un argumento de proceso:
    // 4 KB es margen de sobra sin abrir la puerta a nada raro.
    .slice(0, max)
    .trim();
}

/**
 * Une dos juegos de etiquetas. El segundo gana sólo donde trae algo: así una
 * pista de Spotify completa no borra el género que sí traía el JSON del sitio.
 */
export function fusionar(base: Etiquetas, encima: Etiquetas): Etiquetas {
  const out: Etiquetas = { ...base };
  for (const k of CAMPOS) {
    const v = encima[k];
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

/** ¿Queda algo que escribir? */
export function hayEtiquetas(t: Etiquetas): boolean {
  return CAMPOS.some((k) => typeof t[k] === "string" && (t[k] as string).trim().length > 0);
}

/**
 * Argumentos `-metadata clave=valor` para un archivo de esta familia.
 * Se separa de la ejecución para poder probarlo sin lanzar ffmpeg.
 */
export function argsDeEtiquetas(t: Etiquetas, ruta: string): string[] {
  const fam = familiaDe(ruta);
  if (fam === "ninguna") return [];
  const claves = CLAVES[fam];
  const out: string[] = [];
  for (const campo of CAMPOS) {
    const clave = claves[campo];
    if (!clave) continue;
    const valor = limpiar(t[campo], campo === "letra" ? 40000 : 1000);
    if (!valor) continue;
    out.push("-metadata", `${clave}=${valor}`);
  }
  return out;
}

/** ¿Este campo se guarda en este contenedor? (para contar lo aplicado) */
export function camposAplicables(ruta: string): string[] {
  const fam = familiaDe(ruta);
  if (fam === "ninguna") return [];
  return CAMPOS.filter((c) => CLAVES[fam][c]);
}

// ── De "Rick Astley - Never Gonna Give You Up (Official Video)" a dos campos ──

/** Ruido habitual en los títulos de YouTube. Se quita para poder buscar letra. */
const RUIDO = /[([][^)\]]*(official\s*(music\s*)?(video|audio|visualizer|lyric\s*video)|lyric\s*video|video\s*oficial|audio\s*oficial|videoclip|m\/?v|hd|hq|4k|8k|remaster(ed)?(\s*\d{4})?|explicit|clean|letra|subtitulad[oa]s?|en\s*español|prod\.?[^)\]]*)[)\]]/gi;

export function quitarRuido(titulo: string): string {
  return limpiar(String(titulo ?? "").replace(RUIDO, " "))
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–—|]+$/g, "")
    .trim();
}

/**
 * Separa "Artista - Canción". Sólo se fía cuando el trozo de la izquierda es
 * corto (un nombre de artista, no una frase) y los dos lados tienen contenido.
 * Devuelve `artista` sin definir si no lo tiene claro: es mejor no inventar.
 */
export function separarTitulo(titulo: string): { artista?: string; cancion: string } {
  const limpio = quitarRuido(titulo);
  // Separadores que usan los canales de música de verdad.
  const m = limpio.match(/^(.{1,60}?)\s+(?:-|–|—|\/\/|\|)\s+(.{1,200})$/);
  if (!m) return { cancion: limpio };
  const izq = m[1].trim();
  const der = m[2].trim();
  if (!izq || !der) return { cancion: limpio };
  // Los nombres de artista son cortos: «Earth, Wind & Fire» son 4 palabras y
  // 20 caracteres. «Como hacer una tarta de chocolate paso a paso» son 8 y 44,
  // y NO es un artista. Cuando la izquierda parece una frase, no se separa.
  const palabras = izq.split(/\s+/).length;
  if (izq.length > 40 || palabras > 5) return { cancion: limpio };
  return { artista: izq, cancion: der };
}

/** "20261112" → "2026-11-12". Cualquier otra cosa se devuelve tal cual. */
export function fechaISO(v: unknown): string {
  const s = limpiar(v);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}$/.test(s)) return s;
  return "";
}

/** "3/12" o 3 → "3" o "3/12" (lo que venga, limpio). */
function numeroDePista(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return String(Math.trunc(v));
  const s = limpiar(v, 20);
  return /^\d{1,3}(\/\d{1,3})?$/.test(s) ? s : "";
}

/** Un campo del JSON puede venir como string, número, array u objeto. */
function texto(v: unknown): string {
  if (typeof v === "string") return limpiar(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return limpiar(v.map((x) => texto(x)).filter(Boolean).join(", "));
  return "";
}

/** Portada de más calidad disponible en el JSON de yt-dlp. */
export interface Portada { url: string; ancho: number; alto: number; ext: string }

export function mejorPortada(j: unknown): Portada | null {
  const o = (j ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(o.thumbnails) ? (o.thumbnails as Record<string, unknown>[]) : [];
  const candidatas: Portada[] = [];
  for (const t of lista) {
    const url = texto(t.url);
    if (!url || /storyboard|sprite|\bsb\d\b/i.test(url)) continue;
    const ancho = Number(t.width) || 0;
    const alto = Number(t.height) || 0;
    const ext = (url.split("?")[0].split(".").pop() ?? "").toLowerCase();
    candidatas.push({ url, ancho, alto, ext });
  }
  // Si no hay array, al menos la miniatura suelta.
  if (!candidatas.length) {
    const suelta = texto(o.thumbnail);
    if (!suelta) return null;
    candidatas.push({ url: suelta, ancho: Number(o.thumbnail_width) || 0, alto: Number(o.thumbnail_height) || 0, ext: (suelta.split("?")[0].split(".").pop() ?? "").toLowerCase() });
  }
  // Orden: por área (lo que el usuario pidió: "su portada en tamaño original"),
  // y a igualdad, JPG/PNG antes que WebP (los reproductores viejos no leen WebP
  // dentro de un APIC, y convertirlo sin escalar es una pasada de ffmpeg).
  const extOk = (e: string) => (e === "jpg" || e === "jpeg" || e === "png" ? 1 : 0);
  return candidatas.sort((a, b) => (b.ancho * b.alto) - (a.ancho * a.alto) || extOk(b.ext) - extOk(a.ext))[0];
}

/**
 * Etiquetas a partir del JSON de `yt-dlp --dump-single-json`.
 *
 * Prioridad: lo que el sitio declara como campo (`track`, `artist`, `album`…,
 * típico de SoundCloud/Bandcamp) y, si no existe, lo que se deduce del título.
 * El `uploader` "Rick Astley - Topic" se limpia a "Rick Astley": eso es lo que
 * acaba en el reproductor del coche.
 */
export function etiquetasDeSonda(j: unknown): Etiquetas {
  const o = (j ?? {}) as Record<string, unknown>;
  const uploader = texto(o.artist) || texto(o.creator) || texto(o.uploader) || texto(o.channel);
  const uploaderLimpio = uploader.replace(/\s*-\s*Topic$/i, "").trim();
  const separado = separarTitulo(texto(o.title));
  const trackDeclarado = texto(o.track);
  const titulo = quitarRuido(trackDeclarado || separado.cancion || texto(o.title));
  return {
    titulo: titulo || undefined,
    // `artist` del sitio manda; si no, el del patrón "Artista - Canción"; si no,
    // el canal (que para un canal de música es lo más parecido a un artista).
    artista: (texto(o.artist) || separado.artista || uploaderLimpio) || undefined,
    album: texto(o.album) || undefined,
    artistaAlbum: texto(o.album_artist) || undefined,
    genero: texto(o.genre) || undefined,
    fecha: fechaISO(o.release_date || o.release_year || o.upload_date) || undefined,
    pista: numeroDePista(o.track_number) || undefined,
    disco: numeroDePista(o.disc_number) || undefined,
    compositor: texto(o.composer) || undefined,
    // La URL de origen es el dato que de verdad se agradece dentro del archivo:
    // sin él, seis meses después nadie sabe de dónde salió.
    comentario: texto(o.webpage_url) || undefined,
    isrc: texto(o.isrc) || undefined,
  };
}

/** ¿Parece música? (para buscar letra sin gastar peticiones en un tutorial) */
export function pareceMusica(j: unknown, etiquetas?: Etiquetas): boolean {
  const o = (j ?? {}) as Record<string, unknown>;
  // Señales fuertes: campos de tienda o canal «… - Topic».
  if (texto(o.track) || texto(o.album) || texto(o.genre) || /music|musicbrainz/i.test(texto(o.category))) return true;
  if (/\s-\s*Topic$/i.test(texto(o.uploader))) return true;
  if (Array.isArray(o.artists) && o.artists.length) return true;
  const t = etiquetas ?? etiquetasDeSonda(j);
  if (t.album || t.genero) return true;
  const dur = Number(o.duration) || 0;
  // Un directo o un podcast de 3 h no es una canción.
  if (dur > 900) return false;
  // Último recurso: «Artista - Canción» en el TÍTULO. No vale el canal de
  // subida: «Cómo hacer pan», del canal «Cocina», tomaba al canal por artista
  // y se buscaba la letra de una receta.
  return !!separarTitulo(texto(o.title)).artista;
}
