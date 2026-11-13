// Recortes y limpieza de lo que bajas: SponsorBlock, secciones y capítulos.
//
// ── POR QUÉ ──────────────────────────────────────────────────────────────────
// Bajar un vídeo de 40 minutos para quedarte con 90 segundos es tirar disco y
// tiempo. Y bajarte un pódcast entero cuando querías los cinco capítulos por
// separado también. Las tres cosas las sabe hacer yt-dlp; aquí solo se validan
// para que un texto escrito a mano no acabe convertido en un argumento raro.
//
// Todo lo de este archivo es PURO (sin fs ni red) para poder testearlo.

export type SponsorBlock = "off" | "marcar" | "quitar";

/**
 * Qué se quita cuando eliges «quitar».
 *
 * `sponsor` y `selfpromo` son lo que molesta a todo el mundo. `intro`/`outro`
 * son discutibles (hay canales cuyo intro es parte del vídeo), pero también son
 * lo que más se pide. `interaction` es el «dale like y suscríbete» de en medio.
 * NO se tocan `preview` ni `music_offtopic`: ahí hay contenido de verdad y
 * cortarlo deja huecos sin sentido.
 */
export const SPONSOR_QUITAR = "sponsor,selfpromo,interaction,intro,outro";

/** Bandera de SponsorBlock para yt-dlp, o nada si está apagado. */
export function argSponsor(modo: SponsorBlock | null | undefined): string[] {
  // Se marcan las mismas categorías que se quitarían: marcar «all» añadiría
  // también rellenos, patrocinios de otros canales y avisos de suscripción.
  if (modo === "marcar") return ["--sponsorblock-mark", SPONSOR_QUITAR];
  if (modo === "quitar") return ["--sponsorblock-remove", SPONSOR_QUITAR];
  return [];
}

/** Texto para la UI: «quita patrocinios e intros del propio vídeo». */
export function describirSponsor(modo: SponsorBlock): string {
  if (modo === "marcar") return "los marca como capítulos, no corta nada";
  if (modo === "quitar") return "quita patrocinio, autopromoción, intro y outro";
  return "deja el vídeo tal cual";
}

const SEG = /^\d{1,2}(?::\d{1,2}){0,2}$/; // "45" · "3:20" · "1:03:20"

function aSegundos(t: string): number | null {
  if (!SEG.test(t)) return null;
  const partes = t.split(":").map(Number);
  if (partes.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let s = 0;
  for (const p of partes) s = s * 60 + p;
  return s;
}

export interface Seccion {
  /** Valor listo para `--download-sections` (con el `*` de «relativo al vídeo»). */
  argumento: string;
  desde: number;
  hasta: number;
}

/**
 * Convierte lo que escribe el usuario en un `--download-sections` seguro.
 *
 * Acepta `1:00-2:30`, `0:45-90`, `*10:00-11:00`, `01:02:03-01:05:00` y también
 * varias secciones separadas por comas (`0:10-0:20, 1:00-1:30`). Devuelve null
 * si no se entiende: es mejor decirlo que pasarle a yt-dlp algo que va a
 * reventar con un mensaje que no explica nada.
 */
export function parseSeccion(texto: string | null | undefined): Seccion | null {
  return parseSecciones(texto)[0] ?? null;
}

/** Igual que `parseSeccion` pero para varias secciones. */
export function parseSecciones(texto: string | null | undefined): Seccion[] {
  const limpio = (texto ?? "").replace(/\s+/g, "");
  if (!limpio) return [];
  const piezas = limpio.split(",").filter(Boolean);
  if (piezas.length > 20) return []; // 20 recortes ya es raro; más, es un error
  const salida: Seccion[] = [];
  for (const pieza of piezas) {
    const m = /^\*?(.+?)-(.+)$/.exec(pieza);
    if (!m) return [];
    const desde = aSegundos(m[1]);
    const hasta = aSegundos(m[2]);
    // Un recorte de 0 segundos o invertido no es un recorte: es un error.
    if (desde === null || hasta === null || hasta <= desde) return [];
    salida.push({ argumento: `*${m[1]}-${m[2]}`, desde, hasta });
  }
  return salida;
}

/** «1:00 → 2:30» para el log y la UI. */
export function describirSeccion(s: Seccion): string {
  const hhmmss = (n: number) => {
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), x = n % 60;
    const p = (v: number) => String(v).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
  };
  return `${hhmmss(s.desde)} → ${hhmmss(s.hasta)} (${s.hasta - s.desde}s)`;
}

/**
 * Plantilla de nombre para cuando se parte por capítulos.
 *
 * Sin esto, `--split-chapters` escribe varios archivos con el MISMO nombre y
 * yt-dlp los va numerando a la fuerza; el resultado es un desastre de nombres.
 * Se usa este solo cuando el usuario activa la opción.
 */
export const TPL_CAPITULOS = "%(section_number)02d — %(section_title).120B [%(id)s].%(ext)s";
