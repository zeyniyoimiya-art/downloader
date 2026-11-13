// Construcción de argumentos por motor/modo/formato. Siempre devuelve arrays (nunca strings para shell).
import { AUDIO_FORMATS, VIDEO_FORMATS, type Detected, type EngineId, type Mode } from "./platforms";
import { audioTarget, resolveContainer, videoSelector, type VideoCodec } from "./codecs";
// Se reexportan para que jobs.ts tenga un único punto de entrada.
export { audioTarget, ffmpegAudioArgs, ffmpegVideoArgs, videoSelector, resolveContainer } from "./codecs";
export type { VideoCodec } from "./codecs";

export interface ArgOptions {
  mode: Mode;
  format: string;
  quality: string;
  outputDir: string;
  turbo: boolean;
  aria2Healthy: boolean;
  noRepeat: boolean;
  embedMetadata: boolean;
  archiveFile: string;
  profileLimit: number;
  cookies?: string | null;
  ffmpegDir?: string | null;
  /**
   * Ruta COMPLETA al binario de ffmpeg (no la carpeta).
   * yt-dlp acepta la carpeta con `--ffmpeg-location`, pero spotdl exige el
   * ejecutable (`--ffmpeg C:\...\ffmpeg.exe`); pasarle la carpeta hace que
   * spotdl no lo encuentre y aborte la descarga entera.
   */
  ffmpegPath?: string | null;
  /**
   * Carpeta para parciales e intermedios. Imprescindible para que bajar el
   * audio de algo que ya bajaste como vídeo no destruya el vídeo (ver abajo).
   */
  tempDir?: string | null;
  // ── Cookies desde navegador (la vía que funciona cuando el 429/403 es por sesión) ──
  /** "chrome", "firefox", "edge", "brave", "opera", "vivaldi", "chromium", "safari"
   *  o "chrome:Profile 2". Se traduce a --cookies-from-browser. */
  cookiesFromBrowser?: string | null;
  // ── Control de ritmo (rate limit) ──
  /** "4M" para 4 MiB/s. Vacío = sin límite. */
  limitRate?: string | null;
  /** Segundos de espera entre peticiones del mismo dominio. */
  sleepRequests?: number | null;
  /** Reintentos internos del motor. */
  retries?: number | null;
  /** Códec de vídeo preferido ("auto" = el mejor del sitio). */
  videoCodec?: VideoCodec;
  /** off | sidecar | embed */
  subtitles?: "off" | "sidecar" | "embed";
  subLangs?: string;
  autoSubs?: boolean;
  chapters?: boolean;
  embedThumbnail?: boolean;
  /** true = el audio pedido necesita conversión con ffmpeg después. */
  audioPost?: boolean;
  /** Plantilla de nombres: ordenado | compacto | plano | fecha. */
  naming?: string;
  /** Proxy global (http://host:puerto, socks5://…). */
  proxy?: string | null;
  /** Rango de elementos de una lista. */
  playlistRange?: string | null;
  /** Ruta remota en tu 阿里云盘 (la deja el `share` previo). */
  aliyunRemote?: string;
  /** Ruta remota en tu nube de Baidu (la deja la transferencia previa). */
  baiduRemote?: string;
  /** Código 提取码 del recurso compartido. */
  baiduPwd?: string;
  /** Cookies ya en formato "nombre=valor" (streamlink). */
  cookiePairs?: string[];
  /** Navegador a suplantar (necesita curl_cffi instalado): "chrome", "safari"… */
  impersonate?: string | null;
  /** Calidad de audio para códecs con pérdida: 0 (mejor) … 9, o "320K". */
  audioQuality?: string | null;
}

// Sanitiza un argumento: sin saltos de línea ni NUL; y nunca permite que un link se interprete como opción
export function sanitizeArg(a: string): string {
  return a.replace(/[\r\n\0]/g, "");
}
export function safeUrlArg(url: string): string {
  const s = sanitizeArg(url.trim());
  if (s.startsWith("-")) throw new Error("URL inválida");
  return s;
}

const OUT_TPL = "%(uploader,channel,creator|Desconocido)s/%(title).150B [%(id)s].%(ext)s";
/**
 * El audio va a su PROPIA subcarpeta, y no es solo por orden.
 *
 * Al extraer audio (`-x`), yt-dlp descarga el archivo ORIGEN con el nombre que
 * le tocaría al vídeo y, al acabar de convertir, lo BORRA
 * ("Deleting original file … .mp4"). En los sitios que sirven un único MP4 con
 * audio+vídeo dentro (TikTok, Instagram, Facebook, URLs directas…) ese origen
 * es EXACTAMENTE el archivo del vídeo: bajarlo en audio te borraba el vídeo que
 * ya tenías. Con carpeta propia la colisión es imposible.
 *
 * Se comprobó que `-P temp:` NO sirve para esto: yt-dlp descarga el origen en la
 * carpeta final, no en la temporal.
 */
const OUT_TPL_AUDIO = "%(uploader,channel,creator|Desconocido)s/Audio/%(title).150B [%(id)s].%(ext)s";

/**
 * Plantillas de nombre. `%(title).150B` corta por BYTES (no por caracteres): un
 * título chino de 150 caracteres son 450 bytes y en Windows se pasa del límite
 * de 260 de la ruta. El `.150B` lo evita.
 */
const PLANTILLAS: Record<string, { video: string; audio: string }> = {
  // Autor/Carpeta + título [id] — el que evita que dos vídeos con el mismo
  // título se pisen y agrupa por canal.
  ordenado: { video: OUT_TPL, audio: OUT_TPL_AUDIO },
  // Todo suelto en la carpeta, sin subcarpetas: ideal para móvil/USB.
  compacto: { video: "%(title).150B [%(id)s].%(ext)s", audio: "Audio/%(title).150B [%(id)s].%(ext)s" },
  // Solo el título (puede repetirse: se añade [id] si ya existe el archivo).
  plano: { video: "%(title).150B.%(ext)s", audio: "Audio/%(title).150B.%(ext)s" },
  // Orden cronológico dentro del canal: 2026-11-13 — título.
  fecha: {
    video: "%(uploader,channel,creator|Desconocido)s/%(upload_date>%Y-%m-%d,release_date>%Y-%m-%d|Sin fecha)s — %(title).120B [%(id)s].%(ext)s",
    audio: "%(uploader,channel,creator|Desconocido)s/Audio/%(upload_date>%Y-%m-%d,release_date>%Y-%m-%d|Sin fecha)s — %(title).120B [%(id)s].%(ext)s",
  },
};

/** Plantilla de salida para el motor. `naming` viene de Ajustes. */
export function plantillaSalida(naming = "ordenado", audio = false): string {
  const p = PLANTILLAS[naming] ?? PLANTILLAS.ordenado;
  return audio ? p.audio : p.video;
}

// Bilibili WAF rechaza el UA por defecto de yt-dlp ("No video formats
// found!"); con UA de navegador real sí devuelve formatos (verificado 2026-07).
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export function isBilibiliUrl(url: string): boolean {
  return /(?:^|\/\/|\.)((?:www|m)\.)?(bilibili\.com|b23\.tv)/i.test(url);
}
/**
 * ¿Es mala idea dejar que aria2c descargue esta URL?
 *
 * Comprobado en vivo (2026-10-09):
 *  - bilibili → aria2c sale con código 29
 *  - YouTube  → aria2c sale con código 22: su CDN rechaza sus peticiones porque
 *    no lleva las cabeceras/cookies que sí pone el descargador nativo, y
 *    **yt-dlp NO hace fallback solo**, así que la descarga se pierde entera.
 *
 * En estos casos se usa el descargador nativo de yt-dlp, que va sobrado.
 * (Aun así, `jobs.ts` reintenta sin turbo ante cualquier fallo de aria2c.)
 */
export function aria2Unsafe(url: string): boolean {
  return isBilibiliUrl(url) || /(?:^|\/\/|\.)((?:www|m|music)\.)?(youtube\.com|youtu\.be|googlevideo\.com)/i.test(url);
}
export function browserUAFor(url: string): string[] {
  return isBilibiliUrl(url) ? ["--user-agent", BROWSER_UA] : [];
}

/** ¿El destino de audio requiere el paso extra de ffmpeg? */
function audioNeedsFfmpegExport(t: { needsFfmpeg: boolean }): boolean {
  return t.needsFfmpeg;
}

export function buildArgs(engine: EngineId, d: Detected, o: ArgOptions): string[] {
  const url = safeUrlArg(d.url);
  const out = sanitizeArg(o.outputDir);
  switch (engine) {
case "yt-dlp": {
      // El modo y el formato NO siempre coinciden: «Perfil completo» ofrece mp3
      // y el modo foto usa jpg/webp. Quien decide si esto es audio es el FORMATO.
      const esAudio = (AUDIO_FORMATS as readonly string[]).includes(o.format);
      const esVideo = (VIDEO_FORMATS as readonly string[]).includes(o.format);
      const a = ["--newline", "--progress", "--no-colors", "--ignore-errors", "-P", out, "-o", plantillaSalida(o.naming, esAudio),
        "--print", "after_move:LYF|%(filepath)s"];
      // Los archivos parciales e INTERMEDIOS van a una carpeta aparte.
      // Sin esto: al extraer audio (-x) yt-dlp descarga el archivo original
      // COMPLETO usando el mismo template que el vídeo, o sea la MISMA ruta
      // (`…[id].mp4`). Si ya tenías ese vídeo, lo machaca y al convertir a mp3
      // lo BORRA: perdías el vídeo. Pasaba siempre en sitios que sirven un único
      // MP4 con audio+audio (TikTok, Instagram, Facebook, URLs directas).
      // De paso mantiene los `.part` fuera de la carpeta de salida.
      if (o.tempDir) a.push("-P", "temp:" + sanitizeArg(o.tempDir));
      if (o.embedMetadata) {
        a.push("--embed-metadata");
        // --embed-thumbnail solo en contenedores compatibles: yt-dlp FALLA si se
        // pide en wav/aac/webm ("Supported filetypes for thumbnail embedding are...")
        if (!["wav", "aac", "webm"].includes(o.format)) a.push("--embed-thumbnail", "--convert-thumbnails", "jpg");
      }
      if (o.ffmpegDir) a.push("--ffmpeg-location", sanitizeArg(o.ffmpegDir));
      if (o.noRepeat) a.push("--download-archive", sanitizeArg(o.archiveFile));
      if (o.cookies) a.push("--cookies", sanitizeArg(o.cookies));
      // Cookies directamente del navegador instalado: es la única forma que
      // funciona cuando el sitio exige sesión real (Instagram, X, YouTube con
      // "Sign in to confirm you're not a bot").
      if (o.cookiesFromBrowser) a.push("--cookies-from-browser", sanitizeArg(o.cookiesFromBrowser));
      // Proxy: imprescindible para sitios CN desde fuera y para salir de un 429.
      if (o.proxy) a.push("--proxy", sanitizeArg(o.proxy));
      // Suplantar la huella TLS de un navegador real (requiere curl_cffi).
      if (o.impersonate) a.push("--impersonate", sanitizeArg(o.impersonate));
      // Control de ritmo anti-429
      if (o.limitRate) a.push("--limit-rate", sanitizeArg(o.limitRate));
      if (o.sleepRequests) a.push("--sleep-requests", String(o.sleepRequests));
      if (o.retries != null) a.push("--retries", String(o.retries), "--fragment-retries", String(o.retries));
      a.push(...browserUAFor(url)); // solo bilibili/b23.tv (WAF); vacío para el resto
      // aria2c revienta con la CDN de bilibili (exit 29) y con la de YouTube
      // (exit 22): usar el downloader nativo de yt-dlp, que sí lleva UA/Referer correctos
      if (o.turbo && o.aria2Healthy && !aria2Unsafe(url)) a.push("--external-downloader", "aria2c", "--external-downloader-args", "aria2c:-x 16 -s 16 -k 1M");
      if (o.mode === "profile") a.push("--playlist-end", String(o.profileLimit), "--yes-playlist");
      else if (d.kind !== "collection") a.push("--no-playlist");
      // Rango explícito de una lista ("1-20", "-10", "1,3,7-9"). Manda sobre
      // --playlist-end porque es lo que pidió el usuario con nombre y apellido.
      if (o.playlistRange && (o.mode === "profile" || d.kind === "collection" || o.mode === "all")) {
        a.push("--playlist-items", sanitizeArg(o.playlistRange));
      }
      if (esAudio) {
        // yt-dlp solo extrae 9 formatos (best, aac, alac, flac, m4a, mp3, opus,
        // vorbis, wav). Pedirle `--audio-format aiff|ac3|eac3|dts|mp2` es un
        // error duro: "invalid audio format". Para esos, se extrae el stream
        // original y jobs.ts lo convierte después con ffmpeg.
        const objetivo = audioTarget(o.format, o.audioQuality ?? "");
        const post = audioNeedsFfmpegExport(objetivo);
        a.push("-x");
        if (o.format === "best") {
          // "best" = quedarse con el códec ORIGINAL del sitio, sin recodificar.
          a.push("-f", "bestaudio/best", "--audio-format", "best");
        } else if (post) {
          a.push("-f", "bestaudio/best", "--audio-format", "best");
        } else if (o.format === "m4a") {
          a.push("-f", "bestaudio[ext=m4a]/bestaudio", "--audio-format", "m4a"); // M4A nativo sin recodificar
        } else {
          a.push("-f", "bestaudio/best", "--audio-format", objetivo.ytdlpFormat);
          // 320K para mp3/aac; 0 (mejor) para opus/vorbis. Sin esto, yt-dlp usa
          // VBR ~128k y un "mp3 320" acababa siendo un 130k.
          a.push("--audio-quality", o.audioQuality || (["mp3", "aac"].includes(o.format) ? "320K" : "0"));
        }
      } else {
        // Selector construido en codecs.ts: primero el CÓDEC pedido con el tope
        // de altura, y detrás una cadena genérica de fallback. Sin el fallback,
        // los Shorts verticales (360x640 con cap de 480) y los DASH de bilibili
        // morían con "Requested format is not available".
        a.push("-f", videoSelector({ height: o.quality, codec: o.videoCodec }));

        // ── Pistas: subtítulos, capítulos, carátula ──
        if (o.subtitles && o.subtitles !== "off") {
          const langs = (o.subLangs || "es,en").trim() || "es,en";
          a.push("--sub-langs", sanitizeArg(langs), "--convert-subs", "srt");
          if (o.subtitles === "embed") a.push("--embed-subs");
          else a.push("--write-subs");
          if (o.autoSubs) a.push("--write-auto-subs");
        }
        if (o.chapters && esVideo) a.push("--embed-chapters");
        if (o.embedThumbnail && esVideo && !["ts", "flv"].includes(o.format)) {
          a.push("--embed-thumbnail", "--convert-thumbnails", "jpg");
        }
        // --merge-output-format y --remux-video solo valen para contenedores de
        // vídeo: en modo foto (format "original"/"webp"/"jpg") rompían la orden
        // con "--merge-output-format original".
        if (esVideo) {
          // Contenedor corregido si el códec no cabe (webm + H.264 → mkv) y
          // remux solo cuando el muxer de ffmpeg lo admite de verdad (AVI y OGV
          // fallan al remuxear casi cualquier cosa: ahí manda el merge).
          const cont = resolveContainer(o.format, o.videoCodec ?? "auto").container;
          a.push("--merge-output-format", cont);
          // WebM queda fuera a propósito: remuxear a webm un VP9/AV1 que ya viene
          // bien solo añade una pasada de ffmpeg que a veces falla; con
          // --merge-output-format basta. (Bug histórico: "webm no lleva remux".)
          if (["mp4", "mkv", "mov", "m4v", "ts", "flv"].includes(cont)) a.push("--remux-video", cont);
        }
      }
      a.push("--", url); // "--" corta el parseo de opciones
      return a;
    }
    case "spotdl": {
      const fmt = ["mp3", "flac", "opus", "m4a", "ogg", "wav"].includes(o.format) ? o.format : o.format === "vorbis" ? "ogg" : "mp3";
      const a = ["download", url, "--output", `${out}/{artists}/{title}.{output-ext}`, "--format", fmt, "--print-errors"];
      // spotdl quiere el EJECUTABLE. Antes se le pasaba la carpeta y fallaba
      // con "FFmpeg not found" aunque ffmpeg estuviera ahí al lado.
      const ffBin = o.ffmpegPath ?? o.ffmpegDir;
      if (ffBin) a.push("--ffmpeg", sanitizeArg(ffBin));
      if (o.noRepeat) a.push("--archive", sanitizeArg(o.archiveFile));
      return a;
    }
    case "instaloader": {
      const m = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
      if (!/^[\w.]{1,30}$/.test(m)) throw new Error("Perfil de Instagram inválido");
      const a = ["--dirname-pattern", `${out}/instagram/{target}`, "--count", String(o.profileLimit), "--no-compress-json", "--fast-update"];
      // ── COOKIES: aquí había un bug funcional ────────────────────────────────
      // Antes se pasaba `--load-cookies chrome`, que significa "saca las cookies
      // del navegador Chrome instalado". Con un cookies.txt pegado en /cookies
      // esto (a) ignoraba por completo las cookies del usuario y (b) si Chrome
      // no estaba instalado, instaloader abortaba. instaloader sí sabe leer
      // ficheros de cookies Netscape con `-B/--cookiefile`.
      if (o.cookies) a.push("--cookiefile", sanitizeArg(o.cookies));
      a.push("--", m);
      return a;
    }
    case "gallerydl": {
      const a = ["-d", out, "--range", `1-${o.profileLimit}`];
      if (o.noRepeat) a.push("--download-archive", sanitizeArg(o.archiveFile.replace(/\.txt$/, ".gallery.sqlite")));
      if (o.cookies) a.push("--cookies", sanitizeArg(o.cookies));
      a.push("--", url);
      return a;
    }
    case "streamlink": {
      // (el proxy de streamlink se llama --http-proxy)
      // streamlink elige la mejor calidad disponible; "-o" con plantilla propia.
      const tpl = `${out}/{author}/{title}.{ext}`;
      const a = ["--output", sanitizeArg(tpl), "--force", "--progress", "--retry-streams", "3"];
      if (o.proxy) a.push("--http-proxy", sanitizeArg(o.proxy));
      // streamlink NO acepta cookies.txt de Netscape: necesita `--http-cookie
      // NOMBRE=VALOR` por cada una. Antes se enviaba un `--http-cookie ""`
      // vacío, que además de no servir manda una cabecera rota. Las cookies del
      // navegador se traducen en jobs.ts y llegan ya parseadas.
      for (const par of o.cookiePairs ?? []) a.push("--http-cookie", sanitizeArg(par));
      a.push("--", url, "best");
      return a;
    }
    case "baidupcs": {
      // La transferencia (转存) la lanza jobs.ts ANTES de esto, porque son dos
      // procesos: primero `transfer` del enlace compartido a tu nube, y luego
      // `download` de la ruta resultante. Aquí se construye el segundo.
      const remoto = o.baiduRemote || "/我的资源";
      return ["download", remoto, "-saveto", out, "--ow"];
    }
    case "aliyunpan": {
      // Igual que Baidu: dos pasos. jobs.ts hace el `share` (transferir el
      // enlace compartido a tu drive) y aquí se construye la descarga.
      const remoto = o.aliyunRemote || "/";
      const a = ["download", remoto, "-saveto", out];
      if (o.retries != null) a.push("--retry", String(o.retries));
      return a;
    }
    case "youget": {
      const a = ["-o", out, "--force"];
      if (o.cookies) a.push("--cookies", sanitizeArg(o.cookies));
      a.push(url);
      return a;
    }
    case "curl": {
      // Descarga directa de un archivo. `--continue-at -` reanuda .part,
      // `--fail` convierte un 404 en código de error (sin esto curl "triunfa"
      // guardando la página de error como si fuera el archivo).
      const nombre = decodeURIComponent(new URL(url).pathname.split("/").pop() || "archivo");
      const destino = `${out}/${nombre.replace(/[\\/:*?"<>|]/g, "_")}`;
      const a = ["-L", "--fail", "--retry", "3", "--retry-delay", "2", "--continue-at", "-", "-o", sanitizeArg(destino)];
      if (o.proxy) a.push("--proxy", sanitizeArg(o.proxy));
      if (o.limitRate) a.push("--limit-rate", sanitizeArg(o.limitRate));
      if (o.cookies) a.push("-b", sanitizeArg(o.cookies));
      a.push("--", url);
      return a;
    }
    case "lux":
      return ["-o", out, url];
    default:
      throw new Error(`Motor ${engine} no descarga links`);
  }
}

// Conversión de fotos con Magick (mismo nombre, nueva extensión)
/** Formatos de imagen con parámetro de calidad (el resto, como BMP/TIFF, no). */
const CALIDAD_IMG: Record<string, string> = { webp: "88", jpg: "92", jpeg: "92", avif: "60", tiff: "90" };

export function magickArgs(input: string, format: string): string[] {
  const ext = format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase();
  const outFile = input.replace(/\.[^.\\/]+$/, "") + "." + ext;
  const q = CALIDAD_IMG[ext];
  const a = [sanitizeArg(input)];
  if (q) a.push("-quality", q);
  a.push(sanitizeArg(outFile));
  return a;
}

export function ffprobeArgs(file: string): string[] {
  return ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", sanitizeArg(file)];
}
