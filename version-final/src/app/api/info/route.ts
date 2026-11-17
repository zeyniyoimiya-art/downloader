// Ficha técnica de un archivo descargado: códec, bitrate, tamaño real y TODAS
// las etiquetas que lleva dentro.
//
// Sirve para dos cosas concretas: que el usuario pueda comprobar que su archivo
// tiene la carátula y la letra (en vez de creerse una promesa) y que, cuando
// algo se ve mal en otro reproductor, se vea de un vistazo qué se escribió.
import fs from "node:fs";
import { getHistory } from "@/lib/server/store";
import { inspeccionar } from "@/lib/server/etiquetar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const item = getHistory().find((h) => h.id === id);
  if (!item) return Response.json({ error: "No encontrado" }, { status: 404 });

  let size = 0;
  try { size = fs.statSync(item.path).size; } catch {
    return Response.json({ error: "El archivo ya no está en esa ruta", existe: false }, { status: 404 });
  }

  const info = await inspeccionar(item.path);
  return Response.json({
    existe: true,
    ruta: item.path,
    tamano: size,
    // Sin ffprobe queda el mínimo honesto: lo que sabe el historial.
    info: info ?? null,
    historial: {
      titulo: item.title, autor: item.author, fuente: item.source,
      formato: item.format, duracion: item.duration,
    },
  });
}
