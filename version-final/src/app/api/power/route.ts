// Apagado del equipo al terminar la cola (fase 9).
import { guard, blocked } from "@/lib/server/guard";
import { cancelarApagado, estadoApagado, programarApagado } from "@/lib/server/power";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(estadoApagado());
}

export async function POST(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  const body = (await req.json().catch(() => ({}))) as { action?: string; segundos?: number };
  if (body.action === "cancelar") {
    const r = cancelarApagado();
    return Response.json({ ...estadoApagado(), ...r }, { status: r.ok ? 200 : 500 });
  }
  const r = programarApagado(body.segundos ?? 60);
  return Response.json({ ...estadoApagado(), ...r }, { status: r.ok ? 200 : 400 });
}
