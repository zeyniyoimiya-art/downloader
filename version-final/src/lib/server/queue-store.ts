// Cola persistente: los trabajos sobreviven a cerrar la app.
//
// ── EL PROBLEMA ──────────────────────────────────────────────────────────────
// La cola vivía solo en memoria (`globalThis.__lyMgr`). Cerrar la ventana, un
// reinicio de Windows o un `npm run build` en caliente borraba trabajos que
// estaban a medias: el archivo quedaba en `.part` y en la cola no había rastro
// de qué se estaba bajando ni de qué falló. Con descargas de 2 h en 4K eso duele.
//
// ── LA SOLUCIÓN ──────────────────────────────────────────────────────────────
// Un `queue.json` en la carpeta de datos (junto a config.json e history.json):
//  · escritura ATÓMICA (tmp + rename): si se corta la luz a mitad, el archivo
//    viejo sigue intacto y no queda un JSON truncado.
//  · escritura DEBOUNCED (1 s): el progreso emite 10 veces/s y no vamos a
//    reescribir el disco a ese ritmo.
//  · al arrancar, los estados transitorios (`probing`/`running`/`post`) pasan a
//    `queued` con una nota en el log: se reanudan solos, sin mentir diciendo que
//    seguían corriendo.
//  · se guardan como máximo los últimos 200 terminados (la cola no es el
//    historial: para eso está history.json).

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

const FILE = path.join(DATA_DIR, "queue.json");
const MAX_TERMINADOS = 200;
const MAX_LOG = 120;

export type TipoEstado = "queued" | "probing" | "running" | "post" | "paused" | "done" | "error" | "canceled" | "skipped";

export interface JobPersistido {
  id: string;
  url: string;
  platform: string;
  label: string;
  mode: string;
  format: string;
  quality: string;
  codec?: string;
  engine: string;
  state: TipoEstado;
  title: string;
  thumbnail: string;
  files: string[];
  log: string[];
  createdAt: number;
  error?: string;
  warning?: string;
  baiduPwd?: string;
  baiduRemote?: string;
  attempts?: number;
}

const TERMINADOS: TipoEstado[] = ["done", "error", "canceled", "skipped"];

/** ¿Este estado significa "había un proceso vivo"? */
export function esTransitorio(e: string): boolean {
  return e === "probing" || e === "running" || e === "post";
}

/** Limpia un trabajo para guardarlo: sin progreso efímero, log acotado. */
export function aPersistible(j: JobPersistido): JobPersistido {
  const { percent, speed, eta, ..._resto } = j as JobPersistido & { percent?: number; speed?: number; eta?: string };
  void _resto;
  return { ...j, log: j.log.slice(-MAX_LOG) };
}

export function leerCola(): JobPersistido[] {
  try {
    const crudo = fs.readFileSync(FILE, "utf8");
    const datos = JSON.parse(crudo) as unknown;
    if (!Array.isArray(datos)) return [];
    return datos.filter((x): x is JobPersistido => !!x && typeof (x as JobPersistido).id === "string" && typeof (x as JobPersistido).url === "string");
  } catch {
    // Sin archivo (primera vez) o JSON roto: se empieza limpio. Nunca lanzar:
    // un queue.json corrupto no puede impedir que arranque la app.
    return [];
  }
}

export function guardarCola(jobs: JobPersistido[]): void {
  try {
    const terminados = jobs.filter((j) => TERMINADOS.includes(j.state)).slice(-MAX_TERMINADOS);
    const vivos = jobs.filter((j) => !TERMINADOS.includes(j.state));
    const salida = [...vivos, ...terminados].map(aPersistible);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(salida), "utf8");
    fs.renameSync(tmp, FILE); // atómico en NTFS y en ext4
  } catch {
    // Disco lleno o permisos: la cola sigue en memoria, no se cae la app.
  }
}

export function vaciarCola(): void {
  try { fs.rmSync(FILE, { force: true }); } catch { /* nada que borrar */ }
}

/**
 * Convierte lo leído en trabajos reanudables.
 * Los que estaban corriendo vuelven como `queued` y con una línea honesta en el
 * log: el proceso murió con la app, no "sigue descargando".
 */
export function reanudar(jobs: JobPersistido[]): JobPersistido[] {
  return jobs.map((j) => {
    if (!esTransitorio(j.state)) return j;
    return {
      ...j,
      state: "queued" as TipoEstado,
      log: [...j.log, "[cola] reanudado tras reiniciar la app (el proceso anterior se cerró)"].slice(-MAX_LOG),
    };
  });
}

/** Ruta del archivo (para mostrarla en el panel de ajustes). */
export const QUEUE_FILE = FILE;
