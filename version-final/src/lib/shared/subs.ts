// Suscripciones: «vigila este canal y baja lo nuevo».
//
// ── CÓMO FUNCIONA ───────────────────────────────────────────────────────────
// Cada suscripción guarda la lista de IDs que YA se vieron. Cada `everyHours`
// se pregunta al sitio (con `--flat-playlist`, que trae solo la lista, sin
// descargar nada) qué hay ahora; los IDs que no están en `seen` son nuevos y se
// encolan como trabajos normales — así heredan cola persistente, ventana
// silenciosa, reintentos, proxy y todo lo demás.
//
// ── DOS REGLAS QUE EVITAN DESASTRES ────────────────────────────────────────
// 1. `maxNuevos` por revisión: si guardas un canal de 5000 vídeos y algo falla,
//    no se te llena el disco de golpe. Se baja un lote y en la siguiente
//    revisión, otro.
// 2. `seen` se PODA a los últimos 3000 IDs: sin poda, subs.json crecería para
//    siempre (un canal diario son ~365 IDs al año, pero un canal histórico
//    puede traer 20 000 en la primera pasada).
//
// Todo lo de aquí es puro (sin fs ni red): el servidor solo lo usa.

export type SubModo = "audio" | "video" | "photo";

export interface Sub {
  id: string;
  /** URL del canal, playlist o perfil. */
  url: string;
  /** Nombre legible (el que da el sitio, o el que pusiste tú). */
  label: string;
  mode: SubModo;
  format: string;
  quality: string;
  /** Cada cuántas horas se revisa. */
  everyHours: number;
  /** Última vez que se revisó (ms). 0 = nunca. */
  lastCheck: number;
  /** Próxima revisión (ms). */
  nextCheck: number;
  /** IDs ya conocidos. */
  seen: string[];
  /** Cuántos como máximo se encolan por revisión. */
  maxNuevos: number;
  /** Último resultado, para enseñarlo en la UI. */
  lastResult?: string;
  /** Errores seguidos: a partir de 5 se deja de reintentar sola. */
  fallos?: number;
}

export const MAX_VISTOS = 3000;
export const MAX_NUEVOS_POR_REVISION = 5;
export const HORAS_MIN = 1;
export const HORAS_MAX = 168;

export function horasValidas(n: number): number {
  if (!Number.isFinite(n)) return 6;
  return Math.min(HORAS_MAX, Math.max(HORAS_MIN, Math.round(n)));
}

/** ¿Toca revisarla ya? */
export function tocaRevisar(sub: Sub, ahora = Date.now()): boolean {
  if ((sub.fallos ?? 0) >= 5) return false;
  return !sub.nextCheck || sub.nextCheck <= ahora;
}

/** Cuándo será la próxima revisión según su intervalo. */
export function proximaRevision(everyHours: number, ahora = Date.now()): number {
  return ahora + horasValidas(everyHours) * 3600_000;
}

/**
 * IDs nuevos, en el orden en que los dio el sitio (los primeros suelen ser los
 * más recientes) y como máximo `limite`.
 */
export function nuevosIds(vistos: string[], encontrados: string[], limite = MAX_NUEVOS_POR_REVISION): string[] {
  const ya = new Set(vistos);
  const salida: string[] = [];
  for (const id of encontrados) {
    if (!id || ya.has(id)) continue;
    ya.add(id); // evita duplicados dentro del propio listado
    salida.push(id);
    if (salida.length >= limite) break;
  }
  return salida;
}

/** Deja solo los últimos `max` IDs (los más recientes van al principio). */
export function podarVistos(vistos: string[], max = MAX_VISTOS): string[] {
  return vistos.length <= max ? vistos : vistos.slice(0, max);
}

export interface EntradaListado {
  id: string;
  /** URL absoluta del elemento, si el motor la dio. */
  url: string | null;
}

/**
 * Interpreta la salida de `yt-dlp --flat-playlist --print "%(id)s %(url)s"`.
 *
 * Las líneas son «id url» separadas por un espacio; `url` puede venir vacía o
 * ser solo el ID (según la versión del motor), por eso se valida.
 */
export function parseListado(salida: string): EntradaListado[] {
  const out: EntradaListado[] = [];
  for (const linea of salida.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t) continue;
    const [id, ...resto] = t.split(/\s+/);
    if (!id || id.length > 200) continue;
    const posible = resto.join(" ").trim();
    out.push({ id, url: /^https?:\/\//i.test(posible) ? posible : null });
  }
  return out;
}

/**
 * Reconstruye la URL de un elemento cuando el motor solo dio el ID.
 *
 * Solo para los sitios cuyo patrón es inequívoco; para el resto se devuelve
 * null y el trabajo se salta con un aviso en el log, en vez de inventarse una
 * URL que llevaría a un 404 silencioso.
 */
export function urlDesdeId(subUrl: string, id: string): string | null {
  if (!/^[\w-]{1,200}$/.test(id)) return null;
  if (/(^|\.)youtube\.com|youtu\.be/i.test(subUrl)) return `https://www.youtube.com/watch?v=${id}`;
  if (/(^|\.)bilibili\.com/i.test(subUrl)) return `https://www.bilibili.com/video/${id}`;
  if (/(^|\.)soundcloud\.com/i.test(subUrl)) return `https://soundcloud.com/${id}`;
  return null;
}

/** Texto corto para la UI: «hace 2 h · cada 6 h». */
export function describirRevision(sub: Sub, ahora = Date.now()): string {
  const rel = (ms: number) => {
    if (!ms) return "nunca";
    const s = Math.max(0, Math.round((ahora - ms) / 1000));
    if (s < 60) return "hace un momento";
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `hace ${Math.round(s / 86400)} d`;
  };
  return `${rel(sub.lastCheck)} · cada ${sub.everyHours} h`;
}
