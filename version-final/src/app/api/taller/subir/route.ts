// Subida de un archivo local al taller, SIN pasarlo por memoria.
//
// ── POR QUÉ STREAMING ───────────────────────────────────────────────────────
// `req.formData()` bufferea el cuerpo completo en RAM: soltar un MKV de 8 GB
// tumbaría el proceso. Aquí el cuerpo se copia a disco trozo a trozo con un
// `pipeline`, así que el consumo de memoria es constante (unos pocos MB) y el
// archivo aterriza en ~/.linyue/taller/entrada/ listo para ffmpeg.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { guard, blocked } from "@/lib/server/guard";
import { DATA_DIR } from "@/lib/server/store";
import { encolarTaller, listarTaller } from "@/lib/server/taller";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const LIMITE = 16 * 1024 * 1024 * 1024; // 16 GB: por encima, mejor convertirlo a mano

export async function POST(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  const nombreCrudo = req.headers.get("x-nombre") ?? "";
  const nombre = (() => {
    try { return decodeURIComponent(nombreCrudo); } catch { return ""; }
  })();
  // Solo el nombre, sin rutas: nada de «../../windows/system32».
  const limpio = path.basename(nombre).replace(/[\\/:*?"<>|]/g, "_").slice(-120);
  if (!limpio || !limpio.includes(".")) return Response.json({ error: "Falta el nombre del archivo" }, { status: 400 });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > LIMITE) return Response.json({ error: "Archivo demasiado grande (máx. 16 GB)" }, { status: 413 });
  if (!req.body) return Response.json({ error: "Cuerpo vacío" }, { status: 400 });

  const destino = req.headers.get("x-destino") ?? "audio";
  const formato = (req.headers.get("x-formato") ?? "mp3").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "mp3";

  const carpeta = path.join(DATA_DIR, "taller", "entrada");
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = path.join(carpeta, `${Date.now()}-${limpio}`);

  try {
    await pipeline(Readable.fromWeb(req.body as import("stream/web").ReadableStream), fs.createWriteStream(ruta));
  } catch (e) {
    try { fs.rmSync(ruta, { force: true }); } catch {}
    return Response.json({ error: e instanceof Error ? e.message : "Se cortó la subida" }, { status: 500 });
  }

  const num = (h: string | null) => {
    const n = Number(h);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const t = encolarTaller({
    ruta,
    destino: destino as "audio" | "video" | "copia",
    formato,
    crf: num(req.headers.get("x-crf")) ?? 23,
    desde: num(req.headers.get("x-desde")),
    hasta: num(req.headers.get("x-hasta")),
    normalizar: req.headers.get("x-normalizar") === "1",
  }, limpio);
  return Response.json({ tareas: listarTaller(), tarea: t }, { status: 202 });
}
