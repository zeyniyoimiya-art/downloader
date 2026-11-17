// Etiquetado final y carátula: una pasada de ffmpeg, sin recodificar, con red.
//
// ── LAS TRES REGLAS ────────────────────────────────────────────────────────
//  1. NO RECODIFICAR: `-c copy` siempre. El audio y el vídeo salen byte a byte
//     iguales; sólo cambian las etiquetas y, si toca, se añade la carátula.
//  2. NO ESCALAR LA IMAGEN: la portada entra con su tamaño original. Si viene
//     en WebP/AVIF/GIF (que un APIC no admite) se CONVIERTE a JPG sin tocar el
//     ancho ni el alto: comprobado en vivo, 1000x1000 sigue siendo 1000x1000.
//     Nada de `-vf scale` ni de `-aspect`: una carátula cuadrada es cuadrada.
//  3. NO PERDER NADA: el archivo nuevo se escribe aparte, se verifica con
//     ffprobe y sólo entonces sustituye al original. Si algo falla, el archivo
//     que el usuario tiene delante sigue intacto y el trabajo lo cuenta.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { carpetasVendor, resolveEngine } from "./engines";
import { argsDeEtiquetas, familiaDe, soporteCaratula, type Etiquetas } from "@/lib/shared/etiquetas";

const AUDIO = new Set(["mp3", "m4a", "m4b", "flac", "opus", "ogg", "oga", "wav", "aiff", "aif", "mka", "mp2", "ac3", "eac3", "dts", "aac"]);
const VIDEO = new Set(["mp4", "mkv", "webm", "mov", "m4v", "ts", "flv", "avi"]);

export const extDe = (f: string) => (f.split(".").pop() ?? "").toLowerCase();
export const esAudio = (f: string) => AUDIO.has(extDe(f));
export const esVideo = (f: string) => VIDEO.has(extDe(f));
export const esImagen = (f: string) => ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "tiff", "tif", "heic"].includes(extDe(f));

/** Ruta a un binario del inventario, con PATH de `vendor` delante (como jobs.ts). */
function bin(id: "ffmpeg" | "ffprobe"): string | null {
  return resolveEngine(id);
}

function pathConVendor(): string {
  const sep = process.platform === "win32" ? ";" : ":";
  const actual = process.env.PATH ?? process.env.Path ?? "";
  const dirs = carpetasVendor().filter((d) => { try { return fs.existsSync(d); } catch { return false; } });
  return [...dirs, actual].filter(Boolean).join(sep);
}

/** Ejecuta y devuelve stdout; rechaza con el stderr real (no con "falló"). */
function capturar(ruta: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "", err = "";
    let p;
    try {
      p = spawn(ruta, args, { shell: false, windowsHide: true, env: { ...process.env, PATH: pathConVendor() } });
    } catch (e) { return reject(e); }
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} reject(new Error("timeout")); }, timeout);
    p.stdout?.on("data", (d: Buffer) => (out += d.toString("utf8")));
    p.stderr?.on("data", (d: Buffer) => (err += d.toString("utf8")));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (c) => {
      clearTimeout(t);
      if (c === 0) return resolve(out);
      reject(new Error((err.trim() || `código ${c}`).slice(0, 300)));
    });
  });
}

// ── Inspección ───────────────────────────────────────────────────────────────

export interface InfoArchivo {
  duracion: number;
  formato: string;
  bitrate: number;
  audio?: { codec: string; canales?: number; hz?: number; kbps?: number };
  video?: { codec: string; ancho: number; alto: number; fps?: number };
  /** ¿Ya trae una portada incrustada? */
  cover: boolean;
  coverTamano?: { ancho: number; alto: number; codec: string };
  etiquetas: Record<string, string>;
}

/** ffprobe → resumen tipado. `null` si el binario no está o el archivo no se lee. */
export async function inspeccionar(archivo: string): Promise<InfoArchivo | null> {
  const fp = bin("ffprobe");
  if (!fp) return null;
  try {
    const crudo = await capturar(fp, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", archivo], 20000);
    const j = JSON.parse(crudo) as {
      format?: { duration?: string; format_name?: string; bit_rate?: string; tags?: Record<string, string> };
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; channels?: number; sample_rate?: string; bit_rate?: string; avg_frame_rate?: string; disposition?: { attached_pic?: number }; tags?: Record<string, string> }[];
    };
    const streams = j.streams ?? [];
    const a = streams.find((s) => s.codec_type === "audio");
    const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
    const cov = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic);
    const fps = v?.avg_frame_rate?.split("/").map(Number);
    return {
      duracion: parseFloat(j.format?.duration ?? "0") || 0,
      formato: j.format?.format_name ?? "",
      bitrate: parseInt(j.format?.bit_rate ?? "0", 10) || 0,
      audio: a ? {
        codec: a.codec_name ?? "", canales: a.channels, hz: parseInt(a.sample_rate ?? "0", 10) || undefined,
        kbps: a.bit_rate ? Math.round(parseInt(a.bit_rate, 10) / 1000) : undefined,
      } : undefined,
      video: v ? {
        codec: v.codec_name ?? "", ancho: v.width ?? 0, alto: v.height ?? 0,
        fps: fps && fps.length === 2 && fps[1] ? Math.round((fps[0] / fps[1]) * 100) / 100 : undefined,
      } : undefined,
      cover: !!cov,
      coverTamano: cov ? { ancho: cov.width ?? 0, alto: cov.height ?? 0, codec: cov.codec_name ?? "" } : undefined,
      // Las etiquetas de Ogg/Opus viven en el stream, no en el formato: se juntan.
      etiquetas: { ...(j.format?.tags ?? {}), ...(a?.tags ?? {}), ...(v?.tags ?? {}) },
    };
  } catch { return null; }
}

// ── Preparar la carátula (sin escalarla) ─────────────────────────────────────

/** Extensiones que un APIC/covr admite tal cual. */
const COVER_DIRECTO = new Set(["jpg", "jpeg", "png"]);

/**
 * Deja la portada en un archivo que ffmpeg pueda copiar sin tocarla.
 * Si ya es JPG/PNG se devuelve la misma ruta (cero pasadas). Si no, se convierte
 * a JPG **sin filtros de escala** y se dice cuál es el temporal para borrarlo.
 */
export async function prepararPortada(original: string, dir: string): Promise<{ ruta: string; temporal: boolean; motivo?: string } | null> {
  if (!original || !fs.existsSync(original)) return null;
  const ext = extDe(original);
  if (COVER_DIRECTO.has(ext)) return { ruta: original, temporal: false };
  const ff = bin("ffmpeg");
  if (!ff) return null;
  const salida = path.join(dir, `cover-${Date.now()}.jpg`);
  try {
    // `-c:v mjpeg` a secas: mismas dimensiones, otro códec. Sin `scale`, sin
    // `crop`, sin `pad`. (En la prueba: 1000x1000 webp → 1000x1000 jpg.)
    await capturar(ff, ["-hide_banner", "-loglevel", "error", "-y", "-i", original, "-c:v", "mjpeg", "-q:v", "2", "-frames:v", "1", salida], 60000);
    if (fs.existsSync(salida) && fs.statSync(salida).size > 0) {
      return { ruta: salida, temporal: true, motivo: `carátula ${ext.toUpperCase()} convertida a JPG sin cambiar el tamaño` };
    }
  } catch { /* se intenta sin carátula; las etiquetas no dependen de ella */ }
  return null;
}

// ── La pasada de etiquetado ──────────────────────────────────────────────────

export interface ResultadoEtiquetas {
  ok: boolean;
  /** Cuántos campos se escribieron. */
  campos: number;
  cover: "incrustada" | "ya-estaba" | "no-soportada" | "sin-carátula";
  motivo?: string;
}

/** Límite de tamaño para reescribir un archivo (copiar 30 GB para poner tags no). */
const MAX_REESCRITURA = 8 * 1024 * 1024 * 1024;

/**
 * Escribe etiquetas (y carátula, si cabe) en el archivo, sin recodificar.
 * Idempotente: si ya tiene las etiquetas y la portada, no hace nada.
 */
export async function etiquetarArchivo(
  archivo: string,
  etiquetas: Etiquetas,
  opciones: { cover?: string | null; sinCaratula?: boolean } = {},
): Promise<ResultadoEtiquetas> {
  const fam = familiaDe(archivo);
  if (fam === "ninguna") return { ok: false, campos: 0, cover: "no-soportada", motivo: "ese contenedor no guarda metadatos (ADTS/AC-3/DTS…)" };
  const ff = bin("ffmpeg");
  if (!ff) return { ok: false, campos: 0, cover: "no-soportada", motivo: "ffmpeg no está disponible" };
  let st: fs.Stats;
  try { st = fs.statSync(archivo); } catch { return { ok: false, campos: 0, cover: "sin-carátula", motivo: "el archivo ya no está" }; }
  if (st.size > MAX_REESCRITURA) {
    return { ok: false, campos: 0, cover: "sin-carátula", motivo: `el archivo pesa ${(st.size / 1024 ** 3).toFixed(1)} GB: reescribirlo para etiquetarlo no compensa` };
  }

  const meta = argsDeEtiquetas(etiquetas, archivo);
  const info = await inspeccionar(archivo);
  const yaTieneCover = !!info?.cover;

  // ¿Hace falta tocar el archivo? Si no hay ni una etiqueta nueva ni portada
  // por poner, se devuelve sin una pasada de ffmpeg (y sin copiar 200 MB).
  const soporte = soporteCaratula(archivo);
  const quiereCover = !opciones.sinCaratula && !!opciones.cover && soporte.si && !yaTieneCover;
  if (!meta.length && !quiereCover) {
    return {
      ok: false, campos: 0,
      cover: yaTieneCover ? "ya-estaba" : (soporte.si ? "sin-carátula" : "no-soportada"),
      motivo: yaTieneCover ? undefined : soporte.motivo,
    };
  }

  const dir = path.dirname(archivo);
  const ext = extDe(archivo);
  const tmp = path.join(dir, `.ly-tag-${process.pid}-${Date.now()}.${ext}`);

  // La carátula, lista para copiar sin escalar.
  let cover: { ruta: string; temporal: boolean; motivo?: string } | null = null;
  if (quiereCover) {
    // Si la portada no se puede preparar, se siguen escribiendo las etiquetas:
    // la carátula es un extra, no el objetivo.
    cover = await prepararPortada(opciones.cover as string, dir);
  }

  const argv = ["-hide_banner", "-loglevel", "error", "-y", "-i", archivo];
  const conCover = quiereCover && !!cover;
  if (conCover) argv.push("-i", cover!.ruta);
  // `-map 0` arrastra TODAS las pistas (audio, vídeo, subtítulos, capítulos):
  // el archivo sale con lo mismo que tenía, más las etiquetas.
  argv.push("-map", "0", "-c", "copy");
  if (conCover) {
    if (soporte.modo === "adjunto") {
      // Matroska: la carátula es un ADJUNTO, no una pista de vídeo. Como pista
      // de vídeo (lo que hace `-map 1:v`) el archivo acaba con un "vídeo" de un
      // fotograma que algunos reproductores intentan reproducir. Comprobado.
      argv.push("-attach", cover!.ruta, "-metadata:s:t", `mimetype=${extDe(cover!.ruta) === "png" ? "image/png" : "image/jpeg"}`, "-metadata:s:t", `filename=cover.${extDe(cover!.ruta)}`);
    } else {
      argv.push("-map", "1:v", "-disposition:v:0", "attached_pic", "-metadata:s:v:0", "title=Carátula", "-metadata:s:v:0", "comment=Cover (front)");
    }
  }
  argv.push(...meta, tmp);

  try {
    await capturar(ff, argv, esVideo(archivo) ? 15 * 60_000 : 5 * 60_000);
  } catch (e) {
    limpiar(tmp, cover);
    return { ok: false, campos: 0, cover: "sin-carátula", motivo: `ffmpeg no pudo escribir las etiquetas: ${(e as Error).message.slice(0, 160)}` };
  }

  // Verificación ANTES de sustituir: tamaño razonable y ffprobe lo lee.
  const nuevo = await inspeccionar(tmp).catch(() => null);
  let okTamano = false;
  try { okTamano = fs.statSync(tmp).size > 1024; } catch { okTamano = false; }
  const duracionOk = !info?.duracion || !nuevo?.duracion || Math.abs(nuevo.duracion - info.duracion) < 2;
  if (!okTamano || !nuevo || !duracionOk) {
    limpiar(tmp, cover);
    return { ok: false, campos: 0, cover: "sin-carátula", motivo: "el archivo etiquetado no pasó la verificación; se dejó el original" };
  }

  // Sustitución conservando la fecha de modificación (el historial no salta).
  try {
    reemplazar(tmp, archivo, st);
  } catch (e) {
    limpiar(tmp, cover);
    return { ok: false, campos: 0, cover: "sin-carátula", motivo: `no se pudo sustituir el archivo: ${(e as Error).message.slice(0, 120)}` };
  }
  limpiar(tmp, cover);

  return {
    ok: true,
    campos: meta.length / 2,
    cover: conCover ? "incrustada" : (yaTieneCover ? "ya-estaba" : (soporte.si ? "sin-carátula" : "no-soportada")),
    motivo: conCover ? cover?.motivo : (soporte.si ? undefined : soporte.motivo),
  };
}

function limpiar(tmp: string, cover: { ruta: string; temporal: boolean } | null) {
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  if (cover?.temporal) { try { fs.unlinkSync(cover.ruta); } catch {} }
}

/**
 * Rename con reintentos. En Windows, el antivirus o el indexador mantienen el
 * archivo abierto un instante y `rename` devuelve EPERM/EBUSY: se reintenta y,
 * como último recurso, se copia encima (no atómico, pero el contenido es nuevo).
 */
function reemplazar(desde: string, hacia: string, original: fs.Stats) {
  const codigos = new Set(["EPERM", "EBUSY", "EACCES"]);
  let ultimo: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      fs.renameSync(desde, hacia);
      try { fs.utimesSync(hacia, original.atime, original.mtime); } catch {}
      return;
    } catch (e) {
      ultimo = e;
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (!codigos.has(code)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120 * (i + 1));
    }
  }
  try {
    fs.copyFileSync(desde, hacia);
    fs.unlinkSync(desde);
    try { fs.utimesSync(hacia, original.atime, original.mtime); } catch {}
  } catch {
    throw ultimo instanceof Error ? ultimo : new Error("rename falló");
  }
}
