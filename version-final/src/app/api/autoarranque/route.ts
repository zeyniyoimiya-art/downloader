// Arrancar Linyue con Windows: crea/quita un .cmd en la carpeta Inicio del
// usuario. SIN admin, sin tareas programadas, sin registrar servicios: es un
// archivo de texto dentro de tu perfil, y se ve y se borra a mano.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { guard, blocked } from "@/lib/server/guard";
import { getConfig } from "@/lib/server/store";
export const dynamic = "force-dynamic";

const carpetaInicio = () =>
  process.env.APPDATA ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup") : "";
const rutaCmd = () => path.join(carpetaInicio(), "Linyue.cmd");

export async function GET() {
  const soportado = process.platform === "win32" && !!carpetaInicio();
  let activo = false;
  try { activo = soportado && fs.existsSync(rutaCmd()); } catch {}
  return Response.json({ soportado, activo, ruta: soportado ? rutaCmd() : null });
}

export async function POST(req: Request) {
  const g = guard(req); if (!g.ok) return blocked(g);
  if (process.platform !== "win32" || !carpetaInicio()) {
    return Response.json({ soportado: false, error: "Solo Windows tiene carpeta de Inicio." }, { status: 400 });
  }
  const { activo } = (await req.json().catch(() => ({}))) as { activo?: boolean };
  const cmd = rutaCmd();
  try {
    if (activo) {
      const bat = path.join(process.cwd(), "iniciar_linyue.bat");
      const contenido = ["@echo off", "REM Linyue · arranque automático (creado desde Ajustes)", `start "" "${bat}"`, ""].join("\r\n");
      fs.mkdirSync(path.dirname(cmd), { recursive: true });
      fs.writeFileSync(cmd, contenido, "utf8");
    } else {
      fs.rmSync(cmd, { force: true });
    }
    return Response.json({ soportado: true, activo: fs.existsSync(cmd), ruta: cmd, outputDir: getConfig().outputDir });
  } catch (e) {
    return Response.json({ soportado: true, activo: false, error: e instanceof Error ? e.message : "No se pudo escribir" }, { status: 500 });
  }
}
