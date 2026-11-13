// Construcción de argumentos por motor/modo/formato. Siempre devuelve arrays (nunca strings para shell).
import { AUDIO_FORMATS, VIDEO_FORMATS, type Detected, type EngineId, type Mode } from "./platforms";

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
   * Carpeta para parciales e intermedios. Imprescindible para que bajar el
   * audio de algo que ya bajaste como vídeo no destruya el vídeo (ver abajo).
   */
  tempDir?: string | null;
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

export function buildArgs(engine: EngineId, d: Detected, o: ArgOptions): string[] {
  const url = safeUrlArg(d.url);
  const out = sanitizeArg(o.outputDir);
  switch (engine) {
case "yt-dlp": {
      // El modo y el formato NO siempre coinciden: «Perfil completo» ofrece mp3
      // y el modo foto usa jpg/webp. Quien decide si esto es audio es el FORMATO.
      const esAudio = (AUDIO_FORMATS as readonly string[]).includes(o.format);
      const esVideo = (VIDEO_FORMATS as readonly string[]).includes(o.format);
      const a = ["--newline", "--progress", "--no-colors", "--ignore-errors", "-P", out, "-o", esAudio ? OUT_TPL_AUDIO : OUT_TPL,
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
      a.push(...browserUAFor(url)); // solo bilibili/b23.tv (WAF); vacío para el resto
      // aria2c revienta con la CDN de bilibili (exit 29) y con la de YouTube
      // (exit 22): usar el downloader nativo de yt-dlp, que sí lleva UA/Referer correctos
      if (o.turbo && o.aria2Healthy && !aria2Unsafe(url)) a.push("--external-downloader", "aria2c", "--external-downloader-args", "aria2c:-x 16 -s 16 -k 1M");
      if (o.mode === "profile") a.push("--playlist-end", String(o.profileLimit), "--yes-playlist");
      else if (d.kind !== "collection") a.push("--no-playlist");
      if (esAudio) {
        a.push("-x");
        if (o.format === "m4a") a.push("-f", "bestaudio[ext=m4a]/bestaudio", "--audio-format", "m4a"); // M4A nativo sin recodificar
        else a.push("-f", "bestaudio/best", "--audio-format", o.format, "--audio-quality", "0");
      } else {
        // Cap de calidad con fallbacks: en vídeos VERTICALES (Shorts/TikTok/Reels,
        // bilibili portrait) el alto real supera el cap ("height<=480" no matchea
        // un 360x640) y en DASH-only (bilibili) tampoco existe formato combinado
        // "b"; sin estos fallbacks yt-dlp revienta con "Requested format is not available".
        const sel = o.quality === "best" ? "bv*+ba/b"
          : `bv*[height<=${o.quality}]+ba/bv*[width<=${o.quality}]+ba/b[height<=${o.quality}]/b[width<=${o.quality}]/bv*+ba/b`;
        a.push("-f", sel);
        // --merge-output-format y --remux-video solo valen para contenedores de
        // vídeo: en modo foto (format "original"/"webp"/"jpg") rompían la orden
        // con "--merge-output-format original".
        if (esVideo) {
          a.push("--merge-output-format", o.format);
          if (o.format !== "webm") a.push("--remux-video", o.format);
        }
      }
      a.push("--", url); // "--" corta el parseo de opciones
      return a;
    }
    case "spotdl": {
      const fmt = ["mp3", "flac", "opus", "m4a", "ogg", "wav"].includes(o.format) ? o.format : o.format === "vorbis" ? "ogg" : "mp3";
      const a = ["download", url, "--output", `${out}/{artists}/{title}.{output-ext}`, "--format", fmt, "--print-errors"];
      if (o.ffmpegDir) a.push("--ffmpeg", sanitizeArg(o.ffmpegDir));
      if (o.noRepeat) a.push("--archive", sanitizeArg(o.archiveFile));
      return a;
    }
    case "instaloader": {
      const m = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
      if (!/^[\w.]{1,30}$/.test(m)) throw new Error("Perfil de Instagram inválido");
      const a = ["--dirname-pattern", `${out}/instagram/{target}`, "--count", String(o.profileLimit), "--no-compress-json", "--fast-update"];
      if (o.cookies) a.push("--load-cookies", "chrome"); // instaloader usa navegador; cookies.txt se maneja vía sesión
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
    case "lux":
      return ["-o", out, url];
    default:
      throw new Error(`Motor ${engine} no descarga links`);
  }
}

// Conversión de fotos con Magick (mismo nombre, nueva extensión)
export function magickArgs(input: string, format: "webp" | "jpg"): string[] {
  const outFile = input.replace(/\.[^.\\/]+$/, "") + "." + format;
  return [sanitizeArg(input), "-quality", format === "webp" ? "88" : "92", sanitizeArg(outFile)];
}

export function ffprobeArgs(file: string): string[] {
  return ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", sanitizeArg(file)];
}
