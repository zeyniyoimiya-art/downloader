// Estado general: carpeta actual y número de archivos (microcopy del hero)
import { countOutputFiles, getConfig } from "@/lib/server/store";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getConfig();
  return Response.json({ outputDir: cfg.outputDir, files: countOutputFiles(cfg.outputDir) });
}
