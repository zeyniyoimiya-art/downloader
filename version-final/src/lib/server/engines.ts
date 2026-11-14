// Registro de los 12 motores: whitelist, resolución de ruta, detección de versión y salud.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { EngineId } from "../shared/platforms";
import { getConfig } from "./store";

export interface EngineDef {
  id: EngineId;
  exe: string; // nombre del ejecutable en Windows
  alt: string[]; // nombres alternativos aceptados (mismo binario, p.ej. ytdlp.exe)
  bin: string; // nombre en PATH (Linux/macOS)
  role: string;
  versionArgs: string[];
  optional?: boolean;
  /** Carpeta que el binario necesita al lado para arrancar (exiftool → perl). */
  requiereCarpeta?: string;
}

// WHITELIST: único conjunto de ejecutables que el servidor puede lanzar
export const ENGINES: EngineDef[] = [
  { id: "yt-dlp", exe: "yt-dlp.exe", alt: ["ytdlp.exe", "yt-dlp"], bin: "yt-dlp", role: "Video y audio general (primario)", versionArgs: ["--version"] },
  { id: "ffmpeg", exe: "ffmpeg.exe", alt: [], bin: "ffmpeg", role: "Post-proceso, conversión y metadatos", versionArgs: ["-version"] },
  { id: "ffprobe", exe: "ffprobe.exe", alt: [], bin: "ffprobe", role: "Inspección y verificación JSON", versionArgs: ["-version"] },
  { id: "ffplay", exe: "ffplay.exe", alt: [], bin: "ffplay", role: "Escucha rápida", versionArgs: ["-version"], optional: true },
  { id: "gallerydl", exe: "gallerydl.exe", alt: ["gallery-dl.exe"], bin: "gallery-dl", role: "Galerías: X, Pinterest, ArtStation", versionArgs: ["--version"] },
  { id: "instaloader", exe: "instaloader.exe", alt: [], bin: "instaloader", role: "Perfiles completos de Instagram", versionArgs: ["--version"] },
  { id: "spotdl", exe: "spotdl.exe", alt: [], bin: "spotdl", role: "Spotify con metadata y carátula", versionArgs: ["--version"] },
  { id: "lux", exe: "lux.exe", alt: [], bin: "lux", role: "Motor alterno (sitios CN)", versionArgs: ["-v"], optional: true },
  { id: "aria2c", exe: "aria2c.exe", alt: [], bin: "aria2c", role: "Aceleración multi-conexión (turbo)", versionArgs: ["--version"], optional: true },
  { id: "magick", exe: "Magick.exe", alt: ["magick.exe"], bin: "magick", role: "Fotos a WEBP/JPG y carátulas", versionArgs: ["-version"], optional: true },
  // exiftool: el paquete de Windows viene como `exiftool(-k).exe` + una carpeta
  // `exiftool_files\` con las DLLs de Perl. Sin esa carpeta el .exe no arranca.
  // Además NINGUNA parte de la app lo usa hoy (los metadatos van por ffprobe),
  // así que se marca opcional para que no aparezca como motor caído.
  { id: "exiftool", exe: "exiftool.exe", alt: ["exiftool(-k).exe"], bin: "exiftool", role: "EXIF de fotos (sin uso actual)", versionArgs: ["-ver"], optional: true, requiereCarpeta: "exiftool_files" },
  { id: "deno", exe: "deno.exe", alt: [], bin: "deno", role: "Scripts de mantenimiento", versionArgs: ["--version"], optional: true },
  // ── Ampliación universal ──────────────────────────────────────────────────
  // streamlink: en directos resuelve la lista HLS maestra y permite elegir
  // calidad; yt-dlp en vivo es más frágil (reinicia el .part, corta el chat).
  { id: "streamlink", exe: "streamlink.exe", alt: [], bin: "streamlink", role: "Directos y VOD: Twitch, Kick (HLS)", versionArgs: ["--version"], optional: true },
  // you-get: cubre varios sitios CN que yt-dlp no toca (Youku, iQiyi, Weibo…).
  { id: "youget", exe: "you-get.exe", alt: ["youget.exe"], bin: "you-get", role: "Sitios CN: Douyin, Youku, iQiyi, Weibo", versionArgs: ["--version"], optional: true },
  // curl: para archivos directos (zip, pdf, iso, apk, m3u8 suelto). Viene con
  // Windows 10+ y con todas las distros, así que no es opcional.
  { id: "curl", exe: "curl.exe", alt: [], bin: "curl", role: "Descarga directa de archivos", versionArgs: ["--version"] },
  // 百度网盘: único cliente de línea de comandos que hace 转存 + descarga.
  // Requiere que TÚ inicies sesión una vez en él (`BaiduPCS-Go login`): la app
  // nunca ve tu BDUSS ni tu STOKEN.
  { id: "aliyunpan", exe: "aliyunpan.exe", alt: ["aliyunpan-cli.exe"], bin: "aliyunpan", role: "Aliyun Pan (necesita tu cuenta)", versionArgs: ["--version"], optional: true },
  { id: "baidupcs", exe: "BaiduPCS-Go.exe", alt: ["baidupcs-go.exe", "BaiduPCS-Go"], bin: "BaiduPCS-Go", role: "Baidu Pan (necesita tu cuenta)", versionArgs: ["--version"], optional: true },
];

// Nombres de archivo permitidos para cada motor (whitelist estricta)
const allowedNames = (def: EngineDef): string[] => [def.exe, def.bin, ...def.alt].map((n) => n.toLowerCase());

export type Health = "ok" | "warn" | "down";
export interface EngineStatus {
  id: EngineId;
  exe: string;
  role: string;
  optional: boolean;
  path: string | null;
  version: string | null;
  health: Health;
  note: string;
  /** Carpeta vendor que se está usando de verdad. */
  vendorEfectivo?: string;
  /** La que dice config.json (puede estar obsoleta si moviste la carpeta). */
  vendorConfigurado?: string;
  /** ¿La configurada existe en disco? */
  vendorConfiguradoExiste?: boolean;
}

const g = globalThis as unknown as { __lyEngines?: EngineStatus[]; __lyMock?: boolean };
// Modo mock para tests/CI: nunca se lanzan ejecutables reales
export const MOCK = process.env.LINYUE_MOCK_ENGINES === "1";

// ── Búsqueda en PATH sin lanzar procesos ─────────────────────────────────────
// Antes se hacía spawnSync("where", …) por cada alias: un subproceso SÍNCRONO
// con hasta 3 s de espera que bloqueaba el event loop en cada resolución de
// motor. Ahora se recorre PATH en JS puro (milisegundos, sin bloquear nada).
let pathDirs: string[] | null = null;
function inPath(names: string[]): string | null {
  if (!pathDirs) {
    pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    // Windows resuelve también contra el directorio actual.
    if (process.platform === "win32") pathDirs.push(process.cwd());
  }
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase())
    : [""];
  for (const name of names) {
    // Un nombre con extensión se prueba tal cual; sin ella, con cada PATHEXT.
    const bases = /\.[a-z0-9]+$/i.test(name) ? [name.toLowerCase()] : exts.map((e) => name.toLowerCase() + e);
    for (const dir of pathDirs) {
      for (const base of bases) {
        const full = path.join(dir, base);
        try { if (fs.existsSync(full)) return full; } catch {}
      }
    }
  }
  return null;
}

/**
 * La carpeta `vendor` que viene CON el programa (junto a la app).
 *
 * Es el respaldo cuando `config.json` apunta a una carpeta que ya no existe:
 * pasa siempre que descomprimes un ZIP nuevo en otro sitio — el ajuste guardado
 * sigue apuntando al viejo y TODOS los binarios parecen desaparecer.
 */
export function vendorDelPrograma(): string {
  for (const base of [process.cwd(), path.join(process.cwd(), "..")]) {
    const p = path.resolve(base, "vendor");
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return path.resolve(process.cwd(), "vendor");
}

/** Carpetas donde se buscan los binarios, en orden: primero la tuya. */
export function carpetasVendor(): string[] {
  const cfg = getConfig();
  return [...new Set([cfg.vendorDir, vendorDelPrograma()].filter(Boolean).map((d) => path.resolve(d)))];
}

/** La carpeta que se está usando de verdad: la primera que EXISTE. */
export function vendorEfectivo(): string {
  for (const d of carpetasVendor()) {
    try { if (fs.existsSync(d)) return d; } catch {}
  }
  return vendorDelPrograma();
}

export function resolveEngine(id: EngineId): string | null {
  const def = ENGINES.find((e) => e.id === id);
  if (!def) return null; // fuera de whitelist
  const cfg = getConfig();
  const names = allowedNames(def);
  const custom = cfg.enginePaths[id];
  // Ruta propia → carpeta configurada → carpeta del programa. Sin el último
  // paso, mover la app de sitio dejaba el inventario entero en rojo.
  const candidates = [custom, ...carpetasVendor().flatMap((dir) => names.map((n) => path.join(dir, n)))].filter(Boolean) as string[];
  for (const c of candidates) {
    const abs = path.resolve(c);
    // El nombre de archivo debe coincidir con la whitelist (evita apuntar a cualquier binario)
    const base = path.basename(abs).toLowerCase();
    if (!names.includes(base)) continue;
    if (fs.existsSync(abs)) return abs;
  }
  return inPath(names);
}

/**
 * Tiempo máximo para el sondeo informativo de `--version`.
 * Los binarios son PyInstaller de 40–95 MB: en frío, y con el disco ocupado,
 * tardan varios segundos en arrancar. 6 s era demasiado justo y marcaba
 * motores sanos (yt-dlp) como caídos, lo que desactivaba la vista previa.
 */
const VERSION_TIMEOUT_MS = 25000;

/** Mata el proceso Y sus hijos (PyInstaller deja descendientes en Windows). */
function killProc(p: ChildProcess) {
  if (!p.pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { shell: false, windowsHide: true });
    else process.kill(-p.pid, "SIGKILL");
  } catch {
    try { p.kill("SIGKILL"); } catch {}
  }
}

function probeVersion(def: EngineDef, bin: string): Promise<{ version: string | null; detail: string }> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    let p: ChildProcess;
    let t: NodeJS.Timeout | undefined;
    const done = (v: { version: string | null; detail: string }) => {
      if (settled) return;
      settled = true;
      if (t) clearTimeout(t);
      resolve(v);
    };
    try {
      // `windowsHide` evita el parpadeo de consola; `shell:false` evita inyección.
      p = spawn(bin, def.versionArgs, { shell: false, windowsHide: true });
    } catch {
      return done({ version: null, detail: "no se pudo lanzar" });
    }
    t = setTimeout(() => {
      // `p.kill()` sólo mata al padre: estos binarios son PyInstaller y dejan
      // hijos (sobre todo en Windows). Se mata el árbol completo.
      killProc(p);
      done({ version: null, detail: `no respondió en ${VERSION_TIMEOUT_MS / 1000} s` });
    }, VERSION_TIMEOUT_MS);
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (err += d)); // se consume siempre: un stderr lleno bloquea al hijo
    p.on("error", (e) => done({ version: null, detail: `no se pudo lanzar (${e.message})` }));
    p.on("close", (code) => {
      // La versión se lee SOLO de stdout. Un binario roto (p. ej. exiftool sin su
      // carpeta exiftool_files) escribe su error en stderr y antes ese texto se
      // tomaba como "versión", ensuciando el panel con basura.
      const line = out.split(/\r?\n/).find((l) => l.trim()) ?? "";
      const m = line.match(/(\d+[\w.\-]*\d)/);
      if (m) return done({ version: m[1], detail: "" });
      if (code === 0) return done({ version: line.trim().slice(0, 40) || null, detail: "" });
      const primera = err.split(/\r?\n/).find((l) => l.trim()) ?? "";
      done({ version: null, detail: primera.trim().slice(0, 120) || `salió con código ${code}` });
    });
  });
}

async function probeOne(def: EngineDef): Promise<EngineStatus> {
  const base = { id: def.id, exe: def.exe, role: def.role, optional: !!def.optional };
  if (MOCK) return { ...base, path: `/mock/${def.exe}`, version: "mock-1.0", health: "ok", note: "mock" };
  const bin = resolveEngine(def.id);
  if (!bin) {
    // Tres casos MUY distintos que antes se veían igual («No encontrado»):
    //  · una ruta personalizada guardada que ya no existe (el usuario la escribió),
    //  · un motor opcional que sencillamente no viene en el ZIP,
    //  · un motor obligatorio que falta (esto sí hay que arreglarlo).
    const propia = getConfig().enginePaths[def.id];
    if (propia && !fs.existsSync(propia)) {
      return { ...base, path: null, version: null, health: "warn", note: `tu ruta no existe: ${propia}` };
    }
    return { ...base, path: null, version: null, health: def.optional ? "warn" : "down",
      note: def.optional ? "no incluido (opcional)" : "No encontrado" };
  }
  // El .exe está pero no puede arrancar sin su carpeta (caso exiftool: el ZIP
  // trae el exe y NO la carpeta de Perl `exiftool_files`). Sin esto el panel
  // enseñaba un error de Perl de tres líneas que no explica nada.
  if (def.requiereCarpeta && !fs.existsSync(path.join(path.dirname(bin), def.requiereCarpeta))) {
    return { ...base, path: bin, version: null, health: "warn",
      note: `falta la carpeta ${def.requiereCarpeta} (junto al .exe): sin ella no arranca` };
  }
  const { version, detail } = await probeVersion(def, bin);
  // Si guardaste una ruta propia y no existe, se dice aunque el motor se haya
  // encontrado por otro lado: si no, esa ruta se queda ahí mintiendo para siempre.
  const propia = getConfig().enginePaths[def.id];
  const rutaFantasma = !!propia && !fs.existsSync(propia);
  const notaFantasma = rutaFantasma ? `tu ruta no existe; se usa ${path.basename(bin)}` : "";
  return {
    ...base,
    path: bin,
    version,
    // Encontrado pero sin versión = sigue siendo usable; solo es un aviso.
    health: version && !rutaFantasma ? "ok" : "warn",
    note: version ? (notaFantasma || "Listo") : `sin versión: ${detail || "no responde con " + def.versionArgs.join(" ")}`,
  };
}

/**
 * Actualización de motores que SABEN actualizarse solos.
 *
 * Es la mejora más rentable a largo plazo: yt-dlp se rompe cada pocas semanas
 * cuando un sitio cambia, y el usuario acaba con "Unsupported URL" sin saber que
 * su binario tiene seis meses. Aquí no se adivina: se ejecutan los comandos
 * oficiales de cada herramienta, uno detrás de otro (nunca a la vez: tres
 * descargas simultáneas en el mismo disco se estorban).
 *
 * Solo comandos de una LISTA BLANCA fija. Nada de ejecutar texto del usuario.
 */
const AUTO_UPDATE: { id: EngineId; args: string[] }[] = [
  { id: "yt-dlp", args: ["-U"] },
  { id: "gallerydl", args: ["--update"] },
  { id: "baidupcs", args: ["update"] },
  { id: "deno", args: ["upgrade"] },
];

export interface UpdateResult { id: EngineId; ok: boolean; msg: string; version?: string | null }

function ejecutar(bin: string, args: string[], timeoutMs = 180000): Promise<{ code: number; salida: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true });
    let salida = "";
    const cap = (d: Buffer) => { if (salida.length < 4000) salida += d.toString(); };
    p.stdout.on("data", cap);
    p.stderr.on("data", cap);
    const t = setTimeout(() => { try { p.kill(); } catch { /* ya murió */ } }, timeoutMs);
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? -1, salida }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: -1, salida: e.message }); });
  });
}

export async function updateEngines(): Promise<UpdateResult[]> {
  if (MOCK) return AUTO_UPDATE.map((u) => ({ id: u.id, ok: true, msg: "simulado (modo demo)" }));
  const res: UpdateResult[] = [];
  for (const u of AUTO_UPDATE) {
    const bin = resolveEngine(u.id);
    if (!bin) continue;
    const { code, salida } = await ejecutar(bin, u.args);
    const limpio = salida.replace(/\s+/g, " ").trim().slice(0, 220);
    // yt-dlp y compañía devuelven 0 aunque "ya está actualizado"; el mensaje
    // real (en inglés) es lo útil, así que se muestra tal cual.
    res.push({ id: u.id, ok: code === 0, msg: limpio || `código ${code}`, });
  }
  // Un único rescaneo al final para refrescar versiones en el panel.
  await scanEngines();
  const estado = await getEngines();
  for (const r of res) r.version = estado.find((e) => e.id === r.id)?.version ?? null;
  return res;
}

/**
 * Sondeo por LOTES, no los 12 a la vez.
 * Lanzarlos todos en paralelo saturaba CPU y disco (varios pesan 40–95 MB),
 * y los últimos en arrancar agotaban su timeout y se daban por muertos sin
 * serlo. Con lotes de 4 la medición es fiable y además tarda menos.
 */
const PROBE_BATCH = 4;
/**
 * Un solo escaneo a la vez. Antes, si dos pestañas pulsaban «Re-escanear» (o una
 * lo pulsaba mientras un job disparaba su propio escaneo) se lanzaban DOS
 * tandas de 12 binarios de 40–95 MB en paralelo: el disco se saturaba, los
 * `--version` agotaban su timeout y motores sanos aparecían en ámbar.
 */
let scanning: Promise<EngineStatus[]> | null = null;
export async function scanEngines(): Promise<EngineStatus[]> {
  if (scanning) return scanning;
  scanning = (async () => {
    const res: EngineStatus[] = [];
    for (let i = 0; i < ENGINES.length; i += PROBE_BATCH) {
      res.push(...(await Promise.all(ENGINES.slice(i, i + PROBE_BATCH).map(probeOne))));
    }
    // Se anota en cada estado cuál es la carpeta efectiva, para que la UI pueda
    // avisar de que el ajuste guardado apunta a otro sitio.
    const cfg = getConfig();
    const efectiva = vendorEfectivo();
    let existe = false;
    try { existe = fs.existsSync(cfg.vendorDir); } catch {}
    for (const e of res) { e.vendorEfectivo = efectiva; e.vendorConfigurado = cfg.vendorDir; e.vendorConfiguradoExiste = existe; }
    g.__lyEngines = res;
    return res;
  })();
  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

export async function getEngines(): Promise<EngineStatus[]> {
  return g.__lyEngines ?? (await scanEngines());
}

/**
 * ¿Podemos usar este motor?
 * Basta con que el binario EXISTA: el sondeo de `--version` es informativo y
 * puede expirar por contención aunque el ejecutable funcione perfectamente.
 * Antes se exigía `health === "ok"`, así que un timeout pasajero dejaba la
 * vista previa desactivada el resto de la sesión.
 */
export function isHealthy(id: EngineId): boolean {
  const e = g.__lyEngines?.find((x) => x.id === id);
  if (!e) return false; // nadie escaneó todavía: no afirmamos que esté sano
  return e.health !== "down" && !!e.path;
}
