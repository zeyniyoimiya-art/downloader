// Estadísticas del historial: puro cálculo, sin fs ni red (testeable).
//
// No es decoración: sirve para responder preguntas que el historial crudo no
// contesta — "¿cuántos GB llevo este mes?", "¿qué motor me falla más?", "¿de
// dónde bajo de verdad?", "¿cuánto tiempo de vídeo tengo?". Todo se calcula a
// partir de `history.json`, que ya existe: cero datos nuevos en disco y cero
// telemetría (nada sale de tu PC).

export interface ItemHistorial {
  source: string;
  format: string;
  size: number;
  duration: number;
  engine: string;
  mode: string;
  author?: string;
  createdAt: number;
}

export interface Cubo {
  clave: string;
  archivos: number;
  bytes: number;
}

export interface Estadisticas {
  total: { archivos: number; bytes: number; segundos: number; plataformas: number };
  porPlataforma: Cubo[];
  porFormato: Cubo[];
  porMotor: Cubo[];
  porDia: { dia: string; archivos: number; bytes: number }[];
  topAutores: Cubo[];
  /** Racha: días seguidos con al menos una descarga (hoy incluido). */
  rachaDias: number;
  /** Media de tamaño por archivo. */
  mediaBytes: number;
  /** Lo más grande que has bajado (para el "récord"). */
  mayorBytes: number;
  /** Ventana cubierta por el historial. */
  desde: number | null;
  hasta: number | null;
}

const vacio = (): Cubo => ({ clave: "", archivos: 0, bytes: 0 });

function agrupar(items: ItemHistorial[], clave: (i: ItemHistorial) => string, limite = 100): Cubo[] {
  const mapa = new Map<string, Cubo>();
  for (const it of items) {
    const k = (clave(it) || "—").trim() || "—";
    const c = mapa.get(k) ?? { ...vacio(), clave: k };
    c.archivos += 1;
    c.bytes += Number(it.size) || 0;
    mapa.set(k, c);
  }
  return [...mapa.values()]
    .sort((a, b) => b.bytes - a.bytes || b.archivos - a.archivos)
    .slice(0, limite);
}

/** Clave de día LOCAL (YYYY-MM-DD). En UTC, una descarga de las 21:00 en La Paz
 *  caería en "mañana" y el gráfico mentiría. */
export function diaLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Resta días de CALENDARIO (no 24 h). Con `ms - n*86_400_000`, el día en que
 * cambia el horario de verano el cubo se duplica o se salta y el gráfico miente.
 */
function haceDias(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

export function calcularEstadisticas(items: ItemHistorial[], ahora = Date.now(), dias = 14): Estadisticas {
  const limpios = items.filter((i) => Number.isFinite(i.createdAt) && i.createdAt > 0);
  const bytes = limpios.reduce((s, i) => s + (Number(i.size) || 0), 0);
  const segundos = limpios.reduce((s, i) => s + (Number(i.duration) || 0), 0);
  const plataformas = new Set(limpios.map((i) => i.source).filter(Boolean)).size;

  // Serie por día: SIEMPRE `dias` cubos, incluidos los días sin descargas (si no,
  // el gráfico miente comprimiendo los huecos).
  const porDiaMapa = new Map<string, { archivos: number; bytes: number }>();
  for (const i of limpios) {
    const k = diaLocal(i.createdAt);
    const c = porDiaMapa.get(k) ?? { archivos: 0, bytes: 0 };
    c.archivos += 1;
    c.bytes += Number(i.size) || 0;
    porDiaMapa.set(k, c);
  }
  const porDia: Estadisticas["porDia"] = [];
  for (let d = dias - 1; d >= 0; d--) {
    const dia = diaLocal(haceDias(ahora, d));
    const c = porDiaMapa.get(dia) ?? { archivos: 0, bytes: 0 };
    porDia.push({ dia, ...c });
  }

  // Racha de días consecutivos con actividad (hoy o ayer como ancla).
  const diasCon = new Set(limpios.map((i) => diaLocal(i.createdAt)));
  let racha = 0;
  for (let d = 0; d < 3650; d++) {
    const dia = diaLocal(haceDias(ahora, d));
    if (diasCon.has(dia)) racha++;
    else if (d > 0) break; // el día de hoy sin descargas no rompe la racha
  }

  const tiempos = limpios.map((i) => i.createdAt);
  return {
    total: { archivos: limpios.length, bytes, segundos, plataformas },
    porPlataforma: agrupar(limpios, (i) => i.source),
    porFormato: agrupar(limpios, (i) => i.format.replace(/\s*\(.*\)$/, "")),
    porMotor: agrupar(limpios, (i) => i.engine),
    porDia,
    topAutores: agrupar(limpios.filter((i) => i.author), (i) => i.author ?? "", 8),
    rachaDias: racha,
    mediaBytes: limpios.length ? Math.round(bytes / limpios.length) : 0,
    mayorBytes: limpios.reduce((m, i) => Math.max(m, Number(i.size) || 0), 0),
    desde: tiempos.length ? Math.min(...tiempos) : null,
    hasta: tiempos.length ? Math.max(...tiempos) : null,
  };
}
