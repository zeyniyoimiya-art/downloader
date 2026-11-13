// Taller: convertir / recortar / comprimir un archivo que YA está en tu disco.
//
// ── POR QUÉ NO PASA POR yt-dlp ──────────────────────────────────────────────
// No hay nada que descargar: es ffmpeg y punto. Meterlo en la cola de descargas
// obligaría a inventar una URL falsa y a que el motor fallara. Es una cola
// aparte, con su propio progreso, y usa la MISMA tabla de códecs que las
// descargas (`codecs.ts`): si el catálogo dice AC-3, el archivo sale AC-3.
//
// Todo lo de este archivo es puro: el servidor solo lo usa.

import { audioTarget, videoCodecDef, type VideoCodec } from "./codecs";

export type DestinoTaller = "audio" | "video" | "copia";

export interface OpcionesTaller {
  /** Archivo de entrada (ruta absoluta en el equipo). */
  ruta: string;
  destino: DestinoTaller;
  /** Extensión de salida: mp3, m4a, opus, mp4, mkv, webm… */
  formato: string;
  /** Códec de vídeo (solo si destino = video). */
  codec?: VideoCodec;
  /** Calidad: 18 (casi sin pérdida) … 32 (archivo pequeño). */
  crf?: number;
  /** Recorte en segundos, sobre el archivo. */
  desde?: number | null;
  hasta?: number | null;
  /** Normalizar el volumen (loudnorm EBU R128) — útil para pódcast. */
  normalizar?: boolean;
}

/** Códec de audio que se le pone al vídeo convertido. */
const AUDIO_PARA: Record<string, string> = { webm: "libopus", ogv: "libvorbis", avi: "libmp3lame", mp4: "aac", m4v: "aac", mov: "aac", mkv: "aac" };

/** Quita la carpeta y la extensión: «C:\x\Audio.mp4» → «Audio». */
export function sinExtension(ruta: string): string {
  const base = ruta.split(/[\\/]/).pop() ?? ruta;
  return base.replace(/\.[^.]+$/, "");
}

/** «C:\x\Audio.mp4» + «mp3» → «C:\x\Audio (taller).mp3». */
export function nombreSalida(ruta: string, formato: string): string {
  const carpeta = ruta.slice(0, ruta.length - (ruta.split(/[\\/]/).pop() ?? "").length);
  return `${carpeta}${sinExtension(ruta)} (taller).${formato}`;
}

/** Texto del recorte: «1:00-2:30» → { desde: 60, hasta: 150 }. */
export function recorteATexto(desde: number | null | undefined, hasta: number | null | undefined): string {
  const hhmmss = (n: number) => {
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = Math.floor(n % 60);
    const p = (v: number) => String(v).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  };
  if (desde == null && hasta == null) return "";
  return `${desde != null ? hhmmss(desde) : "0:00"}-${hasta != null ? hhmmss(hasta) : "fin"}`;
}

/**
 * Argumentos de ffmpeg para el taller.
 *
 * Detalles que importan:
 *  · `-progress pipe:1` + `-nostats`: el progreso sale en líneas clave=valor que
 *    se pueden parsear, sin el ruido de la barra de estado.
 *  · `-ss` DESPUÉS de `-i`: corta con precisión (al principio de la entrada es
 *    más rápido pero puede caer en el keyframe anterior).
 *  · `-to` con el tiempo absoluto del original, que es como lo piensa el usuario.
 *  · `-map_metadata 0` conserva título/artista al cambiar de contenedor; sin él,
 *    un MP3 convertido a M4A pierde la etiqueta y la carátula.
 */
export function argsTaller(o: OpcionesTaller): string[] {
  const out = nombreSalida(o.ruta, o.formato);
  const a: string[] = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", o.ruta];

  if (o.desde != null && o.desde > 0) a.push("-ss", String(o.desde));
  if (o.hasta != null && (o.desde == null || o.hasta > o.desde)) a.push("-to", String(o.hasta));

  if (o.destino === "copia") {
    a.push("-c", "copy", "-map_metadata", "0");
  } else if (o.destino === "audio") {
    const t = audioTarget(o.formato);
    a.push("-vn", "-c:a", t.ffmpegEncoder ?? "copy", ...t.encArgs);
    if (o.normalizar) a.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
  } else {
    const def = videoCodecDef((o.codec ?? "auto") as VideoCodec);
    const crf = Math.min(32, Math.max(14, Math.round(o.crf ?? 23)));
    a.push("-c:v", def.encoder ?? "libx264");
    // Los códecs que no aceptan -crf (o que no lo necesitan) se dejan como están.
    if (def.encArgs?.some((x) => x === "-crf") || def.encoder === "libx264" || def.encoder === "libx265" || def.encoder === "libvpx-vp9" || def.encoder === "libsvtav1") {
      a.push("-crf", String(crf), "-preset", "medium");
    } else {
      a.push(...(def.encArgs ?? []));
    }
    a.push("-c:a", AUDIO_PARA[o.formato] ?? "aac", "-b:a", "192k");
    if (o.normalizar) a.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
  }

  a.push("-map_metadata", "0", out);
  return a;
}

/** Segundos de `out_time_us=` / `out_time_ms=` de `-progress pipe:1`. */
export function segundosDeProgreso(linea: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(linea.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n / 1_000_000; // ambas claves vienen en microsegundos (sí, también «ms»)
}

/** Porcentaje 0–100 a partir de los segundos y la duración del archivo. */
export function porcentaje(segundos: number, duracion: number): number {
  if (!duracion || duracion <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((segundos / duracion) * 100)));
}

/**
 * ¿Tiene sentido esta conversión? Evita el caso clásico: elegir MP3 para un MP3
 * y recodificar perdiendo calidad sin ganar nada.
 */
export function avisoConversion(ruta: string, formato: string, destino: DestinoTaller): string | null {
  const ext = (ruta.split(".").pop() ?? "").toLowerCase();
  if (destino === "copia") return null;
  if (ext === formato.toLowerCase()) return `Ya es ${formato.toUpperCase()}: solo tiene sentido si vas a recortar o comprimir.`;
  return null;
}
