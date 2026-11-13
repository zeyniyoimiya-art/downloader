// Ajustes locales (config.json)
import { guard, blocked } from "@/lib/server/guard";
import { ConfigSchema, getConfig, resetConfig, saveConfig } from "@/lib/server/store";
import { scanEngines } from "@/lib/server/engines";
import { despertarCola } from "@/lib/server/jobs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getConfig());
}
export async function PUT(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const parsed = ConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const prev = getConfig();
  saveConfig(parsed.data);
  if (prev.vendorDir !== parsed.data.vendorDir || JSON.stringify(prev.enginePaths) !== JSON.stringify(parsed.data.enginePaths)) await scanEngines();
  // La ventana silenciosa (o el paralelismo) cambió: recalcula cuándo despertar.
  if (prev.quietEnabled !== parsed.data.quietEnabled || prev.quietFrom !== parsed.data.quietFrom || prev.quietTo !== parsed.data.quietTo) despertarCola();
  return Response.json(parsed.data);
}
export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  resetConfig();
  return Response.json(getConfig());
}
