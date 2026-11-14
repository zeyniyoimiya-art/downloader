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
}

/** Metadatos del track con oEmbed (público, sin claves ni sesión). */
export async function metadatosSpotify(url: string): Promise<PistaSpotify | null> {
  try {
    const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const o = (await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    if (!o.title) return null;
    return { title: o.title, artist: o.author_name ?? "", thumbnail: o.thumbnail_url };
  } catch { return null; }
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

  const palabras = (t: string) => [...new Set(t.split(" ").filter((w) => w.length > 2))];
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
    if (!artistEnCanal && cubreArtista < 0.5) nota -= 45;
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
