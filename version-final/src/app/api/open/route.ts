// Abrir la carpeta de una descarga en el explorador del sistema.
//
// Regla de oro: NO se lanza `explorer` con una ruta que no existe. Explorer no
// da error en ese caso: se abre en su carpeta por defecto (Documentos) y el
// usuario acaba perdido sin saber qué pasó. Aquí se comprueba antes y se
// responde diciendo la verdad.
import { guard, blocked } from "@/lib/server/guard";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfig, getHistory } from "@/lib/server/store";
import { resolveEngine, MOCK } from "@/lib/server/engines";
import { queAbrir, rutaPermitida } from "@/lib/shared/abrir";
import { abrirEnSistema } from "@/lib/server/abrir-sistema";

const Body = z.object({ id: z.string().regex(/^[a-z0-9]{1,12}$/).optional(), play: z.boolean().optional() });

export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Petición inválida" }, { status: 400 });
  const cfg = getConfig();
  const root = path.resolve(cfg.outputDir);

  // ¿A qué ruta apunta? Sin id: la carpeta de salida. Con id: la del historial.
  let target = root;
  let desdeHistorial = false;
  if (parsed.data.id) {
    const h = getHistory().find((x) => x.id === parsed.data.id);
    if (!h) return Response.json({ error: "No encontrado" }, { status: 404 });
    target = path.resolve(h.path);
    desdeHistorial = true;
  }
  // Sanitización de ruta: dentro de la carpeta de salida… salvo que venga del
  // historial y exista de verdad. Es el caso normal de quien cambió la carpeta
  // de salida: sus descargas viejas siguen donde estaban y tienen derecho a
  // abrirse (el id sale de NUESTRO historial, no de la petición).
  const enRaiz = rutaPermitida(target, [root], path.sep);
  if (!enRaiz && !(desdeHistorial && fs.existsSync(target))) {
    return Response.json({ error: desdeHistorial
      ? "Ese archivo ya no está en el disco"
      : "Ruta fuera de la carpeta de salida" }, { status: desdeHistorial ? 404 : 403 });
  }

  let esArchivo = false;
  try { esArchivo = fs.statSync(target).isFile(); } catch {}
  const plan = queAbrir({ existe: fs.existsSync(target), esArchivo, existeCarpeta: fs.existsSync(path.dirname(target)) });
  if (plan.tipo === "nada") return Response.json({ error: plan.error }, { status: 404 });

  if (MOCK) return Response.json({ ok: true, mock: true, aviso: plan.tipo === "carpeta" ? plan.aviso : undefined });

  // Para «seleccionar» hace falta que exista: si el archivo no está, se abre la
  // carpeta en vez de mandar a Explorer a ciegas (y esa comprobación ya vive en
  // `abrirEnSistema`, que además sabe la sintaxis exacta de cada sistema).
  const seleccionar = plan.tipo === "seleccionar" && esArchivo;
  try {
    if (parsed.data.play) {
      const ff = resolveEngine("ffplay");
      if (!ff) return Response.json({ error: "ffplay no disponible" }, { status: 400 });
      if (!esArchivo) return Response.json({ error: plan.tipo === "carpeta" ? plan.aviso : "El archivo no está" }, { status: 404 });
      const h = spawn(ff, ["-autoexit", "-nodisp", target], { shell: false, detached: true, stdio: "ignore", windowsHide: true });
      h.on("error", () => {}); // un fallo al lanzar no debe tumbar el servidor
      h.unref();
      return Response.json({ ok: true, abierto: target });
    }
    // Un solo sitio decide el comando (y con el `/select,…` bien formado):
    // antes Explorer abría Documentos porque recibía `/select,` y la ruta como
    // dos argumentos distintos.
    const r = abrirEnSistema(target, seleccionar);
    if (!r.ok) return Response.json({ error: r.error }, { status: 404 });
    return Response.json({ ok: true, abierto: r.destino, aviso: r.aviso ?? (plan.tipo === "carpeta" ? plan.aviso : undefined) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo abrir" }, { status: 500 });
  }
}
