// Caché de «vista previa» (metadatos de un link).
//
// ── POR QUÉ ────────────────────────────────────────────────────────────────
// Un sondeo de yt-dlp cuesta entre 1 y 20 s (según sitio, si hay PO Tokens,
// cookies, etc.). Y se hacía TRES veces para el mismo link sin necesidad:
//   1) al pulsar «Vista previa»,
//   2) otra vez si el usuario volvía a pulsar,
//   3) y otra dentro del trabajo, para sacar el título y los códecs reales.
// Con esta caché, pulsar «Vista previa» y luego «Descargar» arranca sin volver
// a extraer nada: la ficha y el motor leen del mismo sitio.
//
// Reglas:
//  · TTL corto (10 min por defecto): si un vídeo cambia de título o de formats,
//    no nos quedamos con datos viejos toda la sesión.
//  · Tope de entradas y de tamaño: pegar 200 links no puede comerse la RAM (el
//    JSON de yt-dlp de un vídeo trae todos sus formats, fácilmente 200 KB).
//  · Nunca guarda errores: solo resultados buenos. Un fallo se reintenta.
import type { VideoCodec } from "@/lib/shared/codecs";

export interface DatosSonda {
  /** JSON completo de yt-dlp (o de gallery-dl), tal cual. */
  crudo: unknown;
  /** Respuesta ya preparada para la ficha de la UI. */
  respuesta: Record<string, unknown>;
  /** Instante en que se guardó. */
  at: number;
  /** Bytes aproximados del crudo, para el tope de memoria. */
  bytes: number;
}

const TTL_MS = 10 * 60_000;
const MAX_ENTRADAS = 60;
const MAX_BYTES = 24 * 1024 * 1024; // 24 MB de JSON: sobra para 60 fichas

const cache = new Map<string, DatosSonda>(); // la clave ya incluye el modo

/** La clave incluye el modo porque el motor puede cambiar con él. */
export function claveSonda(url: string, modo: string): string {
  return `${modo}::${url}`;
}

function estimarBytes(v: unknown): number {
  try { return JSON.stringify(v).length; } catch { return 1_000_000; }
}

function purgar(): void {
  const ahora = Date.now();
  for (const [k, v] of cache) if (ahora - v.at > TTL_MS) cache.delete(k);
  // Si sigue pasado de tamaño, se tiran los más viejos (Map conserva el orden).
  let total = 0;
  for (const v of cache.values()) total += v.bytes;
  while ((total > MAX_BYTES || cache.size > MAX_ENTRADAS) && cache.size) {
    const [k, v] = cache.entries().next().value as [string, DatosSonda];
    cache.delete(k);
    total -= v.bytes;
  }
}

export function leerSonda(clave: string, ttlMs = TTL_MS): DatosSonda | null {
  const v = cache.get(clave);
  if (!v) return null;
  if (Date.now() - v.at > ttlMs) { cache.delete(clave); return null; }
  return v;
}

export function guardarSonda(clave: string, crudo: unknown, respuesta: Record<string, unknown>): void {
  const bytes = estimarBytes(crudo);
  // Un JSON absurdo (un perfil de 5000 entradas) no entra: no lo queremos en RAM.
  if (bytes > MAX_BYTES / 4) return;
  cache.set(clave, { crudo, respuesta, at: Date.now(), bytes });
  purgar();
}

export function limpiarSondas(): void { cache.clear(); }
export const tamanoSondas = () => cache.size;

/**
 * Códec de audio del mejor stream de solo-audio, a partir del JSON de yt-dlp.
 * Vive aquí porque lo usan tanto la ficha como el trabajo (una sola verdad).
 */
export function mejorAudioDe(j: unknown): { codec?: string; abr?: number; ext?: string } {
  const formatos = ((j as { formats?: unknown[] })?.formats ?? []) as { acodec?: string; vcodec?: string; abr?: number; ext?: string }[];
  const audios = formatos
    .filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  const mejor = audios[0];
  return { codec: mejor?.acodec, abr: mejor?.abr, ext: mejor?.ext };
}

/** Resoluciones disponibles (alturas), de mayor a menor. */
export function alturasDe(j: unknown): number[] {
  const formatos = ((j as { formats?: unknown[] })?.formats ?? []) as { height?: number }[];
  return [...new Set(formatos.map((f) => f.height).filter((h): h is number => typeof h === "number" && h > 0))].sort((a, b) => b - a);
}

/** Tamaño aproximado del mejor vídeo (o del archivo directo). */
export function tamanoDe(j: unknown): number | undefined {
  const formatos = ((j as { formats?: unknown[] })?.formats ?? []) as { filesize?: number; filesize_approx?: number; vcodec?: string }[];
  const tam = (f?: { filesize?: number; filesize_approx?: number }) => f?.filesize ?? f?.filesize_approx ?? 0;
  const mayor = formatos.filter((f) => f.vcodec && f.vcodec !== "none").sort((a, b) => tam(b) - tam(a))[0];
  const n = Number((j as { filesize_approx?: number })?.filesize_approx ?? tam(mayor) ?? 0) || 0;
  return n > 0 ? n : undefined;
}

/** Solo para tipos: el códec pedido en Ajustes. */
export type _Codec = VideoCodec;
