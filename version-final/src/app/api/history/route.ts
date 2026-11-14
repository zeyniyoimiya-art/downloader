// Historial local (history.json).
//
// Además de devolverlo, se anota qué archivos siguen existiendo: la UI lo usa
// para enseñar «archivo ya no está» en vez de ofrecer un botón de carpeta que
// abriría cualquier cosa. Y se colapsan las descargas repetidas del MISMO
// archivo, que llenaban Recientes de tarjetas idénticas.
//
// OJO — «sigue existiendo» ya NO es un `existsSync` a secas. La ruta guardada
// puede estar desfasada (otra carpeta de salida, el motor sanitizó el nombre,
// el post-proceso cambió la extensión) y entonces la tarjeta decía «ya no
// está» con el archivo delante de las narices. Ahora se busca de verdad con
// `resolverRutaReal` y se devuelve la ruta buena en `path`, con `rutaGuardada`
// para quien quiera ver la original.
import { guard, blocked } from "@/lib/server/guard";
import { getConfig, getHistory, removeHistory, updateHistoryPath } from "@/lib/server/store";
import { resolverRutaReal } from "@/lib/server/rutas";
import { invalidarIndice } from "@/lib/server/rutas";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const salidaDir = getConfig().outputDir;
  // Una petición con `?revisar=1` fuerza a mirar el disco otra vez (tras una
  // descarga, por ejemplo). Sin él, el índice de la carpeta de salida se
  // reutiliza 20 s para no recorrer el disco en cada refresco de la UI.
  if (new URL(req.url).searchParams.get("revisar") === "1") invalidarIndice();

  const vistos = new Set<string>();
  const salida = [];
  for (const h of getHistory()) {
    const r = resolverRutaReal(h, salidaDir);
    const ruta = r?.ruta ?? h.path;
    // La clave es la RUTA REAL, no la URL: bajar dos veces el mismo vídeo a
    // sitios distintos sí son dos archivos; el mismo archivo dos veces, no.
    const clave = ruta.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({
      ...h,
      path: ruta,
      rutaGuardada: h.path,
      existe: !!r,
      // Solo para diagnóstico fino: cómo se encontró y si hubo que corregir.
      motivo: r?.motivo,
      corregida: r?.corregida ?? false,
    });
  }
  return Response.json(salida);
}

export async function DELETE(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]{1,12}$/.test(id)) return Response.json({ error: "id inválido" }, { status: 400 });
  removeHistory(id);
  return Response.json({ ok: true });
}

/** Repara las rutas desfasadas del historial (lo llama el botón «Reconectar»). */
export async function POST(req: Request) {
  { const g = guard(req); if (!g.ok) return blocked(g); }
  const salidaDir = getConfig().outputDir;
  invalidarIndice();
  let revisadas = 0, corregidas = 0;
  const perdidas: string[] = [];
  for (const h of getHistory()) {
    revisadas++;
    const r = resolverRutaReal(h, salidaDir);
    if (!r) { perdidas.push(h.id); continue; }
    if (r.corregida && updateHistoryPath(h.id, r.ruta)) corregidas++;
  }
  return Response.json({
    ok: true, revisadas, corregidas, perdidas: perdidas.length,
    mensaje: corregidas
      ? `${corregidas} de ${revisadas} rutas estaban mal y se han corregido`
      : perdidas.length
        ? `${perdidas.length} archivo(s) de ${revisadas} no aparecen en el disco`
        : `Las ${revisadas} rutas del historial son correctas`,
  });
}
