// Gestor de cola: concurrencia, spawn sin shell, progreso, pausa/cancelar (kill de árbol), post-proceso, ffprobe, historial.
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import fs from "node:fs";
import path from "node:path";
import { buildArgs, ffprobeArgs, magickArgs } from "../shared/args";
import { detect, routeEngine, modeParts, supportedModes, AUDIO_FORMATS, VIDEO_FORMATS, PHOTO_FORMATS, type AtomicMode, type Detected, type EngineId, type Mode } from "../shared/platforms";
import { parseLine } from "../shared/progress";
import { isHealthy, MOCK, resolveEngine, scanEngines, getEngines } from "./engines";
import { addHistory, archiveFileFor, cookieFile, getConfig, inHistory, reconcileArchiveFor, TEMP_DIR, type Config } from "./store";

export type JobState = "queued" | "probing" | "running" | "post" | "paused" | "done" | "error" | "canceled" | "skipped";
export interface Job {
  id: string;
  url: string;
  platform: string;
  label: string;
  mode: Mode;
  format: string;
  quality: string;
  engine: EngineId;
  state: JobState;
  percent: number;
  speed: number;
  eta: string;
  title: string;
  thumbnail: string;
  files: string[];
  log: string[];
  error?: string;
  createdAt: number;
  /** Reintentos automáticos usados (fallos transitorios: locks de Windows, cortes de CDN) */
  attempts?: number;
  /** Marca de tiempo mínima antes de reintentar (reintentos diferidos) */
  retryAt?: number;
  /** El turbo (aria2c) falló para este trabajo: reintentar sin él */
  noTurbo?: boolean;
}

/** Metadatos que yt-dlp devuelve en el sondeo previo. */
interface JobMeta {
  author: string;
  date: string;
  duration: number;
  /**
   * Id del vídeo DENTRO del sitio (p. ej. `sample-5s`). Es la clave con la que
   * yt-dlp anota la línea del archive (`<extractor> <id>`), así que sin él no se
   * puede reconciliar nada: si el usuario borra el archivo, el archive sigue
   * teniendo el id, yt-dlp lo salta **en silencio** y el trabajo "termina bien"
   * sin descargar.
   */
  videoId?: string;
}

interface Mgr { jobs: Job[]; procs: Map<string, ChildProcess>; bus: EventEmitter }
const g = globalThis as unknown as { __lyMgr?: Mgr };
const mgr: Mgr = g.__lyMgr ?? (g.__lyMgr = { jobs: [], procs: new Map(), bus: new EventEmitter() });
mgr.bus.setMaxListeners(100);

export const bus = mgr.bus;
export const listJobs = () => mgr.jobs.map(({ log, ...j }) => ({ ...j, log: log.slice(-3) }));

let emitTimer: NodeJS.Timeout | null = null;
function emit() {
  // Throttle a ~10 eventos/s para no saturar SSE
  if (emitTimer) return;
  emitTimer = setTimeout(() => { emitTimer = null; bus.emit("jobs", listJobs()); }, 100);
}
function event(type: string, data: unknown) { bus.emit("event", { type, data }); }

// Formato concreto por parte atómica: respeta el elegido si encaja en su pool;
// si no (p. ej. en un combo el usuario dejó "mp4" y esta parte es audio), cae
// al default de configuración. Evita jobs absurdos tipo "bajar audio en webm".
function formatForPart(part: AtomicMode, chosen: string, cfg: Config): string {
  const pools: Record<AtomicMode, readonly string[]> = { audio: AUDIO_FORMATS, video: VIDEO_FORMATS, photo: PHOTO_FORMATS, profile: VIDEO_FORMATS };
  if (pools[part].includes(chosen)) return chosen;
  if (part === "audio") return cfg.audioFormat;
  if (part === "photo") return cfg.photoFormat;
  return cfg.videoFormat;
}

export function enqueue(urls: string[], mode: Mode, format: string, quality: string): { added: Job[]; rejected: string[] } {
  const cfg = getConfig();
  const added: Job[] = [];
  const rejected: string[] = [];
  for (const u of urls) {
    const d = detect(u);
    if (!d) { rejected.push(u); continue; }
    // Threads no tiene extractor en yt-dlp NI gallery-dl: rechazo honesto con motivo
    if (d.platform === "threads") { rejected.push(`${u} — Threads aún no tiene extractor (yt-dlp/gallery-dl no lo soportan)`); continue; }
    // Un modo combinado = un trabajo por parte atómica; filtramos las que esta
    // plataforma no puede dar (así "all" en YouTube no inventa un job de fotos).
    const caps = supportedModes(d);
    const parts = modeParts(mode).filter((p) => caps.includes(p));
    if (!parts.length) {
      rejected.push(`${u} — ${d.label} no admite «${mode}» (ofrece: ${caps.join(", ")})`);
      continue;
    }
    for (const part of parts) {
      const engine = routeEngine(d, part, { altEngineCN: cfg.altEngineCN, healthy: isHealthy });
      const job: Job = {
        id: Math.random().toString(36).slice(2, 10), url: d.url, platform: d.platform, label: d.label,
        mode: part, format: formatForPart(part, format, cfg), quality, engine,
        state: "queued", percent: 0, speed: 0, eta: "", title: d.url, thumbnail: "", files: [], log: [], createdAt: Date.now(),
      };
      // Dedup POR MODO: que el audio ya esté no impide bajar el video del mismo link.
      if (cfg.noRepeat && inHistory(d.url, part)) { job.state = "skipped"; job.error = "Ya descargado (historial)"; }
      mgr.jobs.push(job);
      added.push(job);
    }
  }
  emit();
  pump();
  return { added, rejected };
}

function active() { return mgr.jobs.filter((j) => ["probing", "running", "post"].includes(j.state)).length; }

function pump() {
  const cfg = getConfig();
  const now = Date.now();
  while (active() < cfg.concurrency) {
    // Se ignoran los jobs con retryAt futuro (reintentos diferidos)
    const next = mgr.jobs.find((j) => j.state === "queued" && (j.retryAt ?? 0) <= now);
    if (!next) break;
    // Marcar de forma síncrona: si no, el while volvería a elegir el mismo job (bucle infinito)
    next.state = "probing";
    void run(next);
  }
  // Si hay reintentos programados, reprogramar el pump para cuando toque
  const futuros = mgr.jobs.filter((j) => j.state === "queued" && (j.retryAt ?? 0) > Date.now());
  if (futuros.length) {
    const min = Math.min(...futuros.map((j) => j.retryAt ?? 0));
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, Math.max(100, min - Date.now()) + 50);
  }
}
let pumpTimer: NodeJS.Timeout | null = null;

// Spawn seguro: binario resuelto de la whitelist, args en array, shell:false
function spawnEngine(id: EngineId, args: string[]): ChildProcess {
  const bin = resolveEngine(id);
  if (!bin) throw new Error(`Motor ${id} no disponible`);
  return spawn(bin, args, {
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    // Los motores escritos en Python (yt-dlp, gallery-dl, spotdl, instaloader…)
    // escriben en la codificación ANSI del sistema (cp1252/cp850 en Windows) y
    // Node decodifica como UTF-8: los títulos y mensajes con acentos o comillas
    // tipográficas llegaban como "you?re". Forzar UTF-8 lo arregla de raíz.
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });
}

export function runCapture(id: EngineId, args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "", err = "";
    let p: ChildProcess;
    try { p = spawnEngine(id, args); } catch (e) { return reject(e); }
    const t = setTimeout(() => { killTree(p); reject(new Error("timeout")); }, timeout);
    // StringDecoder: `chunk.toString()` parte los caracteres multibyte que caen
    // a caballo entre dos trozos y los convierte en "?".
    const dOut = new StringDecoder("utf8"), dErr = new StringDecoder("utf8");
    p.stdout?.on("data", (d) => (out += dOut.write(d)));
    p.stderr?.on("data", (d) => (err += dErr.write(d)));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (c) => {
      clearTimeout(t);
      if (c === 0) return resolve(out);
      // Se busca la línea que yt-dlp marca como ERROR, no simplemente la última.
      // Los plugins (p. ej. el proveedor de PO tokens que intenta con deno)
      // escriben avisos DESPUÉS del error real, y acababan siendo el mensaje
      // que veía el usuario: "Command 'deno.exe'…" en vez de "Sign in to confirm".
      const lineas = err.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Se prefiere el error del EXTRACTOR ("ERROR: [youtube] …"), que es el que
      // explica de verdad qué pasó. Los plugins —p. ej. el proveedor de PO
      // Tokens que lanza deno— también emiten "ERROR: Command …" y tapaban el
      // mensaje útil con ruido interno.
      const real = [...lineas].reverse().find((l) => /^ERROR:\s*\[/i.test(l))
        ?? [...lineas].reverse().find((l) => /^ERROR:/i.test(l));
      reject(new Error(real ?? lineas[lineas.length - 1] ?? `código ${c}`));
    });
  });
}

function killTree(p: ChildProcess) {
  if (!p.pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { shell: false, windowsHide: true });
    else process.kill(-p.pid, "SIGKILL");
  } catch { try { p.kill("SIGKILL"); } catch {} }
}

async function probeMeta(job: Job) {
  if (job.engine !== "yt-dlp") return;
  try {
    const out = await runCapture("yt-dlp", ["--dump-single-json", "--no-playlist", "--skip-download", "--", job.url], 25000);
    const j = JSON.parse(out);
    job.title = j.title || job.title;
    job.thumbnail = j.thumbnail || "";
    (job as Job & { meta?: JobMeta }).meta = {
      author: j.uploader || j.channel || "",
      date: j.upload_date || "",
      duration: j.duration || 0,
      videoId: typeof j.id === "string" ? j.id : undefined,
    };
  } catch {}
}

async function simulate(job: Job) {
  // Motores mockeados: progreso sintético, sin ejecutables reales
  job.state = "running"; job.title = `Demo · ${job.label}`;
  for (let p = 0; p <= 100; p += 5) {
    if (job.state !== "running") return;
    job.percent = p; job.speed = 2_000_000 + Math.random() * 3_000_000; job.eta = `00:${String(Math.round((100 - p) / 10)).padStart(2, "0")}`;
    emit();
    await new Promise((r) => setTimeout(r, 120));
  }
  job.files = [`/mock/${job.id}.${job.format}`];
}

async function run(job: Job) {
  const cfg = getConfig();
  await getEngines();
  try {
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    job.state = "probing"; emit();
    if (MOCK) await simulate(job);
    else {
      await probeMeta(job);
      if ((job.state as JobState) !== "probing") return; // cancelado durante el probe
      const ff = resolveEngine("ffmpeg");
      const ck = cookieFile(job.platform);
      // Antes de lanzar: si el usuario borró el archivo, hay que quitar el id del
      // archive de ESTE modo. Si no, `--download-archive` lo salta en silencio y
      // el trabajo "termina bien" sin bajar nada.
      if (cfg.noRepeat) reconcileArchiveFor(job.mode);
      const args = buildArgs(job.engine, detect(job.url) as Detected, {
        mode: job.mode, format: job.format, quality: job.quality, outputDir: cfg.outputDir, turbo: cfg.turbo && !job.noTurbo,
aria2Healthy: isHealthy("aria2c"), noRepeat: cfg.noRepeat, embedMetadata: cfg.embedMetadata, archiveFile: archiveFileFor(job.mode), profileLimit: cfg.profileLimit,
        cookies: fs.existsSync(ck) ? ck : null, ffmpegDir: ff ? path.dirname(ff) : null,
        tempDir: TEMP_DIR,
      });
      job.state = "running"; emit();
      await new Promise<void>((resolve, reject) => {
        const p = spawnEngine(job.engine, args);
        mgr.procs.set(job.id, p);
        let buf = "";
        const decOut = new StringDecoder("utf8"), decErr = new StringDecoder("utf8");
        const onData = (d: Buffer, dec: StringDecoder) => {
          buf += dec.write(d);
          const lines = buf.split(/\r?\n|\r/);
          buf = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            job.log.push(l.slice(0, 300)); if (job.log.length > 200) job.log.shift();
            const pr = parseLine(l);
            if (pr?.percent !== undefined) job.percent = pr.percent;
            if (pr?.speed !== undefined) job.speed = pr.speed;
            if (pr?.eta) job.eta = pr.eta;
            if (pr?.file) job.files.push(pr.file);
            // gallery-dl imprime rutas de archivos descargados
            if (job.engine === "gallerydl" && /^[#\s]*[A-Za-z]:\\|^\//.test(l.trim())) job.files.push(l.replace(/^#\s*/, "").trim());
          }
          emit();
        };
        p.stdout?.on("data", (d) => onData(d, decOut));
        p.stderr?.on("data", (d) => onData(d, decErr));
        p.on("error", reject);
        p.on("close", (code) => {
          mgr.procs.delete(job.id);
          if (job.state !== "running") return resolve(); // pausado/cancelado
          code === 0 ? resolve() : reject(new Error(job.log.filter((l) => /error/i.test(l)).pop() || `El motor terminó con código ${code}`));
        });
      });
      if (job.state !== "running") return;
      // Post-proceso: conversión de fotos con Magick
      job.state = "post"; job.percent = 100; emit();
      if (job.mode === "photo" && cfg.photoFormat !== "original" && isHealthy("magick")) {
        for (const f of [...job.files]) {
          if (/\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(f) && !f.toLowerCase().endsWith("." + cfg.photoFormat)) {
            try { await runCapture("magick", magickArgs(f, cfg.photoFormat as "webp" | "jpg"), 60000); } catch {}
          }
        }
      }
    }
    // Verificación final con ffprobe y escritura de historial
    const meta = (job as Job & { meta?: JobMeta }).meta;
    const files = job.files.length ? job.files : [];
    for (const f of files.slice(0, 50)) {
      let size = 0, duration = meta?.duration ?? 0, fmt = path.extname(f).slice(1) || job.format;
      try { size = fs.statSync(f).size; } catch {}
      if (!MOCK && isHealthy("ffprobe") && /\.(mp3|m4a|flac|wav|opus|ogg|aac|mp4|mkv|webm|mov)$/i.test(f)) {
        try {
          const pj = JSON.parse(await runCapture("ffprobe", ffprobeArgs(f), 15000));
          duration = parseFloat(pj.format?.duration) || duration;
          // La extensión REAL del archivo manda sobre format_name de ffprobe
          // (un .m4a llega como "mov,mp4,m4a,..." y partía por "," dando "mov").
          fmt = path.extname(f).slice(1).toLowerCase() || fmt;
        } catch {}
      }
      addHistory({
        id: Math.random().toString(36).slice(2, 10), url: job.url, title: files.length > 1 ? path.basename(f) : job.title,
        author: meta?.author || "", date: meta?.date || "", source: job.label, format: fmt, size, duration, path: f,
        thumbnail: job.thumbnail, engine: job.engine, mode: job.mode, createdAt: Date.now(), videoId: meta?.videoId,
      });
    }
    if (!files.length) addHistory({ id: job.id, url: job.url, title: job.title, author: meta?.author || "", date: meta?.date || "", source: job.label, format: job.format, size: 0, duration: meta?.duration ?? 0, path: cfg.outputDir, thumbnail: job.thumbnail, engine: job.engine, mode: job.mode, createdAt: Date.now(), videoId: meta?.videoId });
    job.state = "done"; job.speed = 0; job.eta = "";
    event("done", { id: job.id, title: job.title });
  } catch (e) {
    job.error = e instanceof Error ? e.message : String(e);
    // ── Fallback de TURBO ──
    // aria2c falla en algunas CDN (YouTube: "aria2c exited with code 22") y
    // yt-dlp NO vuelve solo al descargador nativo: el trabajo se perdería. Se
    // reintenta el mismo trabajo sin turbo, que es lo que funciona.
    if (!job.noTurbo && /aria2c exited with code/i.test(job.error)) {
      job.noTurbo = true;
      job.log.push("[turbo] aria2c falló; reintentando con el descargador nativo de yt-dlp");
      job.error = undefined;
      job.percent = 0; job.speed = 0; job.eta = "";
      job.state = "queued";
      job.retryAt = Date.now() + 500;
      emit();
      return; // finally → emit() + pump()
    }
    // ── Reintento automático ante fallos TRANSITORIOS ──
    // (WinError 5/2 = archivo bloqueado por antivirus/indexador al renombrar,
    //  cortes del CDN, resets de conexión). Errores "honestos" (cookies,
    //  sin extractor, formato no soportado) NO se reintentan.
    const transitorio = /WinError 5|WinError 2|Acceso denegado|ENOENT|Giving up|Read error|Connection|timed?\s?out|10054|10053|HTTP Error 5\d\d|Got error/i.test(job.error);
    if (transitorio && (job.attempts ?? 0) < 2 && job.state !== "canceled") {
      job.attempts = (job.attempts ?? 0) + 1;
      job.log.push(`[reintento ${job.attempts}/2] fallo transitorio, reintentando en 3 s: ${job.error.slice(0, 180)}`);
      job.error = undefined;
      job.percent = 0; job.speed = 0; job.eta = "";
      job.state = "queued";
      job.retryAt = Date.now() + 3000;
      emit();
      return; // finally → emit() + pump() reprograma el reintento
    }
    job.state = "error"; job.speed = 0;
    event("error", { id: job.id, title: job.title, error: job.error });
    if (/no disponible/.test(job.error)) void scanEngines();
  } finally {
    emit();
    pump();
  }
}

export function action(id: string, act: "pause" | "resume" | "cancel" | "retry" | "remove" | "move", to?: number): boolean {
  const i = mgr.jobs.findIndex((j) => j.id === id);
  if (i < 0) return false;
  const job = mgr.jobs[i];
  const p = mgr.procs.get(id);
  if (act === "pause" && ["running", "probing", "queued"].includes(job.state)) {
    // Pausa = matar proceso; yt-dlp reanuda desde el .part al volver a lanzar
    job.state = "paused"; job.speed = 0; if (p) killTree(p);
  } else if (act === "cancel") {
    job.state = "canceled"; job.speed = 0; if (p) killTree(p);
  } else if ((act === "resume" || act === "retry") && ["paused", "error", "canceled", "skipped"].includes(job.state)) {
    job.state = "queued"; job.error = undefined; if (act === "retry") { job.percent = 0; job.attempts = 0; job.retryAt = undefined; }
  } else if (act === "remove") {
    if (p) killTree(p);
    mgr.jobs.splice(i, 1);
  } else if (act === "move" && typeof to === "number") {
    mgr.jobs.splice(i, 1);
    mgr.jobs.splice(Math.max(0, Math.min(mgr.jobs.length, to)), 0, job);
  }
  emit();
  pump();
  return true;
}

export function clearFinished() {
  mgr.jobs = mgr.jobs.filter((j) => !["done", "canceled", "skipped", "error"].includes(j.state));
  emit();
}
