// Abrir la carpeta de una descarga en el explorador del sistema.
//
// Regla de oro: NO se lanza `explorer` con una ruta que no existe. Explorer no
// da error en ese caso: se abre en su carpeta por defecto (Documentos) y el
// usuario acaba perdido sin saber qué pasó. Aquí se comprueba antes y se
// responde diciendo la verdad.
//
// Y «comprobar» quiere decir BUSCAR: la ruta del historial puede estar
// desfasada aunque el archivo esté ahí (ver lib/server/rutas.ts). Si el
// archivo aparece en otro sitio, se abre ese y se corrige el historial.
import { guard, blocked } from "@/lib/server/guard";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfig, getHistory, updateHistoryPath } from "@/lib/server/store";
import { resolveEngine, MOCK } from "@/lib/server/engines";
import { queAbrir, rutaPermitida } from "@/lib/shared/abrir";
import { abrirEnSistema } from "@/lib/server/abrir-sistema";
import { invalidarIndice, primerAncestroExistente, resolverRutaReal } from "@/lib/server/rutas";

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
  let corregida = false;
  if (parsed.data.id) {
    const h = getHistory().find((x) => x.id === parsed.data.id);
    if (!h) return Response.json({ error: "No encontrado" }, { status: 404 });
    // Se busca el archivo de verdad: ruta guardada, su carpeta o toda la
    // carpeta de salida (por [videoId], por título o por nombre parecido).
    const r = resolverRutaReal(h, root);
    if (r) {
      target = path.resolve(r.ruta);
      if (r.corregida && r.ruta !== h.path) {
        updateHistoryPath(h.id, r.ruta);
        invalidarIndice(root);
        corregida = true;
      }
    } else {
      target = path.resolve(h.path);
    }
    desdeHistorial = true;
  }

  // Sanitización de ruta: dentro de la carpeta de salida… salvo que venga del
  // historial y exista de verdad. Es el caso normal de quien cambió la carpeta
  // de salida: sus descargas viejas siguen donde estaban y tienen derecho a
  // abrirse (el id sale de NUESTRO historial, no de la petición).
  const enRaiz = rutaPermitida(target, [root], path.sep);
  // Fuera de la carpeta de salida: solo se permite si viene del historial Y
  // existe de verdad (quien cambió de carpeta tiene derecho a sus descargas
  // viejas). Si no existe, no se lanza nada raro: se abre la carpeta de salida
  // y se explica; antes era un 404 seco y el usuario se quedaba sin nada.
  if (!enRaiz && !(desdeHistorial && fs.existsSync(target))) {
    if (!desdeHistorial) return Response.json({ error: "Ruta fuera de la carpeta de salida" }, { status: 403 });
    if (!fs.existsSync(root)) return Response.json({ error: "Ese archivo ya no está en el disco" }, { status: 404 });
    target = root;
  }

  let esArchivo = false;
  try { esArchivo = fs.statSync(target).isFile(); } catch {}
  const plan = queAbrir({ existe: fs.existsSync(target), esArchivo, existeCarpeta: fs.existsSync(path.dirname(target)) });

  // Ni el archivo ni su carpeta: antes se devolvía 404 y el usuario se quedaba
  // a dos velas. Ahora se abre la carpeta más cercana que SÍ existe (la de
  // salida, casi siempre) y se dice qué pasó.
  let avisoRuta: string | undefined;
  let destinoFinal = target;
  if (plan.tipo === "nada") {
    const ancestro = primerAncestroExistente(target) ?? (fs.existsSync(root) ? root : null);
    if (!ancestro) return Response.json({ error: plan.error }, { status: 404 });
    destinoFinal = ancestro;
    avisoRuta = `Ese archivo ya no está en el disco; se abrió la carpeta más cercana: ${ancestro}`;
  }

  if (MOCK) {
    return Response.json({ ok: true, mock: true, abierto: destinoFinal, corregida, aviso: avisoRuta ?? (plan.tipo === "carpeta" ? plan.aviso : undefined) });
  }

  if (parsed.data.play) {
    const ff = resolveEngine("ffplay");
    if (!ff) return Response.json({ error: "ffplay no disponible" }, { status: 400 });
    if (!esArchivo) return Response.json({ error: plan.tipo === "carpeta" ? plan.aviso : "El archivo no está" }, { status: 404 });
    const h = spawn(ff, ["-autoexit", "-nodisp", target], { shell: false, detached: true, stdio: "ignore", windowsHide: true });
    h.on("error", () => {}); // un fallo al lanzar no debe tumbar el servidor
    h.unref();
    return Response.json({ ok: true, abierto: target });
  }

  const seleccionar = plan.tipo === "seleccionar" && esArchivo;
  const r = await abrirEnSistema(destinoFinal, seleccionar);
  if (!r.ok) return Response.json({ error: r.error, comando: r.comando }, { status: 500 });
  return Response.json({
    ok: true,
    abierto: r.destino ?? destinoFinal,
    comando: r.comando,
    metodo: r.metodo,
    corregida,
    aviso: avisoRuta ?? r.aviso ?? (plan.tipo === "carpeta" ? plan.aviso : undefined),
  });
}
