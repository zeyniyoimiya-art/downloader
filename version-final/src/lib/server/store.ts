// Persistencia 100% local: config.json, history.json, archives por modo y cookies
// en la carpeta de datos del usuario.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * Id corto y seguro para trabajos e historial.
 *
 * Antes: `Math.random().toString(36).slice(2, 10)`. Ese truco puede devolver
 * MENOS de 8 caracteres (p. ej. 0.5 → "0.i" → "i"), así que dos trabajos
 * podían acabar con el mismo id y las rutas `/api/jobs/[id]` (que validan
 * /^[a-z0-9]{1,12}$/) empezaban a actuar sobre el trabajo equivocado.
 */
export function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

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
// ── Carpeta de salida: se rechazan carpetas de sistema ──────────────────────
// Un dedo torpe (o, antes del parche de guard.ts, una web maliciosa) podía poner
// outputDir = "C:\Windows\System32" y llenar el sistema de .mkv. Se exige ruta
// absoluta y se veta la lista de sitios donde escribir es tirar la casa abajo.
const SISTEMA = /(?:^|\\)(windows|system32|syswow64|program files(?: \\(x86\\))?|programdata|\$recycle\.bin|winre)(?:\\|$)/i;
const outputDirT = z
  .string()
  .min(1)
  .max(500)
  .refine((v) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(v.trim()), "Debe ser una ruta absoluta (C:\\... o /home/...)")
  .refine((v) => !SISTEMA.test(v.replace(/\//g, "\\")), "Esa es una carpeta del sistema: elige otra");

// ── Proxy ────────────────────────────────────────────────────────────────────
// Solo esquemas conocidos y sin credenciales embebidas en la URL pública: un
// proxy con `usuario:clave@` acabaría en el log de un trabajo y en el historial.
// Si necesitas auth, usa un proxy local (Clash/v2ray) sin credenciales expuestas.
const proxyT = z.string().max(200).refine(
  // Puerto real (1–65535): un `:99999` no es un proxy, es una errata que
  // después se convierte en un timeout de 30 s sin explicación.
  (v) => v.trim() === "" || /^(https?|socks[45]?):\/\/[^\s@/:]+(:(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5]))?(\/\S*)?$/i.test(v.trim()),
  "Proxy inválido: usa http://host:puerto o socks5://host:puerto (sin usuario@ en la URL)"
).refine((v) => !/@/.test(v), "No pongas usuario:contraseña en la URL del proxy");

// ── Rango de lista ───────────────────────────────────────────────────────────
// Se valida en el servidor porque acaba como argumento de un proceso:
// "--playlist-items 1-20" sí, "--playlist-items $(rm -rf)" jamás.
const rangoT = z.string().max(120).refine(
  (v) => v.trim() === "" || /^-?\d{1,5}(-\d{1,5})?(,-?\d{1,5}(-\d{1,5})?)*$/.test(v.trim()),
  'Rango inválido: usa "1-20", "-10", "5" o "1,3,7-9"'
);

// Hora "HH:MM" (24 h). Se valida con la misma función que usa el programador,
// para que no exista el caso "el ajuste dice 25:99 y la cola no arranca nunca".
const horaT = z.string().max(5).refine((v) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim()), "Hora inválida: usa HH:MM (00:00–23:59)");

export const ConfigSchema = z.object({
  outputDir: outputDirT,
  vendorDir: z.string().min(1).max(500),
  enginePaths: z.record(z.string(), z.string().max(500)).default({}),
  audioFormat: z.enum(["best", "m4a", "mp3", "flac", "wav", "opus", "aac", "vorbis", "alac", "aiff", "ac3", "eac3", "dts", "mp2"]),
  videoFormat: z.enum(["mp4", "mkv", "webm", "mov", "m4v", "ts", "avi", "flv", "ogv"]),
  videoQuality: z.enum(["best", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144"]),
  photoFormat: z.enum(["original", "webp", "jpg", "png", "avif"]),
  /** 0 = SIN LÍMITE (tantas descargas como trabajos en cola). */
  concurrency: z.number().int().min(0).max(64),
  /** Freno de seguridad: tope duro aunque concurrency sea 0. */
  maxConcurrency: z.number().int().min(1).max(64),
  /** Política ante "FLAC desde AAC": estricto | avisar | libre */
  fidelity: z.enum(["estricto", "avisar", "libre"]),
  turbo: z.boolean(),
noRepeat: z.boolean(),
  embedMetadata: z.boolean(),
  profileLimit: z.number().int().min(1).max(5000),
  altEngineCN: z.boolean(),
  // ── Red / rate limit ──
  /** "chrome", "firefox", "edge"… o "" para no leer cookies del navegador. */
  cookiesFromBrowser: z.string().max(60),
  /** Navegador a suplantar en TLS (necesita curl_cffi). "" = desactivado. */
  impersonate: z.string().max(30),
  /** Límite de velocidad por trabajo: "500K", "4M", "" = sin límite. */
  limitRate: z.string().max(12),
  /** Reintentos internos del motor. */
  retries: z.number().int().min(0).max(10),
  /** Segundos de espera entre peticiones al mismo dominio (0 = ninguno). */
  sleepRequests: z.number().min(0).max(10),
  /** Peticiones por minuto y host en la cola (0 = sin límite propio). */
  ratePerMinute: z.number().int().min(0).max(600),
  /** Sondas de vista previa simultáneas. */
  probeConcurrency: z.number().int().min(1).max(8),
  /** Calidad de audio para códecs con pérdida: "" auto, "320K", "0"…"9". */
  audioQuality: z.string().max(8),
  // ── Códecs y pistas (fase 5) ──
  /** Códec de vídeo preferido. "auto" = el mejor que sirva el sitio. */
  videoCodec: z.enum(["auto", "h264", "h265", "av1", "vp9", "vp8", "mpeg4", "prores", "theora"]),
  /** Subtítulos: off | sidecar (.srt aparte) | embed (dentro del archivo). */
  subtitles: z.enum(["off", "sidecar", "embed"]),
  /** Idiomas de subtítulos: "es,en" o "all". */
  subLangs: z.string().max(120),
  /** Incluir subtítulos automáticos cuando el sitio no tiene oficiales. */
  autoSubs: z.boolean(),
  /** Incrustar capítulos en el archivo. */
  chapters: z.boolean(),
  /** Incrustar la miniatura como carátula. */
  embedThumbnail: z.boolean(),
  /** Al convertir un audio, conservar el archivo original. */
  keepOriginal: z.boolean(),
  /** Recodificar el vídeo si el sitio no sirve el códec pedido (lento). */
  reencodeVideo: z.boolean(),
  /** Carpeta de tu nube de Baidu donde se transfieren los recursos (转存). */
  baiduDir: z.string().max(200),
  // ── Red avanzada, listas y nombres (fase 7) ──
  /** Proxy para TODOS los motores: "http://127.0.0.1:7890", "socks5://…". "" = directo. */
  proxy: proxyT,
  /** Rango de elementos de una lista/perfil: "", "1-20", "-10", "1,3,7-9". */
  playlistRange: rangoT,
  /** Cómo se nombran las carpetas y archivos. */
  naming: z.enum(["ordenado", "compacto", "plano", "fecha"]),
  /** Pedir a yt-dlp que archive también los vídeos ya vistos en la lista. */
  abortOnDiskFull: z.boolean(),
  /** Ventana "solo descargar de noche": los trabajos nuevos esperan. */
  quietEnabled: z.boolean(),
  quietFrom: horaT,
  quietTo: horaT,
  // ── Recortes (fase 9) ──
  /** SponsorBlock: off | marcar | quitar. */
  sponsorblock: z.enum(["off", "marcar", "quitar"]),
  /** Recorte por tiempo: "1:00-2:30" (varias separadas por comas). Vacío = todo. */
  sections: z.string().max(240),
  /** Un archivo por capítulo. */
  splitChapters: z.boolean(),
  // ── Sistema y suscripciones (fase 9) ──
  /** Aviso del sistema (toast de Windows) al terminar la cola. */
  notify: z.boolean(),
  /** Apagar el equipo cuando la cola quede vacía (con 60 s para cancelar). */
  apagarAlTerminar: z.boolean(),
  /** Revisar los canales suscritos automáticamente. */
  subsEnabled: z.boolean(),
  /** Cada cuántas horas se revisan (1–168). */
  subsEveryHours: z.number().int().min(1).max(168),
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
  concurrency: 0,      // sin límite por defecto (ver maxConcurrency)
  maxConcurrency: 24,  // freno de seguridad del sistema
  fidelity: "estricto",
turbo: true,
  noRepeat: true,
  embedMetadata: true,
  profileLimit: 50,
  altEngineCN: false,
  cookiesFromBrowser: "",
  impersonate: "",
  limitRate: "",
  retries: 3,
  sleepRequests: 0,
  ratePerMinute: 0,
  probeConcurrency: 3,
  audioQuality: "",
  videoCodec: "auto",
  subtitles: "off",
  subLangs: "es,en",
  autoSubs: false,
  chapters: true,
  embedThumbnail: true,
  keepOriginal: false,
  reencodeVideo: false,
  baiduDir: "/我的资源",
  proxy: "",
  playlistRange: "",
  naming: "ordenado",
  abortOnDiskFull: true,
  quietEnabled: false,
  quietFrom: "01:00",
  quietTo: "07:00",
  sponsorblock: "off",
  sections: "",
  splitChapters: false,
  notify: false,
  apagarAlTerminar: false,
  // Activo por defecto: si guardas un canal es porque quieres que se revise.
  // El interruptor de Ajustes existe para apagarlo del todo (viaje, datos…).
  subsEnabled: true,
  subsEveryHours: 6,
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

/**
 * Caché de config con invalidación por mtime.
 *
 * `getConfig()` se llama en cada pump de la cola, en cada job y en casi todas
 * las rutas: eran lecturas SÍNCRONAS de disco (readFileSync + JSON.parse +
 * validación Zod) decenas de veces por segundo durante una descarga. Con esto
 * se lee una vez y se revalida con un `statSync` barato; si otra pestaña o el
 * editor cambian config.json, el mtime cambia y se recarga sola.
 */
let cfgCache: { mtime: number; cfg: Config } | null = null;

export function getConfig(): Config {
  ensure();
  let mtime = 0;
  try { mtime = fs.statSync(CONFIG_FILE).mtimeMs; } catch {}
  if (cfgCache && cfgCache.mtime === mtime) return cfgCache.cfg;
  const parsed = ConfigSchema.safeParse({ ...defaultConfig(), ...readJSON(CONFIG_FILE, {}) });
  const cfg = parsed.success ? parsed.data : defaultConfig();
  cfgCache = { mtime, cfg };
  return cfg;
}
export function saveConfig(c: Config) {
  writeJSON(CONFIG_FILE, c);
  cfgCache = null;
}
export function resetConfig() {
  writeJSON(CONFIG_FILE, defaultConfig());
  cfgCache = null;
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

// Caché del historial (mismo criterio que la config): antes CADA consulta a
// /api/history, cada enqueue y cada guardado volvía a leer y parsear el JSON
// entero —hasta 5000 entradas— de forma síncrona.
let histCache: { mtime: number; items: HistoryItem[] } | null = null;

export function getHistory(): HistoryItem[] {
  let mtime = 0;
  try { mtime = fs.statSync(HISTORY_FILE).mtimeMs; } catch {}
  if (histCache && histCache.mtime === mtime) return histCache.items;
  const items = readJSON<HistoryItem[]>(HISTORY_FILE, []);
  histCache = { mtime, items };
  return items;
}
export function addHistory(item: HistoryItem) {
  const h = getHistory();
  const n = normalizeUrl(item.url);
  // Si esta misma URL ya estaba pero el archivo ya no está en el disco, olvida
  // la entrada muerta: si no, el historial se llenaría de fantasmas cada vez
  // que vuelves a bajar algo que borraste.
  //
  // OJO al orden de las condiciones: primero se descarta por URL (barato) y
  // solo se toca el disco (`isLiveFile`) para las entradas de ESA url. Antes se
  // hacía `!isLiveFile(x)` para las 5000 entradas → 5000 statSync por archivo
  // descargado.
  const vivo = h.filter((x) => normalizeUrl(x.url) !== n || isLiveFile(x));
  vivo.unshift(item);
  const recortado = vivo.slice(0, 5000);
  writeJSON(HISTORY_FILE, recortado);
  histCache = null;
}
export function removeHistory(id: string) {
  writeJSON(HISTORY_FILE, getHistory().filter((h) => h.id !== id));
  histCache = null;
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
