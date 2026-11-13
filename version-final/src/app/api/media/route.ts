// Preview local con Range requests (sin copias temporales). Solo sirve archivos registrados en el historial.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getHistory } from "@/lib/server/store";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", opus: "audio/ogg", ogg: "audio/ogg", mp4: "video/mp4", mov: "video/mp4", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const item = getHistory().find((h) => h.id === id);
  if (!item) return new Response("No encontrado", { status: 404 });
  const file = path.resolve(item.path);
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return new Response("Archivo no existe", { status: 404 }); }
  if (!stat.isFile()) return new Response("No es archivo", { status: 400 });
  const type = MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m?.[1] ? parseInt(m[1]) : 0;
    const end = m?.[2] ? Math.min(parseInt(m[2]), stat.size - 1) : Math.min(start + 4 * 1024 * 1024, stat.size - 1);
    if (start >= stat.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const s = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(s, { status: 206, headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1) } });
  }
  const s = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(s, { headers: { "Content-Type": type, "Content-Length": String(stat.size), "Accept-Ranges": "bytes" } });
}
