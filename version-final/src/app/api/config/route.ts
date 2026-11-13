// Ajustes locales (config.json)
import { ConfigSchema, getConfig, resetConfig, saveConfig } from "@/lib/server/store";
import { scanEngines } from "@/lib/server/engines";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getConfig());
}
export async function PUT(req: Request) {
  const parsed = ConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const prev = getConfig();
  saveConfig(parsed.data);
  if (prev.vendorDir !== parsed.data.vendorDir || JSON.stringify(prev.enginePaths) !== JSON.stringify(parsed.data.enginePaths)) await scanEngines();
  return Response.json(parsed.data);
}
export async function POST() {
  resetConfig();
  return Response.json(getConfig());
}
