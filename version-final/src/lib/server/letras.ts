// Letras: buscarlas, comprobarlas y guardarlas dentro del archivo.
//
// ── POR QUÉ LRCLIB ──────────────────────────────────────────────────────────
// Es la única base abierta, sin clave, sin cuota y con letra SINCRONIZADA (LRC)
// además de la plana. Se probó en vivo antes de escribir esto: devuelve 200 y
// JSON con `plainLyrics` / `syncedLyrics` / `instrumental`.
//
// ── LO IMPORTANTE NO ES BUSCAR, ES NO EQUIVOCARSE ───────────────────────────
// Buscar "Never Gonna Give You Up" devuelve 20 resultados, y el primero es una
// versión japonesa de 4:00. Pegar esa letra en el archivo del usuario sería
// peor que no poner nada: se puntúa título + artista + duración y, si no hay
// coincidencia clara, se devuelve null. Nunca se escribe una letra dudosa.
import { limpiar, quitarRuido } from "@/lib/shared/etiquetas";

export interface Letra {
  /** Texto plano (si la fuente sólo trae LRC, se convierte). */
  texto: string;
  /** true = el original venía con marcas de tiempo [mm:ss.xx]. */
  sincronizada: boolean;
  fuente: "LRCLIB";
}

export interface ConsultaLetra {
  titulo: string;
  artista: string;
  album?: string;
  /** Segundos. Es el filtro que más falsos positivos evita. */
  duracion?: number;
}

const UA = "Linyue Studio/1.8 (+https://github.com/zeyniyoimiya-art/downloader)";
const BASE = "https://lrclib.net/api";

/** Minúsculas, sin acentos, sin puntuación y sin el ruido de YouTube. */
export function comparable(s: string): string {
  return quitarRuido(String(s ?? ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // "(feat. X)", "ft. X", "con X": el artista que aparece suelto no cambia la canción.
    .replace(/[([][^)\]]*(feat|ft|con|with)\.?[^)\]]*[)\]]/gi, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * LRC → texto plano. Conserva el orden y quita las marcas.
 *
 * Hay DOS formatos de marcas y los dos aparecen en LRCLIB:
 *   [00:18.89] línea            (LRC normal)
 *   <00:18.89>palabra <00:19.2> (LRC «enhanced», palabra a palabra)
 * Si sólo se quitaban los corchetes, el archivo acababa con «<00:18.89>we're
 * <00:19.25>no…» pegado dentro y en cualquier reproductor se veía esa basura.
 */
export function lrcAPlano(lrc: string): string {
  return String(lrc ?? "")
    .split(/\r?\n/)
    .map((l) => l
      .replace(/^\s*(?:\[[^\]]*\]\s*)+/g, "")   // marcas de línea al principio
      .replace(/<[^>]*>/g, "")                     // marcas de palabra
      .replace(/\s+/g, " ")
      .trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

interface Candidata {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/**
 * Cuánto se parece una candidata a lo que se busca, de 0 a 120.
 * Título manda (60), artista pesa (40) y la duración sólo desempata (±20).
 */
export function puntuarLetra(c: Candidata, q: ConsultaLetra): number {
  const tq = comparable(q.titulo);
  const tc = comparable(c.trackName ?? "");
  const aq = comparable(q.artista);
  const ac = comparable(c.artistName ?? "");
  if (!tq || !tc) return 0;

  let nota = 0;
  if (tc === tq) nota += 60;
  else if (tc.includes(tq) || tq.includes(tc)) nota += 38;
  else {
    // Palabra a palabra: "never gonna give you up (remaster)" vs "never gonna
    // give you up" ya entra por el `includes`; esto salva el orden distinto.
    const a = new Set(tq.split(" "));
    const b = new Set(tc.split(" "));
    const comunes = [...a].filter((w) => w.length > 2 && b.has(w)).length;
    if (comunes >= Math.max(2, Math.min(a.size, b.size) * 0.6)) nota += 24;
    else return 0;
  }

  if (aq && ac) {
    if (ac === aq) nota += 40;
    else if (ac.includes(aq) || aq.includes(ac)) nota += 26;
    else {
      const a = new Set(aq.split(" "));
      const b = new Set(ac.split(" "));
      if ([...a].some((w) => w.length > 2 && b.has(w))) nota += 12;
      else nota -= 10; // título igual pero OTRO artista: casi siempre es una versión
    }
  } else nota += 10;

  if (q.duracion && c.duration) {
    const d = Math.abs(q.duracion - c.duration);
    if (d <= 3) nota += 20;
    else if (d <= 8) nota += 12;
    else if (d <= 20) nota += 4;
    else if (d > 45) nota -= 15;
  }
  return nota;
}

/** Umbral: por debajo de esto es más honesto dejar el archivo sin letra. */
export const UMBRAL_LETRA = 60;

/** Elige la mejor candidata o null. Prefiere la sincronizada a igualdad. */
export function elegirLetra(cands: Candidata[] | undefined, q: ConsultaLetra): Letra | null {
  if (!Array.isArray(cands) || !cands.length) return null;
  let mejor: { c: Candidata; nota: number } | null = null;
  for (const c of cands) {
    if (c.instrumental) continue; // una instrumental no tiene letra que pegar
    const texto = (c.syncedLyrics || c.plainLyrics || "").trim();
    if (texto.length < 10) continue;
    let nota = puntuarLetra(c, q);
    if (c.syncedLyrics && c.syncedLyrics.trim().length > 10) nota += 5;
    if (!mejor || nota > mejor.nota) mejor = { c, nota };
  }
  if (!mejor || mejor.nota < UMBRAL_LETRA) return null;
  const sincronizada = !!(mejor.c.syncedLyrics && mejor.c.syncedLyrics.trim().length > 10);
  // Dentro del archivo se guarda TEXTO PLANO siempre: la etiqueta `lyrics` no
  // entiende LRC y los reproductores enseñarían las marcas de tiempo. La
  // sincronizada se usa sólo para saber cuál de las dos versiones es mejor.
  const crudo = sincronizada ? mejor.c.syncedLyrics! : (mejor.c.plainLyrics ?? "");
  const texto = sincronizada ? lrcAPlano(crudo) : crudo.trim();
  return { texto: texto.slice(0, 40000), sincronizada, fuente: "LRCLIB" };
}

async function pedir(url: string, ms = 12000): Promise<unknown> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`LRCLIB ${r.status}`);
  return r.json();
}

/**
 * Busca la letra. Devuelve null cuando no hay (o no hay confianza) — nunca lanza:
 * la descarga no puede fallar porque la letra no esté.
 */
export async function buscarLetra(q: ConsultaLetra): Promise<Letra | null> {
  const titulo = limpiar(q.titulo);
  if (!titulo) return null;
  const artista = limpiar(q.artista);
  const params = new URLSearchParams({ track_name: titulo });
  if (artista) params.set("artist_name", artista);
  if (q.album) params.set("album_name", limpiar(q.album));
  if (q.duracion) params.set("duration", String(Math.round(q.duracion)));

  // 1) La consulta exacta (la más fiable). 404 = «no la tengo», no es un error.
  try {
    const uno = (await pedir(`${BASE}/get?${params.toString()}`)) as Candidata;
    const letra = elegirLetra([uno], q);
    if (letra) return letra;
  } catch { /* 404 o red: se prueba la búsqueda abierta */ }

  // 2) Búsqueda abierta y puntuación propia.
  try {
    const lista = (await pedir(`${BASE}/search?${params.toString()}`)) as Candidata[];
    return elegirLetra(Array.isArray(lista) ? lista : [], q);
  } catch { return null; }
}
