// Carátulas: bajarlas en su tamaño real y sacarlas de un archivo ya descargado.
//
// La portada no se toca: se guarda tal cual llega del sitio (JPG/PNG/WebP con
// sus píxeles). El único recorte/escala ocurre en la MINIATURA de la interfaz,
// que es otra cosa y vive en su propia caché (`/api/thumb`).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, TEMP_DIR } from "./store";
import { mejorPortada } from "@/lib/shared/etiquetas";

export const COVERS_DIR = path.join(DATA_DIR, "covers");

function asegurar() {
  try { fs.mkdirSync(COVERS_DIR, { recursive: true }); } catch {}
}

/** Extensión a partir de la URL (sin query) o del Content-Type. */
export function extDeImagen(url: string, contentType?: string | null): string {
  const limpio = (url.split("?")[0].split("#")[0] || "").toLowerCase();
  const m = limpio.match(/\.(jpe?g|png|webp|avif|gif|bmp)$/);
  if (m) return m[1] === "jpeg" ? "jpg" : m[1];
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("avif")) return "avif";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

/** ¿Los primeros bytes son de una imagen de verdad? (no una página de error) */
export function esImagen(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8) return true;                       // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b.slice(0, 4).toString("ascii") === "GIF8") return true;           // GIF
  if (b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP") return true;
  if (b.slice(4, 12).toString("ascii").startsWith("ftypavif")) return true;
  if (b[0] === 0x42 && b[1] === 0x4d) return true;                       // BMP
  return false;
}

/**
 * Descarga una imagen a disco. Devuelve la ruta o null.
 * `destinoBase` es sin extensión: la pone el tipo real de lo que llegue.
 */
export async function descargarImagen(url: string, destinoBase: string, ms = 45000): Promise<string | null> {
  asegurar();
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(ms),
      headers: {
        // Algunos CDN (i.scdn.co, is1-ssl.mzstatic.com) devuelven 403 sin UA.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
      },
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || !esImagen(buf)) return null;
    const destino = `${destinoBase}.${extDeImagen(url, r.headers.get("content-type"))}`;
    fs.writeFileSync(destino, buf);
    return destino;
  } catch { return null; }
}

/**
 * Baja la mejor portada de un JSON de yt-dlp (la de mayor resolución).
 * Devuelve la ruta local o null. Es lo que acaba dentro del archivo.
 */
export async function portadaDeSonda(json: unknown, etiqueta: string): Promise<string | null> {
  const mejor = mejorPortada(json);
  if (!mejor) return null;
  const base = path.join(COVERS_DIR, `cover-${etiqueta.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40)}`);
  // Ya bajada de un trabajo anterior: se reaprovecha (misma URL, mismo archivo).
  for (const ext of ["jpg", "png", "webp", "avif", "gif", "bmp"]) {
    const p = `${base}.${ext}`;
    try { if (fs.existsSync(p) && fs.statSync(p).size > 500) return p; } catch {}
  }
  return descargarImagen(mejor.url, base);
}

/**
 * Saca la carátula incrustada de un archivo a un JPG temporal.
 * Se usa para la miniatura de la lista y para volver a incrustarla si alguna
 * herramienta la hubiera perdido. `null` si el archivo no tiene portada.
 */
export async function extraerPortada(archivo: string, ffmpeg: string, destino: string): Promise<string | null> {
  try { if (fs.existsSync(destino) && fs.statSync(destino).size > 200) return destino; } catch {}
  try { fs.mkdirSync(path.dirname(destino), { recursive: true }); } catch {}
  return new Promise((resolve) => {
    // Sin `-vf scale`: la carátula se guarda con su tamaño original. La
    // reducción para la rejilla la hace /api/thumb sobre ESTA copia.
    const p = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", archivo, "-map", "0:v:0", "-c:v", "mjpeg", "-q:v", "2", "-frames:v", "1", destino], { windowsHide: true });
    p.on("error", () => resolve(null));
    p.on("close", (c: number) => resolve(c === 0 && fs.existsSync(destino) ? destino : null));
  });
}

/** Carpeta temporal para intermedios del etiquetado. */
export function carpetaTemporal(): string {
  try { fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch {}
  return TEMP_DIR;
}
