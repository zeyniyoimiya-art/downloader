// Taller (fase 9): convertir archivos locales. GET lista, POST encola, DELETE quita.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { guard, blocked } from "@/lib/server/guard";
import { cancelarTaller, encolarTaller, listarTaller, quitarTaller } from "@/lib/server/taller";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ tareas: listarTaller() });
}

const Cuerpo = z.object({
  ruta: z.string().min(1).max(1000),
  destino: z.enum(["audio", "video", "copia"]),
  formato: z.string().min(1).max(10),
  codec: z.string().max(20).optional(),
  crf: z.number().int().min(14).max(32).optional(),
  desde: z.number().min(0).max(360000).nullable().optional(),
  hasta: z.number().min(0).max(360000).nullable().optional(),
  normalizar: z.boolean().optional(),
});

export async function POST(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  const parsed = Cuerpo.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Datos inválidos" }, { status: 400 });
  const d = parsed.data;
  // La ruta tiene que existir y ser un archivo: aquí NO se acepta una carpeta
  // (recorrer un árbol entero desde la UI sería un pie para borrar cosas).
  let st: fs.Stats;
  try { st = fs.statSync(d.ruta); } catch { return Response.json({ error: "Ese archivo no existe en este equipo" }, { status: 400 }); }
  if (!st.isFile()) return Response.json({ error: "Eso es una carpeta, no un archivo" }, { status: 400 });
  if (st.size === 0) return Response.json({ error: "El archivo está vacío" }, { status: 400 });
  if (d.hasta != null && d.desde != null && d.hasta <= d.desde) return Response.json({ error: "El recorte termina antes de empezar" }, { status: 400 });
  const t = encolarTaller({ ...d, codec: d.codec as never, ruta: path.resolve(d.ruta) });
  return Response.json({ tareas: listarTaller(), tarea: t }, { status: 202 });
}

export async function DELETE(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const cancelar = url.searchParams.get("cancelar") === "1";
  const ok = cancelar ? cancelarTaller(id) : quitarTaller(id);
  if (!ok) return Response.json({ error: "No existe esa tarea" }, { status: 404 });
  return Response.json({ tareas: listarTaller() });
}
