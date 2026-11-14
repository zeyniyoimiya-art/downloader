// Nombres legibles para el historial.
//
// ── EL PROBLEMA ────────────────────────────────────────────────────────────
// A veces el motor no llega a dar el título (el vídeo ya se estaba bajando, la
// sonda falló, se canceló y se reanudó…). Entonces el trabajo se queda con la
// URL como título y el historial acaba lleno de «https://youtu.be/Gf4P3iZ1Lz0»
// repetido, que no dice nada y encima se duplica.
//
// Aquí se deduce lo que se pueda del propio archivo, que es información de
// primera mano: el nombre del archivo lo puso la app con la plantilla elegida.
// Puro: sin fs.

/** ¿Es una URL (o sea: no es un título)? */
export function esUrl(t: string | null | undefined): boolean {
  return !!t && /^https?:\/\//i.test(t.trim());
}

/**
 * «C:\…\Eternxlkz - DEIXA ROLAR [abc123].m4a» → «Eternxlkz - DEIXA ROLAR».
 * Quita la extensión y el sufijo « [id]» que añade la plantilla de nombres.
 */
export function tituloDeArchivo(ruta: string): string {
  const base = (ruta.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
  return base
    .replace(/\s*\[[\w-]{3,20}\]$/, "") // « [dQw4w9WgXcQ]»
    .replace(/\s*\((?:taller|conv)\)$/i, "") // marcas del taller
    .trim();
}

/**
 * Autor deducido de la ruta: con la plantilla «ordenado» los archivos viven en
 * `<salida>/<Autor>/…`, así que la carpeta contenedora es el canal.
 * Devuelve "" si la carpeta es la de salida (ahí no hay autor).
 */
export function autorDeRuta(ruta: string, raiz: string): string {
  const padre = ruta.slice(0, ruta.length - (ruta.split(/[\\/]/).pop() ?? "").length).replace(/[\\/]+$/, "");
  const normal = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  if (!padre || normal(padre) === normal(raiz)) return "";
  const nombre = padre.split(/[\\/]/).pop() ?? "";
  // «Audio» es una subcarpeta nuestra, no un autor.
  return /^audio$/i.test(nombre) ? "" : nombre;
}

/** Título definitivo: el del motor si vale, o el deducido del archivo. */
export function tituloFinal(tituloDelMotor: string, rutaArchivo: string): string {
  if (tituloDelMotor && !esUrl(tituloDelMotor) && tituloDelMotor.trim().length > 1) return tituloDelMotor;
  const deducido = tituloDeArchivo(rutaArchivo);
  return deducido || tituloDelMotor || "Sin título";
}
