// Miniaturas locales: la vista previa de CUALQUIER archivo del historial.
//
// ── EL FALLO QUE ARREGLA ───────────────────────────────────────────────────
// Recientes sólo tenía `it.thumbnail`, que es la URL del sitio de origen. Para
// una foto de Instagram eso es (a) una URL firmada que caduca, (b) un CDN que
// exige cabeceras y (c) algo que no existe si el archivo lo bajaste hace un mes.
// Resultado: las fotos nunca mostraban vista previa, sólo el icono.
//
// Aquí se genera una miniatura A PARTIR DEL ARCHIVO LOCAL y se cachea:
//   · imagen  → se reduce conservando la proporción (una foto cuadrada sigue
//               siendo cuadrada; nada de recortar a 16:9)
//   · audio   → se extrae la carátula incrustada
//   · vídeo   → un fotograma al 10 % (no el primer frame, que suele ser negro)
// El original NUNCA se modifica: la miniatura es otro archivo, en DATA_DIR.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveEngine } from "@/lib/server/engines";
import { DATA_DIR, getHistory } from "@/lib/server/store";
import { esAudio, esImagen, esVideo, inspeccionar } from "@/lib/server/etiquetar";

export const dynamic = "force-dynamic";

const THUMBS = path.join(DATA_DIR, "thumbs");

function ffmpeg(): string | null {
  return resolveEngine("ffmpeg");
}

function correr(bin: string, args: string[], timeout = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(bin, args, { windowsHide: true }); } catch { return resolve(false); }
    const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} resolve(false); }, timeout);
    p.on("error", () => { clearTimeout(t); resolve(false); });
    p.on("close", (c) => { clearTimeout(t); resolve(c === 0); });
  });
}

/** Anchura pedida, acotada: una miniatura de 4000 px no es una miniatura. */
function anchoValido(v: string | null): number {
  const n = parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return 480;
  return Math.max(64, Math.min(1280, n));
}

function servir(archivo: string, tipo: string, inmutable: boolean) {
  const stat = fs.statSync(archivo);
  const buf = fs.readFileSync(archivo);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(stat.size),
      "Cache-Control": inmutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Contenido": "miniatura",
    },
  });
}

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif", bmp: "image/bmp" };

export type TipoMiniatura = "imagen" | "audio" | "video";

/**
 * Los argumentos de ffmpeg para una miniatura. Función pura y exportada para
 * poder probarla: aquí está la regla de oro —`scale='min(iw,W)':-2` nunca
 * amplía, nunca recorta y mantiene la proporción (una foto cuadrada sigue
 * cuadrada).
 */
export function argsMiniatura(tipo: TipoMiniatura, archivo: string, ancho: number, salida: string, seekSeg = 0): string[] {
  const escala = `scale='min(iw,${ancho})':-2`;
  const base = ["-hide_banner", "-loglevel", "error", "-y"];
  if (tipo === "video") {
    // `-ss` ANTES de `-i`: salto rápido por índice, sin decodificar de cero.
    return [...base, "-ss", Math.max(0, seekSeg).toFixed(1), "-i", archivo, "-frames:v", "1", "-vf", escala, "-q:v", "3", salida];
  }
  if (tipo === "audio") {
    // La carátula incrustada. Si el audio no tiene portada, ffmpeg sale con
    // error y la ruta devuelve 404 (la interfaz pone su icono, no una imagen falsa).
    return [...base, "-i", archivo, "-map", "0:v:0", "-c:v", "mjpeg", "-frames:v", "1", "-vf", escala, salida];
  }
  return [...base, "-i", archivo, "-vf", escala, "-frames:v", "1", "-q:v", "3", salida];
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") ?? "";
  const ancho = anchoValido(u.searchParams.get("w"));
  const item = getHistory().find((h) => h.id === id);
  if (!item) return new Response("No encontrado", { status: 404 });

  let st: fs.Stats;
  try { st = fs.statSync(item.path); } catch { return new Response("Archivo no existe", { status: 404 }); }
  if (!st.isFile()) return new Response("No es un archivo", { status: 400 });

  const ext = (item.path.split(".").pop() ?? "").toLowerCase();
  // La clave lleva la fecha de modificación: si el archivo se reetiqueta o se
  // reemplaza, la miniatura se regenera sola en vez de quedarse vieja.
  const clave = `${id}-${Math.round(st.mtimeMs)}-${ancho}.jpg`;
  const cache = path.join(THUMBS, clave);

  try {
    fs.mkdirSync(THUMBS, { recursive: true });
    if (fs.existsSync(cache) && fs.statSync(cache).size > 200) return servir(cache, "image/jpeg", true);
  } catch { /* sin caché se sigue: se genera al vuelo */ }

  const ff = ffmpeg();

  // ── Imagen: miniatura conservando la proporción ──────────────────────────
  if (esImagen(item.path) || MIME[ext]) {
    if (!ff) {
      // Sin ffmpeg se entrega el original: mejor la foto entera que un hueco.
      return servir(item.path, MIME[ext] ?? "application/octet-stream", false);
    }
    // `scale='min(iw,W)':-2`: nunca amplía (min), nunca recorta y -2 mantiene la
    // proporción con altura par. Comprobado: 1200x1200 → 480x480.
    const ok = await correr(ff, argsMiniatura("imagen", item.path, ancho, cache));
    if (ok && fs.existsSync(cache)) return servir(cache, "image/jpeg", true);
    return servir(item.path, MIME[ext] ?? "application/octet-stream", false);
  }

  if (!ff) return new Response("ffmpeg no disponible", { status: 501 });

  // ── Audio: la carátula incrustada ────────────────────────────────────────
  if (esAudio(item.path)) {
    const ok = await correr(ff, argsMiniatura("audio", item.path, ancho, cache));
    if (ok && fs.existsSync(cache)) return servir(cache, "image/jpeg", true);
    // Sin carátula se dice con un 404 y la rejilla pone su icono. Un PNG de
    // relleno sería mentir sobre el contenido del archivo.
    return new Response("sin carátula", { status: 404 });
  }

  // ── Vídeo: un fotograma al 10 % (el primero suele ser negro o un rótulo) ──
  if (esVideo(item.path)) {
    const info = await inspeccionar(item.path);
    const en = info && info.duracion > 0 ? Math.min(info.duracion * 0.1, 600) : 5;
    const ok = await correr(ff, argsMiniatura("video", item.path, ancho, cache, en));
    if (ok && fs.existsSync(cache)) return servir(cache, "image/jpeg", true);
    // Algún contenedor (por ejemplo un .mkv con pistas raras) puede no dar
    // fotograma; se informa y la interfaz cae al icono.
    return new Response("sin fotograma", { status: 404 });
  }

  return new Response("sin miniatura para ese tipo", { status: 404 });
}
