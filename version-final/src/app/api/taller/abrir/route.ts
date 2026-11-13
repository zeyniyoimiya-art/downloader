// Abrir la carpeta del resultado de una tarea del taller.
import { z } from "zod";
import { guard, blocked } from "@/lib/server/guard";
import { abrirSalida } from "@/lib/server/taller";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  const parsed = z.object({ id: z.string().max(40) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Petición inválida" }, { status: 400 });
  const r = await abrirSalida(parsed.data.id);
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
