// Cola del taller: convertir/recortar/comprimir archivos que ya están en disco.
//
// ── DECISIONES ──────────────────────────────────────────────────────────────
// · De uno en uno. ffmpeg ya usa todos los núcleos; lanzar tres a la vez hace
//   que los tres vayan lentos y el equipo se arrastre.
// · El proceso vive en el servidor, así que cerrar la pestaña no lo mata: el
//   progreso sigue y al volver lo ves.
// · Nunca se borra el original: la salida lleva « (taller)» en el nombre. Si
//   algo sale mal, tus archivos siguen ahí.
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { argsTaller, nombreSalida, porcentaje, segundosDeProgreso, type OpcionesTaller } from "@/lib/shared/taller";

export interface TareaTaller extends OpcionesTaller {
  id: string;
  /** Nombre para la UI (sin ruta completa y sin el prefijo temporal de subida). */
  nombre: string;
  state: "queued" | "running" | "done" | "error" | "canceled";
  percent: number;
  /** Velocidad de proceso (×tiempo real), tal como la da ffmpeg. */
  speed: string;
  /** Ruta de salida, cuando termina. */
  salida?: string;
  error?: string;
  /** Bytes de entrada, para enseñar el peso. */
  bytes: number;
  createdAt: number;
}

class Taller extends EventEmitter {
  tareas: TareaTaller[] = [];
  procs = new Map<string, ChildProcess>();
}

const g = globalThis as typeof globalThis & { __lyTaller?: Taller };
const taller = (g.__lyTaller ??= new Taller());

export const listarTaller = (): TareaTaller[] => taller.tareas.slice(-40);
export const tallerEvents = () => taller;

function emitir(): void {
  taller.emit("taller", listarTaller());
}

/** ffmpeg del proyecto: vendor/ junto al ejecutable, o el del PATH. */
function ffmpegBin(): string {
  const local = path.join(process.cwd(), "vendor", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return fs.existsSync(local) ? local : "ffmpeg";
}
function ffprobeBin(): string {
  const local = path.join(process.cwd(), "vendor", process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  return fs.existsSync(local) ? local : "ffprobe";
}

/** Duración en segundos (0 si no se puede saber: entonces no hay porcentaje). */
function duracion(ruta: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(ffprobeBin(), ["-v", "quiet", "-print_format", "json", "-show_format", ruta], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => { out += String(d); });
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        const n = Number(j?.format?.duration);
        resolve(Number.isFinite(n) && n > 0 ? n : 0);
      } catch { resolve(0); }
    });
    p.on("error", () => resolve(0));
  });
}

export function encolarTaller(opts: OpcionesTaller, nombreVisible?: string): TareaTaller {
  let bytes = 0;
  try { bytes = fs.statSync(opts.ruta).size; } catch {}
  const t: TareaTaller = {
    ...opts,
    id: randomUUID().slice(0, 8),
    // El nombre que ve el usuario, no el del archivo temporal en disco.
    nombre: nombreVisible?.trim() || (opts.ruta.split(/[\\/]/).pop() ?? opts.ruta),
    state: "queued",
    percent: 0,
    speed: "",
    bytes,
    createdAt: Date.now(),
  };
  taller.tareas.push(t);
  emitir();
  void pump();
  return t;
}

export function cancelarTaller(id: string): boolean {
  const t = taller.tareas.find((x) => x.id === id);
  if (!t) return false;
  if (t.state === "running") {
    // SIGKILL: ffmpeg deja el archivo de salida a medias, y se borra justo abajo.
    try { taller.procs.get(id)?.kill("SIGKILL"); } catch {}
  }
  if (t.state === "queued" || t.state === "running") { t.state = "canceled"; emitir(); void pump(); }
  return true;
}

export function quitarTaller(id: string): boolean {
  const i = taller.tareas.findIndex((x) => x.id === id);
  if (i < 0) return false;
  if (taller.tareas[i].state === "running") cancelarTaller(taller.tareas[i].id);
  taller.tareas.splice(i, 1);
  emitir();
  return true;
}

let corriendo = false;

async function pump(): Promise<void> {
  if (corriendo) return;
  const t = taller.tareas.find((x) => x.state === "queued");
  if (!t) return;
  corriendo = true;
  t.state = "running";
  emitir();

  if (!fs.existsSync(t.ruta)) {
    t.state = "error"; t.error = "El archivo ya no está en esa ruta"; corriendo = false; emitir(); void pump(); return;
  }

  const total = await duracion(t.ruta);
  const args = argsTaller(t);
  const p = spawn(ffmpegBin(), args, { windowsHide: true });
  taller.procs.set(t.id, p);

  let error = "";
  let resto = "";
  p.stdout.on("data", (d) => {
    resto += String(d);
    const lineas = resto.split(/\r?\n/);
    resto = lineas.pop() ?? "";
    for (const l of lineas) {
      const s = segundosDeProgreso(l);
      if (s != null) { t.percent = porcentaje(s, total); emitir(); }
      const m = /^speed=\s*(\S+)/.exec(l.trim());
      if (m) { t.speed = m[1]; }
    }
  });
  p.stderr.on("data", (d) => { error += String(d).slice(-2000); });
  p.on("error", (e) => { error += String(e); });
  p.on("close", (code) => {
    taller.procs.delete(t.id);
    corriendo = false;
    const salida = nombreSalida(t.ruta, t.formato);
    if (t.state === "canceled") {
      // A medias el archivo no sirve: se borra para no dejar basura.
      try { fs.rmSync(salida, { force: true }); } catch {}
    } else if (code === 0 && fs.existsSync(salida)) {
      t.state = "done"; t.percent = 100; t.salida = salida;
    } else {
      t.state = "error";
      t.error = error.split("\n").filter(Boolean).slice(-2).join(" ") || `ffmpeg terminó con código ${code}`;
    }
    emitir();
    void pump();
  });
}

/** Solo para los tests: deja la cola vacía. */
export function _resetTaller(): void { taller.tareas.length = 0; }

/** Abre la carpeta del resultado de una tarea (solo rutas de salida conocidas). */
export async function abrirSalida(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = taller.tareas.find((x) => x.id === id);
  if (!t || !t.salida) return { ok: false, error: "Esa tarea no tiene salida" };
  if (!fs.existsSync(t.salida)) return { ok: false, error: "El archivo ya no está" };
  const { spawn } = await import("node:child_process");
  const carpeta = path.dirname(t.salida);
  try {
    if (process.platform === "win32") spawn("explorer", ["/select,", t.salida], { windowsHide: true, detached: true }).unref();
    else if (process.platform === "darwin") spawn("open", ["-R", t.salida], { detached: true }).unref();
    else spawn("xdg-open", [carpeta], { detached: true }).unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo abrir" };
  }
}
