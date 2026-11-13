// Panel "Motor vivo": estado de los 12 motores y re-escaneo
import { guard, blocked } from "@/lib/server/guard";
import { getEngines, scanEngines } from "@/lib/server/engines";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getEngines());
}
export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  return Response.json(await scanEngines());
}
