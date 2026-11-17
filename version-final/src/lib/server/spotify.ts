// Spotify sin depender de que spotdl acierte.
//
// spotdl hace dos cosas: pedir metadatos a Spotify y bajar el audio de YouTube.
// Cuando la segunda falla (YouTube contesta «confirma que no eres un robot»,
// que es lo normal desde muchas IP), spotdl termina con un error opaco:
//
//   [PYI-23516:ERROR] Failed to execute script '_main_' due to unhandled exception!
//
// y el usuario no ve nada. La app ya no se queda ahí: pide los metadatos con
// la API pública de Spotify (oEmbed, sin credenciales), busca la canción en
// YouTube con yt-dlp y baja el mejor resultado. Es el «plan B» que hace que un
// link de Spotify funcione aunque spotdl no esté o se caiga.
import { normalizar } from "../shared/parecido";

export interface PistaSpotify {
  title: string;
  artist: string;
  thumbnail?: string;
  /** Por qué Spotify dice que no se puede reproducir («COUNTRY_RESTRICTED»…). */
  motivo?: string;
  duracionS?: number;
  /** Todos los artistas del track (el primero es el que se usa para buscar). */
  artistas?: string[];
}

/** El id del track, en cualquiera de las formas del link. */
export function idTrackSpotify(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/(^|\.)spotify\.com$/i.test(u.hostname)) return null;
    const p = u.pathname.split("/").filter(Boolean);
    const i = p.indexOf("track");
    const id = i >= 0 ? p[i + 1] : null;
    return id && /^[A-Za-z0-9]{10,30}$/.test(id) ? id : null;
  } catch { return null; }
}

const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Datos que oEmbed NO da: artista, duración y si la canción es reproducible.
 *
 * oEmbed devuelve sólo el título en muchísimos tracks (los chinos, por ejemplo),
 * y sin artista la búsqueda en YouTube se va a otra canción. La página de
 * *embed* sí trae el JSON completo (`__NEXT_DATA__`): artistas, duración y
 * `playabilityReason` (p. ej. `COUNTRY_RESTRICTED`, que es la diferencia entre
 * «no la encuentro» y «Spotify no la deja escuchar aquí»).
 */
export async function datosDelEmbed(id: string): Promise<Partial<PistaSpotify> | null> {
  try {
    const r = await fetch(`https://open.spotify.com/embed/track/${encodeURIComponent(id)}`, {
      headers: { "user-agent": UA_NAVEGADOR, "accept-language": "es,en" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    return pistaDelEmbedHtml(html);
  } catch { return null; }
}

/** Puro (para poder probarlo sin red): saca la pista del HTML del embed. */
export function pistaDelEmbedHtml(html: string): Partial<PistaSpotify> | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let raiz: unknown;
  try { raiz = JSON.parse(m[1]); } catch { return null; }

  // Se busca el objeto del track: el que tiene «artists» y «duration».
  let track: Record<string, unknown> | null = null;
  const visitar = (n: unknown, prof = 0) => {
    if (track || prof > 12 || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visitar(x, prof + 1); return; }
    const o = n as Record<string, unknown>;
    if (Array.isArray(o.artists) && typeof o.duration === "number") { track = o; return; }
    for (const v of Object.values(o)) visitar(v, prof + 1);
  };
  visitar(raiz);
  if (!track) return null;
  const t = track as Record<string, unknown>;
  const artistas = (t.artists as { name?: string }[]).map((a) => a?.name ?? "").filter(Boolean);
  const motivo = typeof t.playabilityReason === "string" && t.isPlayable === false ? t.playabilityReason : undefined;
  return {
    // Sólo el PRIMER artista: YouTube acredita al principal, y «DJ铁柱, 酷炫»
    // como una sola cadena no aparece nunca en un título ni en un canal.
    artist: artistas[0] ?? "",
    artistas,
    duracionS: typeof t.duration === "number" ? Math.round(t.duration / 1000) : undefined,
    motivo,
  };
}

/**
 * Metadatos del track: oEmbed (título y carátula) + página de embed (artista,
 * duración y si se puede reproducir). Sin claves ni sesión.
 */
export async function metadatosSpotify(url: string): Promise<PistaSpotify | null> {
  let base: PistaSpotify | null = null;
  try {
    const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
    if (r.ok) {
      const o = (await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
      if (o.title) base = { title: o.title, artist: o.author_name ?? "", thumbnail: o.thumbnail_url };
    }
  } catch { /* sigue con el embed */ }

  const id = idTrackSpotify(url);
  const extra = id ? await datosDelEmbed(id) : null;
  if (!base && !extra?.artist) return null;
  const pista: PistaSpotify = {
    title: base?.title ?? "",
    artist: base?.artist || extra?.artist || "",
    thumbnail: base?.thumbnail,
    motivo: extra?.motivo,
    duracionS: extra?.duracionS,
  };
  return pista.title || pista.artist ? pista : null;
}

/** Palabras que delatan una versión que NO es la original. */
const RUIDO = [
  "cover", "covers", "remix", "remixed", "sped up", "spedup", "speed up", "slowed", "nightcore",
  "8d", "instrumental", "karaoke", "reverb", "reaction", "tutorial", "lesson", "tabs", "bass boosted",
  "live", "en vivo", "acoustic version", "ai cover", "mashup", "extended", "1 hour", "10 hours",
];

export interface Candidato {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  webpage_url?: string;
  url?: string;
}

/**
 * Puntúa un resultado de YouTube contra la pista de Spotify.
 * 0..100. Se acepta a partir de 45 (la búsqueda por texto nunca es exacta).
 */
export function puntuarCandidato(c: Candidato, pista: PistaSpotify): number {
  const titulo = normalizar(c.title ?? "");
  const nTitulo = normalizar(pista.title);
  const nArtista = normalizar(pista.artist);
  const autor = normalizar(`${c.uploader ?? ""} ${c.channel ?? ""}`);
  if (!titulo || !nTitulo) return 0;

  // Sin puntuación: «dj铁柱,» y «dj铁柱» tienen que ser la misma palabra.
  const palabras = (t: string) => [...new Set(t.split(/[^0-9a-z\u00c0-\u024f\u4e00-\u9fff]+/).filter((w) => w.length > 2))];
  const parecido = (objetivo: string[]) => {
    if (!objetivo.length) return 0;
    let dentro = 0;
    for (const w of objetivo) if (titulo.includes(w)) dentro++;
    return dentro / objetivo.length;
  };

  const cubreTitulo = parecido(palabras(nTitulo));
  const cubreArtista = parecido(palabras(nArtista));
  let nota = cubreTitulo * 55;
  if (nArtista) nota += cubreArtista * 30;
  else nota += 25; // sin artista en los metadatos: no se puede exigir

  if (titulo === nTitulo) nota += 12;
  else if (titulo.includes(nTitulo)) nota += 8;
  if (nArtista) {
    const artistEnCanal = autor.includes(nArtista);
    if (artistEnCanal) nota += 8;
    // Si el artista no aparece NI en el título NI en el canal, casi siempre es
    // otra canción con el mismo nombre («bad guy» de otro grupo): se hunde.
    if (!artistEnCanal && cubreArtista === 0) nota -= 45;
  }
  if (/topic|vevo|official|records|music/i.test(`${c.uploader ?? ""} ${c.channel ?? ""}`)) nota += 5;

  // Ruido: si el usuario NO pidió una versión rara, se castiga en serio.
  for (const r of RUIDO) {
    if (titulo.includes(r) && !nTitulo.includes(r)) { nota -= 40; break; }
  }
  // Álbumes completos, «1 hour», recopilatorios: no son la canción.
  if (/full album|album stream|\bplaylist\b|\d+ hours?|compilation|megamix/.test(titulo)) nota -= 40;
  // Shorts y clips: no son la canción.
  if (typeof c.duration === "number" && c.duration > 0 && c.duration < 45) nota -= 25;

  return Math.max(0, Math.min(100, nota));
}

export const UMBRAL_CANDIDATO = 55;

/** Elige el mejor candidato de una lista de resultados de YouTube. */
export function elegirCandidato(cands: Candidato[], pista: PistaSpotify): Candidato | null {
  let mejor: Candidato | null = null;
  let mejorNota = 0;
  for (const c of cands) {
    const n = puntuarCandidato(c, pista);
    if (n > mejorNota) { mejorNota = n; mejor = c; }
  }
  return mejorNota >= UMBRAL_CANDIDATO ? mejor : null;
}

/** Texto de búsqueda: «artista canción» sin comillas raras. */
export function consultaDe(pista: PistaSpotify): string {
  return `${pista.artist} ${pista.title}`.replace(/["'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}
