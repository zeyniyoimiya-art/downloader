// Historial local (history.json).
//
// Además de devolverlo, se anota qué archivos siguen existiendo: la UI lo usa
// para enseñar «archivo ya no está» en vez de ofrecer un botón de carpeta que
// abriría cualquier cosa. Y se colapsan las descargas repetidas del MISMO
// archivo, que llenaban Recientes de tarjetas idénticas.
import fs from "node:fs";
import path from "node:path";
import { guard, blocked } from "@/lib/server/guard";
import { getHistory, removeHistory } from "@/lib/server/store";
export const dynamic = "force-dynamic";

export async function GET() {
  const vistos = new Set<string>();
  const salida = getHistory()
    .filter((h) => {
      // La clave es la RUTA, no la URL: bajar dos veces el mismo vídeo a sitios
      // distintos sí son dos archivos; el mismo archivo dos veces, no.
      const clave = path.resolve(h.path);
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    })
    .map((h) => {
      let existe = false;
      try { existe = fs.statSync(h.path).isFile(); } catch {}
      return { ...h, existe };
    });
  return Response.json(salida);
}

export async function DELETE(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]{1,12}$/.test(id)) return Response.json({ error: "id inválido" }, { status: 400 });
  removeHistory(id);
  return Response.json({ ok: true });
}
