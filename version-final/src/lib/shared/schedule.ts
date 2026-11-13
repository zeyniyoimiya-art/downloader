// Programador: ventana horaria ("solo de noche") y retraso por trabajo.
//
// ── POR QUÉ ──────────────────────────────────────────────────────────────────
// Bajar 40 GB a las 20:00 mientras juegas/hablas por videollamada es la peor
// idea: se satura la conexión y el disco. Lo útil es "descarga solo entre las 01
// y las 07" o "empieza esto en 2 horas".
//
// ── DETALLES QUE PARECEN TONTOS Y NO LO SON ────────────────────────────────
//  · La ventana puede CRUZAR la medianoche (22:00 → 07:00). Comparar "hora >= ini
//    && hora < fin" falla ahí; por eso se compara por minutos desde medianoche y
//    se distinguen los dos casos.
//  · La hora es LOCAL del equipo (La Paz, no UTC): es la hora a la que el dueño
//    del PC duerme, no la del servidor.
//  · Fuera de la ventana NO se cancelan los trabajos en curso: solo no arrancan
//    nuevos. Matar una descarga al 90 % sería peor que dejarla terminar.

/** "07:30" → 450 (minutos desde medianoche). Devuelve null si no es válido. */
export function aMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Minutos desde medianoche de un instante, en hora local. */
export function minutosDelDia(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * ¿Estamos dentro de la ventana silenciosa?
 * @param desde "01:00" · @param hasta "07:00"
 */
export function enVentanaSilenciosa(desde: string, hasta: string, ahora = Date.now()): boolean {
  const a = aMinutos(desde);
  const b = aMinutos(hasta);
  if (a === null || b === null || a === b) return false; // ventana inválida o vacía
  const t = minutosDelDia(ahora);
  return a < b ? t >= a && t < b : t >= a || t < b; // normal o cruzando medianoche
}

/** ¿La ventana cruza la medianoche? (22:00 → 07:00 sí) */
export function cruzaMedianoche(desde: string, hasta: string): boolean {
  const a = aMinutos(desde);
  const b = aMinutos(hasta);
  return a !== null && b !== null && a > b;
}

/**
 * Milisegundos hasta que la ventana se ABRA (0 si ya está abierta).
 * Se usa para reprogramar la cola en vez de hacer polling cada segundo.
 */
export function msHastaApertura(desde: string, hasta: string, ahora = Date.now()): number {
  if (!enVentanaSilenciosa(desde, hasta, ahora)) return 0;
  const b = aMinutos(hasta);
  if (b === null) return 0;
  const d = new Date(ahora);
  const objetivo = new Date(d);
  objetivo.setHours(Math.floor(b / 60), b % 60, 0, 0);
  if (objetivo.getTime() <= ahora) objetivo.setDate(objetivo.getDate() + 1);
  return objetivo.getTime() - ahora;
}

/** Texto corto para la UI/log: "01:00–07:00". */
export function describirVentana(desde: string, hasta: string): string {
  return `${desde}–${hasta}${cruzaMedianoche(desde, hasta) ? " (cruza medianoche)" : ""}`;
}

/** ¿Este trabajo ya puede arrancar según su hora programada? */
export function puedeArrancar(startAt: number | undefined, ahora = Date.now()): boolean {
  return !startAt || startAt <= ahora;
}
