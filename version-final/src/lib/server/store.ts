// Persistencia 100% local: config.json, history.json, archives por modo y cookies
// en la carpeta de datos del usuario.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const DATA_DIR = process.env.LINYUE_DATA || path.join(os.homedir(), ".linyue");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
export const COOKIES_DIR = path.join(DATA_DIR, "cookies");
/**
 * Carpeta para descargas parciales e intermedios (`.part`, el archivo original
 * que yt-dlp baja antes de extraer el audio, etc.). Se mantiene FUERA de la
 * carpeta de salida a propósito: ver `tempDir` en `buildArgs`.
 */
export const TEMP_DIR = path.join(DATA_DIR, "tmp");

// Esquema de configuración validado con Zod
export const ConfigSchema = z.object({
  outputDir: z.string().min(1).max(500),
  vendorDir: z.string().min(1).max(500),
  enginePaths: z.record(z.string(), z.string().max(500)).default({}),
  audioFormat: z.enum(["m4a", "mp3", "flac", "wav", "opus", "aac", "vorbis"]),
  videoFormat: z.enum(["mp4", "mkv", "webm"]),
  videoQuality: z.enum(["best", "4320", "2160", "1440", "1080", "720", "480"]),
  photoFormat: z.enum(["original", "webp", "jpg"]),
  concurrency: z.number().int().min(1).max(8),
  turbo: z.boolean(),
noRepeat: z.boolean(),
  embedMetadata: z.boolean(),
  profileLimit: z.number().int().min(1).max(5000),
  altEngineCN: z.boolean(),
});
export type Config = z.infer<typeof ConfigSchema>;

export const defaultConfig = (): Config => ({
  outputDir: path.join(os.homedir(), "Downloads", "Linyue"),
  // `process.cwd()` es frágil: si el servidor se lanza desde otra carpeta, deja
  // de encontrar los motores. Se prueban varias raíces hasta dar con una que
  // tenga `vendor/`, y como último recurso se cae al cwd.
  vendorDir: defaultVendorDir(),
  enginePaths: {},
  audioFormat: "mp3",
  videoFormat: "mp4",
  videoQuality: "1080",
  photoFormat: "original",
  concurrency: 2,
turbo: true,
  noRepeat: true,
  embedMetadata: true,
  profileLimit: 50,
  altEngineCN: false,
});

/** Primera carpeta `vendor` que exista entre las raíces candidatas. */
function defaultVendorDir(): string {
  const candidatos = [
    process.cwd(),
    path.join(process.cwd(), ".."),
    // Junto al ejecutable del servidor (.next está dentro del proyecto)
    path.join(__dirname, "..", "..", ".."),
  ];
  for (const base of candidatos) {
    const p = path.resolve(base, "vendor");
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return path.resolve(process.cwd(), "vendor");
}

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Sleep síncrono corto (Atomics.wait no bloquea el event loop de forma indebida
// en Node y nos permite reintentar sin volver la escritura asíncrona).
function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Escritura atómica: archivo temporal único + rename con reintentos.
// Windows devuelve EPERM/EBUSY si otro proceso (antivirus, worker de Next)
// tiene el destino abierto o si dos escrituras chocan en el mismo .tmp:
// se reintenta y, como último recurso, se copia encima (no atómico pero
// preferible a perder la entrada del historial).
function atomicWrite(file: string, contents: string) {
  ensure();
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, contents);
  const codes = new Set(["EPERM", "EBUSY", "EACCES", "ENOENT"]);
  let lastErr: unknown;
  for (let intento = 0; intento < 5; intento++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException)?.code;
      if (!codes.has(code ?? "")) break;
      sleepSync(30 * (intento + 1));
    }
  }
  // Fallback: copiar encima y limpiar el temporal.
  try {
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    throw lastErr;
  }
}

function writeJSON(file: string, data: unknown) {
  atomicWrite(file, JSON.stringify(data, null, 2));
}

export function getConfig(): Config {
  ensure();
  const parsed = ConfigSchema.safeParse({ ...defaultConfig(), ...readJSON(CONFIG_FILE, {}) });
  return parsed.success ? parsed.data : defaultConfig();
}
export function saveConfig(c: Config) {
  writeJSON(CONFIG_FILE, c);
}
export function resetConfig() {
  writeJSON(CONFIG_FILE, defaultConfig());
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  author: string;
  date: string;
  source: string;
  format: string;
  size: number;
  duration: number;
  path: string;
  thumbnail: string;
  engine: string;
  mode: string;
  createdAt: number;
  /** id del vídeo dentro de la URL (para reconciliar el archive de yt-dlp) */
  videoId?: string;
}

export function getHistory(): HistoryItem[] {
  return readJSON<HistoryItem[]>(HISTORY_FILE, []);
}
export function addHistory(item: HistoryItem) {
  const h = getHistory();
  const n = normalizeUrl(item.url);
  // Si esta misma URL ya estaba pero el archivo ya no está en el disco, olvida
  // la entrada muerta: si no, el historial se llenaría de fantasmas cada vez
  // que vuelves a bajar algo que borraste.
  const vivo = h.filter((x) => !(normalizeUrl(x.url) === n && !isLiveFile(x)));
  vivo.unshift(item);
  writeJSON(HISTORY_FILE, vivo.slice(0, 5000));
}
export function removeHistory(id: string) {
  writeJSON(HISTORY_FILE, getHistory().filter((h) => h.id !== id));
}

/** El archivo de esta entrada sigue realmente en el disco (y es un archivo). */
export function isLiveFile(h: HistoryItem): boolean {
  try {
    return fs.statSync(h.path).isFile();
  } catch {
    return false;
  }
}

/** Entradas del historial para esta URL. */
export function historyFor(url: string): HistoryItem[] {
  const n = normalizeUrl(url);
  return getHistory().filter((h) => normalizeUrl(h.url) === n);
}

// Dedup: ¿ya está este link en el historial Y su archivo sigue en el disco?
// Si borras el archivo, esto devuelve false y vuelve a descargarlo (ese era el
// bug: se fiaba solo de la URL y el "ya descargado" sobrevivía al borrado).
export function inHistory(url: string, mode?: string): boolean {
  return historyFor(url).some((h) => (!mode || h.mode === mode) && isLiveFile(h));
}

// Archive POR MODO: así bajar el audio no "gasta" el id e impide luego bajar el
// vídeo del mismo link (compartían un único archive.txt).
export function archiveFileFor(mode: string): string {
  return path.join(DATA_DIR, `archive-${mode}.txt`);
}

/**
 * Reconcilia el archive DE UN MODO con el historial: borra las líneas cuyo
 * vídeo ya no tiene ningún archivo en disco, para que yt-dlp vuelva a bajarlo.
 *
 * Sin esto el dedup de yt-dlp (`--download-archive`) bloquea en silencio: si
 * borras el archivo, el historial deja de darlo por bajado… pero el archive
 * sigue teniendo el id, así que yt-dlp lo salta y el trabajo "termina bien"
 * sin haber descargado nada.
 *
 * Las líneas de ids que no conocemos se conservan (no se arriesga un salto).
 */
export function reconcileArchiveFor(mode: string): { conservadas: number; borradas: number } {
  const file = archiveFileFor(mode);
  let texto: string;
  try {
    texto = fs.readFileSync(file, "utf8");
  } catch {
    return { conservadas: 0, borradas: 0 };
  }
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return { conservadas: 0, borradas: 0 };
  const vivos = new Set<string>();
  const muertos = new Set<string>();
  for (const h of getHistory()) {
    if (!h.videoId || h.mode !== mode) continue;
    (isLiveFile(h) ? vivos : muertos).add(h.videoId);
  }
  if (!muertos.size) return { conservadas: lineas.length, borradas: 0 };
  const conservadas = lineas.filter((l) => {
    const id = l.trim().split(/\s+/).pop() ?? "";
    return muertos.has(id) && !vivos.has(id) ? false : true;
  });
  if (conservadas.length !== lineas.length) {
    try {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, conservadas.join("\n") + "\n");
      fs.renameSync(tmp, file);
    } catch {}
  }
  return { conservadas: conservadas.length, borradas: lineas.length - conservadas.length };
}
export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "si", "feature"].forEach((k) => x.searchParams.delete(k));
    return (x.host.replace(/^www\.|^m\./, "") + x.pathname.replace(/\/$/, "") + x.search).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

// Cuenta de archivos en la carpeta de salida actual (para el microcopy del hero)
export function countOutputFiles(dir: string): number {
  try {
    let n = 0;
    const walk = (d: string, depth: number) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isFile() && !e.name.endsWith(".part")) n++;
        else if (e.isDirectory() && depth < 3) walk(path.join(d, e.name), depth + 1);
      }
    };
    walk(dir, 0);
    return n;
  } catch {
    return 0;
  }
}

export function cookieFile(site: string) {
  ensure();
  return path.join(COOKIES_DIR, `${site}.txt`);
}
