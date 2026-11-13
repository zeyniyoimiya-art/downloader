// Estado general: carpeta actual, número de archivos y espacio libre.
//
// El espacio libre no es decoración: con vídeo 4K un solo trabajo puede pedir
// 20 GB. Se muestra en el hero y el planificador lo usa para abortar ANTES de
// empezar (media descarga sin disco deja un `.part` inservible).
import { countOutputFiles, getConfig } from "@/lib/server/store";
import { espacioLibre, formatoBytes } from "@/lib/server/jobs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getConfig();
  const libre = espacioLibre(cfg.outputDir);
  return Response.json({
    outputDir: cfg.outputDir,
    files: countOutputFiles(cfg.outputDir),
    freeBytes: libre,
    freeLabel: libre === null ? null : formatoBytes(libre),
  });
}
