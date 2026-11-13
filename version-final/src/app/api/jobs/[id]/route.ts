// Acciones por job: pausa, reanudar, cancelar, reintentar, quitar, mover
import { guard, blocked } from "@/lib/server/guard";
import { z } from "zod";
import { action } from "@/lib/server/jobs";

const Body = z.object({ action: z.enum(["pause", "resume", "cancel", "retry", "remove", "move"]), to: z.number().int().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !/^[a-z0-9]{1,12}$/.test(id)) return Response.json({ error: "Petición inválida" }, { status: 400 });
  const ok = action(id, parsed.data.action, parsed.data.to);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
