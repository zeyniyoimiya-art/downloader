// Diagnóstico en una sola pantalla (solo lectura, local).
//
// Cuando algo «no hace nada», este endpoint dice por qué sin instalar nada:
// versión que está corriendo, plataforma, carpetas reales, cuántos archivos ve
// en la carpeta de salida y cómo resuelve las últimas entradas del historial
// (¿la ruta guardada es la buena? ¿se encontró por el id? ¿no aparece?).
//
// Abrir en el navegador:  http://127.0.0.1:<puerto>/api/diagnostico
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getConfig, getHistory } from "@/lib/server/store";
import { indiceDe, resolverRutaReal } from "@/lib/server/rutas";
import { comandoPara } from "@/lib/server/abrir-sistema";
import { VERSION, BUILD } from "@/lib/shared/version";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = getConfig();
  const salida = path.resolve(cfg.outputDir);
  const archivos = (() => { try { return indiceDe(salida); } catch { return []; } })();
  const hist = getHistory().slice(0, 12).map((h) => {
    const r = resolverRutaReal(h, salida);
    return {
      id: h.id,
      titulo: h.title,
      rutaGuardada: h.path,
      rutaReal: r?.ruta ?? null,
      como: r?.motivo ?? "no aparece",
      existe: !!r,
    };
  });
  // BUILD_ID: el identificador que genera `next build`. Lo usa el lanzador para
  // saber si el servidor que ya está escuchando es ESTA compilación o una vieja
  // que quedó abierta (con la app anterior todavía dentro).
  const buildId = (() => {
    for (const base of [process.cwd(), path.join(process.cwd(), "version-final")]) {
      try { return fs.readFileSync(path.join(base, ".next", "BUILD_ID"), "utf8").trim(); } catch {}
    }
    return null;
  })();
  return Response.json({
    app: { version: VERSION, build: BUILD, buildId, plataforma: process.platform, node: process.version },
    carpetas: {
      datos: DATA_DIR,
      salida,
      salidaExiste: fs.existsSync(salida),
      archivosEnSalida: archivos.length,
    },
    // Cómo se abriría una carpeta en este equipo (lo que se ejecutaría de verdad).
    abrirCarpeta: (() => {
      const c = comandoPara(process.platform as "win32" | "darwin" | "linux", path.join(salida, "ejemplo.mp4"), true);
      return `${c.cmd} ${c.args.join(" ")}`;
    })(),
    historial: { total: getHistory().length, ultimas: hist },
  });
}
