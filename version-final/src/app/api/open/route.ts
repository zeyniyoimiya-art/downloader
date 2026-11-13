// Abrir carpeta en el explorador del sistema / escucha rápida con ffplay. Solo rutas dentro de la carpeta de salida.
import { guard, blocked } from "@/lib/server/guard";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfig, getHistory } from "@/lib/server/store";
import { resolveEngine, MOCK } from "@/lib/server/engines";

const Body = z.object({ id: z.string().regex(/^[a-z0-9]{1,12}$/).optional(), play: z.boolean().optional() });

export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Petición inválida" }, { status: 400 });
  const cfg = getConfig();
  const root = path.resolve(cfg.outputDir);
  let target = root;
  if (parsed.data.id) {
    const h = getHistory().find((x) => x.id === parsed.data.id);
    if (!h) return Response.json({ error: "No encontrado" }, { status: 404 });
    target = path.resolve(h.path);
  }
  // Sanitización de ruta: debe quedar dentro de la carpeta de salida
  if (target !== root && !target.startsWith(root + path.sep)) return Response.json({ error: "Ruta fuera de la carpeta de salida" }, { status: 403 });
  if (MOCK) return Response.json({ ok: true, mock: true });
  fs.mkdirSync(root, { recursive: true });
  try {
    if (parsed.data.play) {
      const ff = resolveEngine("ffplay");
      if (!ff) return Response.json({ error: "ffplay no disponible" }, { status: 400 });
      spawn(ff, ["-autoexit", "-nodisp", target], { shell: false, detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else {
      const isFile = fs.existsSync(target) && fs.statSync(target).isFile();
      const [cmd, args] = process.platform === "win32" ? ["explorer.exe", isFile ? [`/select,${target}`] : [target]] : process.platform === "darwin" ? ["open", isFile ? ["-R", target] : [target]] : ["xdg-open", [isFile ? path.dirname(target) : target]];
      spawn(cmd as string, args as string[], { shell: false, detached: true, stdio: "ignore" }).unref();
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
