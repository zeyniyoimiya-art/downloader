// POST /api/engines/update — actualiza los motores que se actualizan solos.
import { guard, blocked } from "@/lib/server/guard";
import { updateEngines } from "@/lib/server/engines";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  return Response.json({ results: await updateEngines() });
}
