// Gestor de cola: concurrencia, spawn sin shell, progreso, pausa/cancelar (kill de árbol), post-proceso, ffprobe, historial.
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import fs from "node:fs";
import path from "node:path";
import { buildArgs, ffprobeArgs, ffmpegAudioArgs, ffmpegVideoArgs, magickArgs } from "../shared/args";
import { detect, routeEngine, modeParts, supportedModes, AUDIO_FORMATS, VIDEO_FORMATS, PHOTO_FORMATS, type AtomicMode, type Detected, type EngineId, type Mode } from "../shared/platforms";
import { parseLine } from "../shared/progress";
import { planAudio, type AudioSource } from "../shared/fidelity";
import { audioTarget, codecMatches, resolveContainer, type VideoCodec } from "../shared/codecs";
import { HostLimiter, hostKey } from "./ratelimit";
import { baidupcsTransferArgs, parseBaidu, parseTransferredPath } from "../shared/baidu";
import { guardarCola, leerCola, reanudar, type JobPersistido } from "./queue-store";
import { enVentanaSilenciosa, msHastaApertura, puedeArrancar } from "../shared/schedule";
import { descargarLanzou, esLanzou, nombreSeguro, resolverLanzou } from "./lanzou";
import { programarApagado } from "./power";
import { esErrorDeCookies, explicarError } from "../shared/errores";

/**
 * Convierte un cookies.txt (formato Netscape) en pares `nombre=valor`, que es lo
 * único que entiende streamlink (`--http-cookie`). Los valores son credenciales:
 * se pasan al proceso y NUNCA se escriben en el log ni en el historial.
 */
/** Bytes libres en el disco de una ruta (null si el sistema no lo dice). */
export function espacioLibre(dir: string): number | null {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    // Windows antiguo / ruta de red: se sigue sin el dato, no se bloquea nada.
    return null;
  }
}

/** "1,4 GB" legible. */
export function formatoBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function cookiePairsFor(ck: string): string[] {
  try {
    return fs.readFileSync(ck, "utf8").split("\n")
      .filter((l) => l && !l.startsWith("#") && l.split("\t").length >= 7)
      .map((l) => { const c = l.split("\t"); return `${c[5]}=${c[6].trim()}`; })
      .filter((p) => !p.startsWith("="))
      .slice(0, 80);
  } catch { return []; }
}
import { isHealthy, MOCK, resolveEngine, scanEngines, getEngines } from "./engines";
import { addHistory, archiveFileFor, cookieFile, getConfig, inHistory, newId, reconcileArchiveFor, TEMP_DIR, type Config } from "./store";

export type JobState = "queued" | "probing" | "running" | "post" | "paused" | "done" | "error" | "canceled" | "skipped";
export interface Job {
  id: string;
  url: string;
  platform: string;
  label: string;
  mode: Mode;
  format: string;
  quality: string;
  /** Códec pedido SOLO para este trabajo (si no viene, manda el de Ajustes). */
  codec?: VideoCodec;
  /** Hora a partir de la cual puede arrancar (programado). */
  startAt?: number;
  /** Se reintentó sin cookies del navegador (su base no se pudo leer). */
  noCookies?: boolean;
  /** Recortes por trabajo (fase 9): si están puestos mandan sobre Ajustes. */
  sponsorblock?: "off" | "marcar" | "quitar";
  sections?: string;
  splitChapters?: boolean;
  /** De dónde salió el trabajo: a mano, de una suscripción o del taller. */
  from?: "manual" | "sub" | "taller";
  /** 提取码 de un recurso compartido de Baidu (no es una credencial de cuenta). */
  baiduPwd?: string;
  /** Ruta en tu nube de Baidu desde la que se descarga (la deja la transferencia). */
  baiduRemote?: string;
  /** Ruta en tu 阿里云盘 desde la que se descarga. */
  aliyunRemote?: string;
  /** Bytes descargados (lo usa el extractor nativo de Lanzou). */
  bytes?: number;
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
  /** Terminó "bien" pero sin archivos: aviso para la UI, no es un error duro */
  warning?: string;
  /** El formato final se generó desde una fuente con pérdida (FLAC desde AAC). */
  upconvert?: boolean;
  /** Segundos de espera impuestos por el rate limit, si los hubo. */
  cooldownMs?: number;
}

// Limitador compartido por host (vive en el proceso, sobrevive a los jobs).
const limiter = new HostLimiter({ maxCooldownMs: 5 * 60_000 });
export const getLimiter = () => limiter;

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
  /** Códec real del stream de audio de mejor calidad (para el guardián de fidelidad). */
  audioCodec?: string;
  audioAbr?: number;
  audioExt?: string;
  /** Tamaño aproximado que va a ocupar (suma de los mejores streams). */
  sizeApprox?: number;
}

interface Mgr { jobs: Job[]; procs: Map<string, ChildProcess>; bus: EventEmitter }
const g = globalThis as unknown as { __lyMgr?: Mgr };
const mgr: Mgr = g.__lyMgr ?? (g.__lyMgr = { jobs: [], procs: new Map(), bus: new EventEmitter() });

// ── Restaurar la cola del disco (una sola vez por proceso) ──────────────────
// Next en modo dev recarga módulos en caliente: `mgr` vive en globalThis para no
// duplicar la cola, y la restauración se marca ahí mismo para no repetirla.
const gRestore = g as unknown as { __lyRestored?: boolean };
if (!gRestore.__lyRestored) {
  gRestore.__lyRestored = true;
  const guardados = reanudar(leerCola());
  if (guardados.length) {
    mgr.jobs = guardados.map((j) => ({
      ...j,
      mode: j.mode as Mode,
      engine: j.engine as EngineId,
      state: j.state as JobState,
      percent: j.state === "done" ? 100 : 0, speed: 0, eta: "",
    })) as Job[];
    setTimeout(() => pump(), 1500); // deja respirar al arranque del servidor
  }
}

// ── Persistencia debounced ──────────────────────────────────────────────────
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    guardarCola(mgr.jobs as unknown as JobPersistido[]);
  }, 1000);
}
mgr.bus.setMaxListeners(100);

export const bus = mgr.bus;
export const listJobs = () => mgr.jobs.map(({ log, ...j }) => ({ ...j, log: log.slice(-3) }));

let emitTimer: NodeJS.Timeout | null = null;
function emit() {
  // Throttle a ~10 eventos/s para no saturar SSE
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    bus.emit("jobs", listJobs());
    persist();
  }, 100);
}
function event(type: string, data: unknown) { bus.emit("event", { type, data }); persist(); }

// Formato concreto por parte atómica: respeta el elegido si encaja en su pool;
// si no (p. ej. en un combo el usuario dejó "mp4" y esta parte es audio), cae
// al default de configuración. Evita jobs absurdos tipo "bajar audio en webm".
export function formatForPart(part: AtomicMode, chosen: string, cfg: Config): string {
  // «Perfil completo» puede bajarse en audio (el README lo promete: un canal o
  // un perfil de SoundCloud en mp3). Antes su pool era solo VIDEO_FORMATS, así
  // que elegir mp3 se degradaba en silencio a mp4.
  const pools: Record<AtomicMode, readonly string[]> = { audio: AUDIO_FORMATS, video: VIDEO_FORMATS, photo: PHOTO_FORMATS, profile: [...AUDIO_FORMATS, ...VIDEO_FORMATS] };
  if (pools[part].includes(chosen)) return chosen;
  if (part === "audio") return cfg.audioFormat;
  if (part === "photo") return cfg.photoFormat;
  return cfg.videoFormat;
}

export interface ExtraJob {
  sponsorblock?: "off" | "marcar" | "quitar";
  sections?: string;
  splitChapters?: boolean;
  from?: "manual" | "sub" | "taller";
}

export function enqueue(
  urls: string[], mode: Mode, format: string, quality: string,
  codec?: VideoCodec, delayMin = 0, extra: ExtraJob = {},
): { added: Job[]; rejected: string[] } {
  const cfg = getConfig();
  const added: Job[] = [];
  const rejected: string[] = [];
  for (const u of urls) {
    const d = detect(u);
    if (!d) { rejected.push(u); continue; }
    // Threads no tiene extractor en yt-dlp NI gallery-dl: rechazo honesto con motivo
    if (d.platform === "threads") { rejected.push(`${u} — Threads aún no tiene extractor (yt-dlp/gallery-dl no lo soportan)`); continue; }
    // Baidu Wenku no tiene archivo: el documento se pinta en canvas con texto
    // ofuscado y la descarga es de pago. Mejor decirlo que fingir un trabajo.
    if (d.platform === "baidu-wenku") { rejected.push(`${u} — Baidu Wenku no ofrece archivo descargable (canvas + VIP). Usa Ctrl+P → «Guardar como PDF» en el navegador.`); continue; }
    // 百度网盘: se separa el código 提取码 del enlace antes de nada.
    const binfo = d.platform === "baidu-pan" ? parseBaidu(u) : null;
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
        id: newId(), url: binfo?.url ?? d.url, platform: d.platform, label: d.label,
        mode: part, format: formatForPart(part, format, cfg), quality, codec, engine,
        startAt: delayMin > 0 ? Date.now() + delayMin * 60_000 : undefined,
        sponsorblock: extra.sponsorblock,
        sections: extra.sections,
        splitChapters: extra.splitChapters,
        from: extra.from ?? "manual",
        baiduPwd: binfo?.pwd,
        state: "queued", percent: 0, speed: 0, eta: "", title: binfo?.url ?? d.url, thumbnail: "", files: [], log: [], createdAt: Date.now(),
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

/**
 * Cuántos trabajos pueden correr a la vez.
 *
 * `concurrency = 0` significa SIN LÍMITE: se lanza todo lo que haya en cola.
 * Pero "sin límite" literal es un tiro en el pie —cada descarga es un proceso
 * del sistema con sockets abiertos— así que se aplica un techo de seguridad
 * (`maxConcurrency`, 24 por defecto, configurable hasta 64). Por encima de eso
 * lo normal es EMFILE (sin descriptores), el disco saturado y que el CDN te
 * devuelva 429 a todo. El freno adaptativo de verdad es el de `ratelimit.ts`:
 * se para por HOST, no por número total.
 */
function limiteEfectivo(cfg: Config): number {
  const enCola = mgr.jobs.filter((j) => j.state === "queued").length;
  if (cfg.concurrency === 0) return Math.max(1, Math.min(cfg.maxConcurrency, active() + enCola));
  return Math.max(1, Math.min(cfg.concurrency, cfg.maxConcurrency));
}

/** Se pone a true en cuanto termina un trabajo: solo entonces tiene sentido
 *  apagar el equipo al vaciarse la cola (arrancar la app en vacío no apaga nada). */
let algoTermino = false;
export const marcarTerminado = () => { algoTermino = true; };

function pump() {
  const cfg = getConfig();
  limiter.setPerMinute(cfg.ratePerMinute);
  const now = Date.now();

  // ── Ventana "solo de noche" ────────────────────────────────────────────────
  // Fuera de la ventana no arranca NADA nuevo, pero lo que ya está en marcha
  // sigue: matar una descarga al 90 % sería peor que dejarla terminar.
  if (cfg.quietEnabled && enVentanaSilenciosa(cfg.quietFrom, cfg.quietTo, now)) {
    for (const j of mgr.jobs) {
      if (j.state !== "queued") continue;
      const aviso = `[programador] en espera: solo se descarga entre ${cfg.quietFrom} y ${cfg.quietTo}`;
      if (j.log.at(-1) !== aviso) { j.log.push(aviso); emit(); }
    }
    const falta = msHastaApertura(cfg.quietFrom, cfg.quietTo, now);
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, Math.max(1000, falta) + 500);
    return;
  }
  // ── Apagado al terminar ────────────────────────────────────────────────────
  // Solo si el usuario lo pidió, ya terminó algo y no queda NADA en marcha.
  if (cfg.apagarAlTerminar && algoTermino && active() === 0 && !mgr.jobs.some((j) => j.state === "queued")) {
    algoTermino = false;
    const r = programarApagado(60);
    const nota = r.ok
      ? "[sistema] equipo se apagará en 60 s — cancela desde la barra de arriba"
      : `[sistema] no se pudo programar el apagado: ${r.error}`;
    const ultimo = mgr.jobs.filter((j) => j.state === "done").at(-1);
    if (ultimo) { ultimo.log.push(nota); emit(); }
  }

  const tope = limiteEfectivo(cfg);
  let esperaPorRitmo = Infinity;
  while (active() < tope) {
    // Elige el PRIMER trabajo listo cuyo host no esté en enfriamiento. Si el
    // primero de la cola está en cooldown, se salta y se busca otro de OTRO
    // host: así un sitio castigado no bloquea el resto de descargas.
    let next: Job | undefined;
    for (const j of mgr.jobs) {
      if (j.state !== "queued") continue;
      if ((j.retryAt ?? 0) > now) continue;
      if (!puedeArrancar(j.startAt, now)) continue; // programado para más tarde
      const gate = limiter.check(j.url, now);
      if (gate.kind === "ok") { next = j; break; }
      esperaPorRitmo = Math.min(esperaPorRitmo, Math.max(250, gate.waitMs));
    }
    if (!next) break;
    // Marcar de forma síncrona: si no, el while volvería a elegir el mismo job (bucle infinito)
    next.state = "probing";
    void run(next);
  }
  // Reprogramar: por reintentos diferidos, por enfriamiento de host o por hora
  // programada de un trabajo.
  const futuros = mgr.jobs.filter((j) => j.state === "queued" && (j.retryAt ?? 0) > Date.now());
  let proximo = esperaPorRitmo === Infinity ? Infinity : now + esperaPorRitmo;
  if (futuros.length) proximo = Math.min(proximo, Math.min(...futuros.map((j) => j.retryAt ?? 0)));
  const programados = mgr.jobs.filter((j) => j.state === "queued" && j.startAt && j.startAt > Date.now()).map((j) => j.startAt as number);
  if (programados.length) proximo = Math.min(proximo, Math.min(...programados));
  if (proximo !== Infinity) {
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, Math.max(100, proximo - Date.now()) + 50);
  }
}
let pumpTimer: NodeJS.Timeout | null = null;

/**
 * Despierta la cola YA. Se llama cuando cambian cosas que afectan a la
 * planificación (la ventana silenciosa, por ejemplo): si no, al cerrar la
 * ventana desde Ajustes el `pump()` seguiría dormido hasta la hora que se
 * calculó con la configuración VIEJA (podían ser horas).
 */
export function despertarCola(): void {
  if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; }
  pump();
}

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

export function runCapture(
  id: EngineId,
  args: string[],
  timeout = 30000,
  /**
   * Se llama en cuanto el proceso existe, para que quien lo lanzó pueda
   * REGISTRARLO (p. ej. en `mgr.procs`). Sin esto, pausar o cancelar un trabajo
   * durante el sondeo previo (`--dump-single-json`) no mataba nada: el proceso
   * seguía vivo y el trabajo quedaba "pausado" con un yt-dlp huérfano detrás.
   */
  onSpawn?: (p: ChildProcess) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "", err = "";
    let p: ChildProcess;
    try { p = spawnEngine(id, args); } catch (e) { return reject(e); }
    try { onSpawn?.(p); } catch {}
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
    // Se registra el proceso de sondeo para que pausar/cancelar lo mate de
    // verdad (antes quedaba huérfano y seguía gastando red y CPU).
    const out = await runCapture(
      "yt-dlp",
      ["--dump-single-json", "--no-playlist", "--skip-download", "--", job.url],
      25000,
      (p) => {
        mgr.procs.set(job.id, p);
        p.on("close", () => { if (mgr.procs.get(job.id) === p) mgr.procs.delete(job.id); });
      },
    );
    const j = JSON.parse(out);
    job.title = j.title || job.title;
    job.thumbnail = j.thumbnail || "";
    // Mejor stream SOLO de audio (vcodec "none"): de ahí sale el códec real,
    // que es lo que decide si un FLAC tiene sentido o sería un FLAC falso.
    const formatos = ((j.formats ?? []) as { filesize?: number; filesize_approx?: number; vcodec?: string; acodec?: string }[]);
    const tam = (f?: { filesize?: number; filesize_approx?: number }) => f?.filesize ?? f?.filesize_approx ?? 0;
    // Aproximación honesta: el mejor vídeo + el mejor audio si vienen separados
    // (DASH). Si el sitio da el archivo ya mezclado, se usa ese.
    const mejorVideo = formatos.filter((f) => f.vcodec && f.vcodec !== "none").sort((a, b) => tam(b) - tam(a))[0];
    const sizeApprox = Number(j.filesize_approx ?? tam(mejorVideo) ?? 0) || undefined;
    const audios = ((j.formats ?? []) as { acodec?: string; vcodec?: string; abr?: number; ext?: string }[])
      .filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
      .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
    const mejorAudio = audios[0];
    (job as Job & { meta?: JobMeta }).meta = {
      author: j.uploader || j.channel || "",
      date: j.upload_date || "",
      duration: j.duration || 0,
      videoId: typeof j.id === "string" ? j.id : undefined,
      audioCodec: mejorAudio?.acodec ?? (typeof j.acodec === "string" ? j.acodec : undefined),
      audioAbr: mejorAudio?.abr ?? (typeof j.abr === "number" ? j.abr : undefined),
      audioExt: mejorAudio?.ext ?? (typeof j.ext === "string" ? j.ext : undefined),
      sizeApprox,
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
  /** Códec efectivo de ESTE trabajo: el del encargo manda sobre Ajustes. */
  const codecJob: VideoCodec = job.codec ?? cfg.videoCodec;
  const inicioJob = Date.now();
  await getEngines();
  try {
    fs.mkdirSync(cfg.outputDir, { recursive: true });
    job.state = "probing"; emit();
    if (MOCK) await simulate(job);
    else {
      await probeMeta(job);
      if ((job.state as JobState) !== "probing") return; // cancelado durante el probe
      // ── GUARDIÁN DE FIDELIDAD ────────────────────────────────────────────
      // Con el códec real del origen ya conocido, se decide si el formato pedido
      // tiene sentido. Pedir FLAC sobre un AAC de YouTube produce un "FLAC
      // falso" (mismo audio, 5× el peso); en modo estricto se entrega el audio
      // original sin recodificar y se explica por qué.
      const meta0 = (job as Job & { meta?: JobMeta }).meta;
      if ((AUDIO_FORMATS as readonly string[]).includes(job.format) && (meta0?.audioCodec || meta0?.audioExt)) {
        const src: AudioSource = { codec: meta0?.audioCodec, abr: meta0?.audioAbr, ext: meta0?.audioExt };
        // El "fallback" es el contenedor al que se cae en modo estricto cuando
        // el códec no se reconoce. NO puede ser un formato lossless (sería
        // volver al problema que intentamos evitar) ni "best".
        const fb = ["best", "flac", "wav", "alac", "aiff"].includes(cfg.audioFormat) ? "m4a" : cfg.audioFormat;
        const plan = planAudio(job.format, src, cfg.fidelity, fb);
        if (plan.note) job.log.push(`[fidelidad] ${plan.note}`);
        job.upconvert = plan.upconvert;
        if (plan.format !== job.format) {
          job.log.push(`[fidelidad] formato de salida: ${job.format} → ${plan.format}`);
          job.format = plan.format;
          emit();
        }
      }
      // Si el códec elegido no cabe en el contenedor (webm + H.264), el motor
      // cambiaría la caja en silencio. Mejor decirlo en el log del trabajo.
      // ── 百度网盘: transferir a TU nube antes de descargar ────────────────
      // Son dos procesos distintos de BaiduPCS-Go. El login lo hiciste tú una
      // vez dentro del propio programa; aquí no se toca ninguna credencial.
      if (job.engine === "baidupcs") {
        const pcs = resolveEngine("baidupcs");
        if (!pcs) throw new Error("Falta BaiduPCS-Go.exe en vendor/. Sin él no hay forma de bajar de 百度网盘 (el enlace no es un archivo): descárgalo de github.com/qjfoidnh/BaiduPCS-Go/releases, inicia sesión UNA vez con `BaiduPCS-Go login` y vuelve a intentarlo.");
        const info = parseBaidu(job.url);
        if (!info?.surl) throw new Error("Ese enlace de Baidu no parece un recurso compartido (/s/…).");
        job.log.push(`[baidu] transfiriendo el recurso a tu nube${job.baiduPwd ? " (con 提取码)" : " (sin código)"}…`);
        emit();
        let salida = "";
        try {
          salida = await runCapture("baidupcs", baidupcsTransferArgs(job.url, job.baiduPwd, cfg.baiduDir), 240000);
        } catch (e) {
          const txt = e instanceof Error ? e.message : String(e);
          if (/未登录|not logged|login/i.test(txt)) {
            throw new Error("BaiduPCS-Go no tiene sesión iniciada. Abre una consola en vendor/ y ejecuta: BaiduPCS-Go login   (una sola vez; tu contraseña no pasa por esta app).");
          }
          if (/提取码|pwd|密码/i.test(txt)) throw new Error(`El recurso pide código 提取码 y no es válido. Pega el enlace con «?pwd=abcd» o añade «提取码: abcd».`);
          throw new Error(`No se pudo transferir el recurso: ${txt.slice(0, 200)}`);
        }
        const remoto = parseTransferredPath(salida) ?? cfg.baiduDir;
        job.baiduRemote = remoto;
        job.log.push(`[baidu] guardado en ${remoto}; descargando desde tu nube…`);
        emit();
      }
      // ── 阿里云盘: transferir el recurso compartido y bajar de tu drive ────
      if (job.engine === "aliyunpan") {
        const cli = resolveEngine("aliyunpan");
        if (!cli) throw new Error("Falta aliyunpan.exe en vendor/. Descárgalo de github.com/tickstep/aliyunpan/releases, inicia sesión una vez (`aliyunpan login`) y reintenta.");
        job.log.push("[aliyun] guardando el enlace compartido en tu drive…");
        emit();
        try {
          const salida = await runCapture("aliyunpan", ["share", job.url, "-save"], 180000);
          const m = salida.match(/(\/[^\s]+)/);
          if (m) job.aliyunRemote = m[1];
        } catch (e) {
          const txt = e instanceof Error ? e.message : String(e);
          if (/login|登录|token/i.test(txt)) throw new Error("aliyunpan no tiene sesión: ejecuta `aliyunpan login` una vez en vendor/.");
          throw new Error(`No se pudo guardar el recurso: ${txt.slice(0, 200)}`);
        }
      }
      // ── 蓝奏云: extractor NATIVO (no hay binario que lanzar) ─────────────
      // Toda la cadena (página → iframe → sign → ajaxm) la hace lanzou.ts con
      // fetch, y la descarga se escribe a disco con progreso real.
      let nativo = false;
      if (job.engine === "lanzou") {
        nativo = true;
        if (!esLanzou(job.url)) throw new Error("Ese enlace no es de 蓝奏云.");
        job.state = "running"; job.percent = 0; emit();
        job.log.push("[lanzou] resolviendo el enlace directo…");
        const pwd = job.baiduPwd; // mismo hueco: ?pwd= o «密码: xxxx»
        const resuelto = await resolverLanzou(job.url, pwd);
        job.log.push(`[lanzou] archivo: ${resuelto.nombre}`);
        const destino = path.join(cfg.outputDir, nombreSeguro(resuelto.nombre));
        await descargarLanzou(resuelto, destino, (pct, bytes) => {
          job.percent = pct;
          job.speed = 0;
          job.eta = "";
          job.bytes = bytes;
          emit();
        });
        job.files = [destino];
        job.log.push(`[lanzou] descargado: ${path.basename(destino)}`);
        emit();
      }
      if (job.mode === "video") {
        const rc = resolveContainer(job.format, codecJob);
        if (rc.forced) job.log.push(`[códec] ${rc.forced}`);
      }
      // ── ¿Cabe en el disco? ───────────────────────────────────────────────
      // Quedarse sin espacio a mitad de un MKV de 20 GB deja un `.part`
      // inservible y, si es el disco del sistema, tumba la app entera.
      const metaEspacio = (job as Job & { meta?: JobMeta }).meta;
      if (cfg.abortOnDiskFull && metaEspacio?.sizeApprox) {
        const libre = espacioLibre(cfg.outputDir);
        if (libre !== null && libre < metaEspacio.sizeApprox * 1.15) {
          throw new Error(`No hay espacio: el archivo ocupa ~${formatoBytes(metaEspacio.sizeApprox)} y quedan ${formatoBytes(libre)}. Libera espacio o cambia la carpeta de salida.`);
        }
      }
      const ff = resolveEngine("ffmpeg");
      const ck = cookieFile(job.platform);
      // Antes de lanzar: si el usuario borró el archivo, hay que quitar el id del
      // archive de ESTE modo. Si no, `--download-archive` lo salta en silencio y
      // el trabajo "termina bien" sin bajar nada.
      //
      // OJO: reconciliar implica REESCRIBIR `archive-<modo>.txt`, mientras yt-dlp
      // puede estar añadiéndole líneas desde otro trabajo del mismo modo vivo.
      // Con concurrencia ≥2 eso se comía entradas y provocaba descargas
      // duplicadas. Solo se reconcilia si no hay nadie más del mismo modo.
      const ocupado = mgr.jobs.some((j) => j !== job && j.mode === job.mode && ["probing", "running", "post"].includes(j.state));
      if (cfg.noRepeat && !ocupado) reconcileArchiveFor(job.mode);
      const args = nativo ? null : buildArgs(job.engine, detect(job.url) as Detected, {
        mode: job.mode, format: job.format, quality: job.quality, outputDir: cfg.outputDir, turbo: cfg.turbo && !job.noTurbo,
aria2Healthy: isHealthy("aria2c"), noRepeat: cfg.noRepeat, embedMetadata: cfg.embedMetadata, archiveFile: archiveFileFor(job.mode), profileLimit: cfg.profileLimit,
        cookies: fs.existsSync(ck) ? ck : null, ffmpegDir: ff ? path.dirname(ff) : null, ffmpegPath: ff,
        tempDir: TEMP_DIR,
        cookiesFromBrowser: job.noCookies ? null : (cfg.cookiesFromBrowser || null),
        impersonate: cfg.impersonate || null,
        limitRate: cfg.limitRate || null,
        retries: cfg.retries,
        sleepRequests: cfg.sleepRequests || null,
        audioQuality: cfg.audioQuality || null,
        videoCodec: codecJob,
        subtitles: cfg.subtitles,
        subLangs: cfg.subLangs,
        autoSubs: cfg.autoSubs,
        chapters: cfg.chapters,
        embedThumbnail: cfg.embedThumbnail,
        cookiePairs: job.engine === "streamlink" ? cookiePairsFor(ck) : undefined,
        naming: cfg.naming,
        proxy: cfg.proxy || null,
        playlistRange: cfg.playlistRange || null,
        baiduRemote: job.baiduRemote,
        baiduPwd: job.baiduPwd,
        // Recortes (fase 9): vienen de Ajustes o del propio trabajo.
        sponsorblock: job.sponsorblock ?? cfg.sponsorblock,
        sections: job.sections ?? cfg.sections,
        splitChapters: job.splitChapters ?? cfg.splitChapters,
      });
      if (args) {
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
            if (pr?.file && job.files.length < 500) job.files.push(pr.file);
            // gallery-dl imprime rutas de archivos descargados
            if (job.engine === "gallerydl" && job.files.length < 500 && /^[#\s]*[A-Za-z]:\\|^\//.test(l.trim())) job.files.push(l.replace(/^#\s*/, "").trim());
          }
          emit();
        };
        p.stdout?.on("data", (d) => onData(d, decOut));
        p.stderr?.on("data", (d) => onData(d, decErr));
        p.on("error", reject);
        p.on("close", (code) => {
          mgr.procs.delete(job.id);
          if (job.state !== "running") return resolve(); // pausado/cancelado
          if (code === 0) {
            // `--ignore-errors` hace que yt-dlp salga con código 0 aunque TODO
            // haya fallado. Sin esta comprobación el trabajo se marcaba "listo"
            // sin haber bajado ni un archivo (el usuario veía el toast verde y
            // no encontraba nada). Si hay una línea ERROR y no hay archivos,
            // el trabajo falló de verdad.
            const errLine = [...job.log].reverse().find((l) => /^\s*ERROR:/i.test(l));
            if (errLine && !job.files.length) return reject(new Error(errLine.replace(/^\s*ERROR:\s*/i, "").slice(0, 300)));
            return resolve();
          }
          reject(new Error(job.log.filter((l) => /error/i.test(l)).pop() || `El motor terminó con código ${code}`));
        });
        });
      }
      if (args && job.state !== "running") return;
      // Post-proceso: conversión de fotos con Magick
      job.state = "post"; job.percent = 100; emit();
      if (job.mode === "photo" && cfg.photoFormat !== "original" && isHealthy("magick")) {
        const convertidos: string[] = [];
        for (const f of [...job.files]) {
          if (/\.(png|jpe?g|webp|gif|bmp|heic|tiff?|avif)$/i.test(f) && !f.toLowerCase().endsWith("." + cfg.photoFormat)) {
            try {
              const argv = magickArgs(f, cfg.photoFormat);
              const destino = argv[argv.length - 1];
              await runCapture("magick", argv, 60000);
              if (fs.existsSync(destino)) convertidos.push(destino);
            } catch {}
          }
        }
        // El historial y la vista previa deben apuntar al archivo CONVERTIDO:
        // antes se registraba el .png original y la conversión a .webp quedaba
        // invisible en Recientes (los dos archivos acababan en disco).
        if (convertidos.length) job.files = convertidos;
      }
    }
      // BaiduPCS-Go no imprime rutas con un marcador (como yt-dlp con LYF|), así
      // que tras descargar se buscan los archivos NUEVOS de la carpeta de salida.
      // Sin esto, el trabajo terminaba "sin archivos" aunque el archivo estuviera.
      if (job.engine === "baidupcs" && !job.files.length) {
        const nuevos: string[] = [];
        const recorrer = (dir: string, prof = 0) => {
          if (prof > 6) return;
          let ents: fs.Dirent[] = [];
          try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of ents) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { recorrer(full, prof + 1); continue; }
            if (/\.(part|tmp|aria2|lyf)$/i.test(e.name)) continue;
            try { if (fs.statSync(full).mtimeMs >= inicioJob - 2000) nuevos.push(full); } catch {}
          }
        };
        recorrer(cfg.outputDir);
        if (nuevos.length) { job.files = nuevos.slice(0, 500); job.log.push(`[baidu] ${nuevos.length} archivo(s) nuevo(s) en la carpeta`); }
      }

      // ── POST: audio a un códec que yt-dlp no sabe extraer ──────────────────
      // AC-3, E-AC-3, DTS, MP2, PCM 24 bits… no están en la lista de
      // `--audio-format` (9 formatos). Se extrajo el stream original y aquí se
      // convierte con ffmpeg. Sin esto, pedir AC-3 era un error duro del motor.
      const ffx = resolveEngine("ffmpeg");
      const destinoAudio = audioTarget(job.format, cfg.audioQuality);
      // No solo mode "audio": un perfil descargado como AC-3 también entra aquí
      // (el formato es el que manda, no el modo).
      if (destinoAudio.needsFfmpeg && destinoAudio.ffmpegEncoder && ffx && job.files.length && (job.mode === "audio" || (AUDIO_FORMATS as readonly string[]).includes(job.format))) {
        const nuevos: string[] = [];
        for (const f of [...job.files]) {
          if (!/\.(m4a|mp3|flac|wav|opus|ogg|webm|aac|mka|aiff|wma)$/i.test(f)) { nuevos.push(f); continue; }
          try {
            const argv = ffmpegAudioArgs(f, destinoAudio);
            const salida = argv[argv.length - 1];
            await runCapture("ffmpeg", argv, 15 * 60_000);
            if (fs.existsSync(salida)) {
              nuevos.push(salida);
              if (!cfg.keepOriginal) { try { fs.unlinkSync(f); } catch {} }
            } else nuevos.push(f);
          } catch (e) {
            job.log.push(`[audio] no se pudo convertir a ${destinoAudio.label}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
            nuevos.push(f);
          }
        }
        if (nuevos.length !== job.files.length || nuevos.some((n, i) => n !== job.files[i])) {
          job.log.push(`[audio] convertido a ${destinoAudio.label} con ffmpeg${cfg.keepOriginal ? " (original conservado)" : ""}`);
          job.files = nuevos;
        }
      }

      // ── VERIFICACIÓN DE CÓDEC DE VÍDEO ─────────────────────────────────────
      // El selector de yt-dlp PREFIERE el códec pedido, pero si el sitio no lo
      // tiene baja lo mejor: aquí se comprueba con ffprobe qué llegó de verdad y
      // se avisa (o se recodifica, si el usuario lo pidió expresamente).
      if (job.mode === "video" && codecJob !== "auto" && isHealthy("ffprobe") && job.files.length) {
        const nuevos: string[] = [];
        for (const f of [...job.files]) {
          if (!/\.(mp4|mkv|webm|mov|m4v|ts|avi|flv|ogv)$/i.test(f)) { nuevos.push(f); continue; }
          let real = "";
          try {
            const pj = JSON.parse(await runCapture("ffprobe", ffprobeArgs(f), 20000));
            const v = (pj.streams ?? []).find((x: { codec_type?: string }) => x.codec_type === "video");
            real = String(v?.codec_name ?? v?.codec_tag_string ?? "");
          } catch { /* sin ffprobe no se puede afirmar nada */ }
          if (!real || codecMatches(real, codecJob)) { nuevos.push(f); continue; }
          if (!cfg.reencodeVideo || !ffx) {
            job.log.push(`[códec] el sitio no ofrece ${codecJob.toUpperCase()}; llegó ${real.toUpperCase()}. Activa "recodificar si falta el códec" para forzarlo.`);
            nuevos.push(f);
            continue;
          }
          try {
            job.log.push(`[códec] recodificando ${real.toUpperCase()} → ${codecJob.toUpperCase()} (puede tardar: es una segunda pasada completa)`);
            const cont = resolveContainer(job.format, codecJob).container;
            const argv = ffmpegVideoArgs(f, codecJob, cont);
            const salida = argv[argv.length - 1];
            await runCapture("ffmpeg", argv, 4 * 60 * 60_000);
            if (fs.existsSync(salida)) {
              nuevos.push(salida);
              if (!cfg.keepOriginal) { try { fs.unlinkSync(f); } catch {} }
            } else nuevos.push(f);
          } catch (e) {
            job.log.push(`[códec] la recodificación falló: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
            nuevos.push(f);
          }
        }
        job.files = nuevos;
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
        id: newId(), url: job.url, title: files.length > 1 ? path.basename(f) : job.title,
        author: meta?.author || "", date: meta?.date || "", source: job.label,
        format: job.upconvert ? `${fmt} (transcode)` : fmt, size, duration, path: f,
        thumbnail: job.thumbnail, engine: job.engine, mode: job.mode, createdAt: Date.now(), videoId: meta?.videoId,
      });
    }
    // Sin archivos NO se inventa una entrada de historial con `path: outputDir`.
    // Aquel "fantasma" apuntaba a una CARPETA: rompía Recientes (miniaturas y
    // botón de abrir), envenenaba la deduplicación (isLiveFile siempre false) y
    // hacía que la vista previa devolviera 404. Mejor: terminado, pero avisando.
    if (!files.length) {
      job.warning = "El motor terminó sin reportar archivos (¿ya estaba descargado, o ese formato no existe en el sitio?)";
      job.log.push(`[aviso] ${job.warning}`);
    }
    job.state = "done"; job.speed = 0; job.eta = "";
    marcarTerminado(); // con esto el apagado automático ya puede dispararse
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
    // ── LÍMITE DE TASA (429 / 403 / "not a bot") ──
    // Reintentar en caliente es lo PEOR que se puede hacer: el CDN ve N
    // peticiones más y alarga el castigo. Aquí se enfria el host entero
    // (backoff 30 s → 60 → 120 → 240 → 300) y los demás trabajos de ese mismo
    // sitio esperan; los de otros hosts siguen a toda velocidad.
    if (HostLimiter.isRateLimit(job.error) && job.state !== "canceled") {
      const hint = HostLimiter.retryAfterMs(job.error);
      const ban = limiter.penalize(job.url, Date.now(), hint);
      job.attempts = (job.attempts ?? 0) + 1;
      if (job.attempts <= 4) {
        job.cooldownMs = ban;
        job.log.push(`[rate-limit] el sitio pidió calma; ${hostKey(job.url)} en espera ${Math.round(ban / 1000)} s (intento ${job.attempts}/4)`);
        job.error = undefined;
        job.state = "queued";
        job.retryAt = Date.now() + ban;
        emit();
        return; // finally → emit + pump (el pump salta este host)
      }
      job.log.push("[rate-limit] 4 intentos con espera: se rinde. Prueba a activar cookies del navegador en Ajustes.");
    }
    // ── COOKIES ILEGIBLES (Chrome abierto / cifrado nuevo) ──
    // «Could not copy Chrome cookie database» no es un fallo de la descarga: es
    // que yt-dlp no puede leer la base del navegador. Antes se rendía ahí y el
    // usuario veía un error en inglés que no explicaba nada. Ahora se reintenta
    // UNA vez sin cookies —el 95 % del contenido público no las necesita— y solo
    // si eso también falla se rinde, explicando qué pasa.
    if (esErrorDeCookies(job.error) && !job.noCookies) {
      job.noCookies = true;
      job.log.push("[cookies] no se pudo leer la base del navegador (¿está abierto?); reintentando sin cookies");
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
    // Backoff exponencial: 3 s → 8 s → 20 s. Reintentar a los 3 s fijos contra
    // un CDN que te está limitando (HTTP 5xx/429) solo quema los tres intentos
    // seguidos; esperar cada vez más da tiempo real a que se recupere.
    const BACKOFF = [3000, 8000, 20000];
    const intentos = job.attempts ?? 0;
    if (transitorio && intentos < BACKOFF.length && job.state !== "canceled") {
      job.attempts = intentos + 1;
      const espera = Math.round(BACKOFF[intentos] / 1000);
      job.log.push(`[reintento ${job.attempts}/${BACKOFF.length}] fallo transitorio, reintentando en ${espera} s: ${job.error.slice(0, 180)}`);
      job.error = undefined;
      job.percent = 0; job.speed = 0; job.eta = "";
      job.state = "queued";
      job.retryAt = Date.now() + BACKOFF[intentos];
      emit();
      return; // finally → emit() + pump() reprograma el reintento
    }
    job.state = "error"; job.speed = 0;
    // El texto crudo se queda en el log (por si hay que pegarlo en un issue) y a
    // la cola va la explicación en español con el arreglo.
    job.log.push(`[error] ${job.error}`);
    const ex = explicarError(job.error);
    job.error = ex.arreglo ? `${ex.titulo} — ${ex.arreglo}` : ex.titulo;
    if (job.noCookies) job.log.push("[cookies] este trabajo ya se intentó sin cookies del navegador");
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
