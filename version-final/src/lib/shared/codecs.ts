// Matriz de códecs y contenedores: qué existe, qué encaja con qué y cómo se pide.
//
// ── EL PROBLEMA QUE RESUELVE ─────────────────────────────────────────────────
// `--merge-output-format mkv` no elige el códec: elige la CAJA. El vídeo de
// dentro sigue siendo el que el sitio tenga (YouTube: VP9/AV1; TikTok: H.264;
// bilibili: HEVC). Y pedir `-f "bv*[height<=1080]+ba"` te da "lo mejor", que
// puede ser AV1 y no abrirse en un televisor viejo, o HEVC y no abrirse en
// Windows sin el códec de pago.
//
// Aquí está la tabla completa para pedir el códec DE VERDAD:
//   H.264 (AVC) · H.265 (HEVC) · AV1 · VP9 · VP8 · MPEG-4 Part 2 · ProRes · Theora
// y para audio:
//   AAC · MP3 · Opus · Vorbis · FLAC · ALAC · AC-3 · E-AC-3 · DTS · PCM 16/24 · MP2
//
// Reglas:
//  1. Se prefieren los códecs que el sitio YA sirve (copia sin recodificar).
//  2. El filtro de yt-dlp lleva CADENA DE FALLBACK: si el sitio no tiene H.265,
//     se baja lo mejor disponible en vez de fallar con "Requested format is not
//     available" (error que dejaba trabajos muertos en bilibili y Shorts).
//  3. Contenedor incompatible con el códec (webm + H.264) → se corrige a mkv.
//  4. Los destinos que yt-dlp no sabe extraer (AC-3, E-AC-3, DTS, AIFF, MP2,
//     MKA…) se extraen en el códec original y se convierten luego con ffmpeg.

export type VideoCodec =
  | "auto" | "h264" | "h265" | "av1" | "vp9" | "vp8" | "mpeg4" | "prores" | "theora";

export interface VideoCodecDef {
  id: VideoCodec;
  label: string;
  /** Prefijos de `vcodec` tal y como los reporta yt-dlp/ffprobe. */
  prefixes: string[];
  /** Codificador de ffmpeg (solo para reencode explícito). */
  encoder?: string;
  /** Argumentos extra del codificador. */
  encArgs?: string[];
  /** Contenedores que lo admiten sin recodificar. */
  containers: string[];
  /** ¿Se puede pedir al sitio? (los que no, solo salen recodificando) */
  fromSite: boolean;
  note?: string;
}

export const VIDEO_CODECS: VideoCodecDef[] = [
  { id: "auto", label: "Auto (el mejor)", prefixes: [], containers: ["mp4", "mkv", "webm", "mov", "avi", "ts", "m4v", "flv", "ogv"], fromSite: true, note: "lo mejor que ofrezca el sitio" },
  { id: "h264", label: "H.264 / AVC", prefixes: ["avc1", "avc3", "h264"], encoder: "libx264", encArgs: ["-preset", "medium", "-crf", "20"], containers: ["mp4", "mkv", "mov", "m4v", "ts", "flv", "avi"], fromSite: true, note: "compatible con todo (TV, móvil, Windows sin códecs extra)" },
  { id: "h265", label: "H.265 / HEVC", prefixes: ["hev1", "hvc1", "h265", "hevc"], encoder: "libx265", encArgs: ["-preset", "medium", "-crf", "24", "-tag:v", "hvc1"], containers: ["mp4", "mkv", "mov", "m4v", "ts"], fromSite: true, note: "~40 % menos peso, misma calidad" },
  { id: "av1", label: "AV1", prefixes: ["av01", "av1"], encoder: "libsvtav1", encArgs: ["-preset", "6", "-crf", "30"], containers: ["mp4", "mkv", "webm"], fromSite: true, note: "el más eficiente; lento de codificar" },
  { id: "vp9", label: "VP9", prefixes: ["vp09", "vp9"], encoder: "libvpx-vp9", encArgs: ["-crf", "31", "-b:v", "0", "-row-mt", "1"], containers: ["webm", "mkv", "mp4"], fromSite: true, note: "el estándar de YouTube" },
  { id: "vp8", label: "VP8", prefixes: ["vp8"], encoder: "libvpx", encArgs: ["-crf", "10", "-b:v", "2M"], containers: ["webm", "mkv", "ogv"], fromSite: true, note: "viejo; solo por compatibilidad" },
  { id: "mpeg4", label: "MPEG-4 Part 2", prefixes: ["mp4v", "mpeg4"], encoder: "mpeg4", encArgs: ["-q:v", "3"], containers: ["avi", "mp4", "mkv"], fromSite: true, note: "para reproductores antiguos y AVI" },
  { id: "prores", label: "ProRes", prefixes: ["apcn", "apch", "apcs", "ap4h"], encoder: "prores_ks", encArgs: ["-profile:v", "3", "-vendor", "apl0"], containers: ["mov", "mkv"], fromSite: false, note: "edición profesional; solo recodificando" },
  { id: "theora", label: "Theora", prefixes: ["theora"], encoder: "libtheora", encArgs: ["-q:v", "7"], containers: ["ogv", "mkv"], fromSite: false, note: "histórico; solo recodificando" },
];

export type AudioCodec =
  | "auto" | "m4a" | "aac" | "mp3" | "opus" | "vorbis" | "flac" | "alac" | "aiff"
  | "ac3" | "eac3" | "dts" | "pcm16" | "pcm24" | "mp2";

export interface AudioCodecDef {
  id: AudioCodec;
  label: string;
  /** Valor de `--audio-format` de yt-dlp, o null si hay que convertir con ffmpeg. */
  ytdlp: string | null;
  /** Codificador de ffmpeg para el post-proceso. */
  encoder?: string;
  /** Argumentos de calidad por defecto. */
  encArgs?: string[];
  /** Extensión del archivo resultante. */
  ext: string;
  lossless: boolean;
  note?: string;
}

/** Valores que yt-dlp acepta en `-x --audio-format` (su lista real, no la mía). */
export const YTDLP_AUDIO_FORMATS = ["best", "aac", "alac", "flac", "m4a", "mp3", "opus", "vorbis", "wav"] as const;

export const AUDIO_CODECS: AudioCodecDef[] = [
  { id: "auto", label: "Auto (original)", ytdlp: "best", ext: "", lossless: false, note: "no recodifica nada" },
  { id: "m4a", label: "M4A (AAC)", ytdlp: "m4a", encoder: "aac", encArgs: ["-b:a", "256k"], ext: "m4a", lossless: false, note: "contenedor de Apple/iOS" },
  { id: "aac", label: "AAC (crudo)", ytdlp: "aac", encoder: "aac", encArgs: ["-b:a", "320k"], ext: "aac", lossless: false },
  { id: "aiff", label: "AIFF (PCM big-endian)", ytdlp: null, encoder: "pcm_s16be", ext: "aiff", lossless: true, note: "estándar de Apple / edición" },
  { id: "mp3", label: "MP3", ytdlp: "mp3", encoder: "libmp3lame", encArgs: ["-b:a", "320k"], ext: "mp3", lossless: false },
  { id: "opus", label: "Opus", ytdlp: "opus", encoder: "libopus", encArgs: ["-b:a", "192k"], ext: "opus", lossless: false },
  { id: "vorbis", label: "Vorbis", ytdlp: "vorbis", encoder: "libvorbis", encArgs: ["-q:a", "8"], ext: "ogg", lossless: false },
  { id: "flac", label: "FLAC", ytdlp: "flac", encoder: "flac", encArgs: ["-compression_level", "8"], ext: "flac", lossless: true, note: "sin pérdida (revisa Fidelidad)" },
  { id: "alac", label: "ALAC", ytdlp: "alac", encoder: "alac", ext: "m4a", lossless: true },
  { id: "ac3", label: "AC-3 (Dolby Digital)", ytdlp: null, encoder: "ac3", encArgs: ["-b:a", "640k"], ext: "ac3", lossless: false, note: "cine en casa / 5.1" },
  { id: "eac3", label: "E-AC-3 (Dolby Digital Plus)", ytdlp: null, encoder: "eac3", encArgs: ["-b:a", "640k"], ext: "eac3", lossless: false },
  { id: "dts", label: "DTS", ytdlp: null, encoder: "dca", encArgs: ["-strict", "-2", "-b:a", "1536k"], ext: "dts", lossless: false, note: "AV con DTS" },
  { id: "pcm16", label: "PCM 16 bit (WAV)", ytdlp: "wav", encoder: "pcm_s16le", ext: "wav", lossless: true },
  { id: "pcm24", label: "PCM 24 bit (WAV)", ytdlp: null, encoder: "pcm_s24le", ext: "wav", lossless: true, note: "masterizado, archivos grandes" },
  { id: "mp2", label: "MP2", ytdlp: null, encoder: "mp2", encArgs: ["-b:a", "320k"], ext: "mp2", lossless: false, note: "TS / broadcasting" },
];

/** Contenedores de vídeo y los códecs que admiten (tabla de compatibilidad). */
export const VIDEO_CONTAINERS: Record<string, { label: string; video: string[]; audio: string[]; muxable: boolean }> = {
  mp4: { label: "MP4", video: ["h264", "h265", "av1", "mpeg4", "vp9"], audio: ["aac", "mp3", "ac3", "eac3", "alac", "opus"], muxable: true },
  mkv: { label: "MKV", video: ["h264", "h265", "av1", "vp9", "vp8", "mpeg4", "prores", "theora"], audio: ["aac", "mp3", "opus", "vorbis", "flac", "alac", "ac3", "eac3", "dts", "pcm16", "pcm24", "mp2"], muxable: true },
  webm: { label: "WebM", video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"], muxable: true },
  mov: { label: "MOV", video: ["h264", "h265", "prores", "mpeg4"], audio: ["aac", "alac", "pcm16", "pcm24", "mp3", "ac3"], muxable: true },
  avi: { label: "AVI", video: ["mpeg4", "h264"], audio: ["mp3", "pcm16", "ac3", "mp2"], muxable: false },
  ts: { label: "TS", video: ["h264", "h265", "mpeg4"], audio: ["aac", "ac3", "eac3", "mp3", "mp2"], muxable: true },
  m4v: { label: "M4V", video: ["h264", "h265"], audio: ["aac", "ac3", "eac3", "alac"], muxable: true },
  flv: { label: "FLV", video: ["h264"], audio: ["aac", "mp3"], muxable: true },
  ogv: { label: "OGV", video: ["theora", "vp8"], audio: ["vorbis", "opus"], muxable: false },
};

export function videoCodecDef(id: VideoCodec): VideoCodecDef {
  return VIDEO_CODECS.find((c) => c.id === id) ?? VIDEO_CODECS[0];
}

export function audioCodecDef(id: AudioCodec): AudioCodecDef {
  return AUDIO_CODECS.find((c) => c.id === id) ?? AUDIO_CODECS[0];
}

/**
 * ¿Contenedor y códec encajan? Si no, devuelve el contenedor al que hay que
 * caer (mkv, que admite todo) y el motivo para el log.
 */
export function resolveContainer(container: string, codec: VideoCodec): { container: string; forced?: string } {
  const c = VIDEO_CONTAINERS[container];
  if (!c) return { container: "mkv", forced: `"${container}" no es un contenedor conocido → mkv` };
  if (codec === "auto" || c.video.includes(codec)) return { container };
  const def = videoCodecDef(codec);
  const destino = def.containers.find((x) => VIDEO_CONTAINERS[x]?.muxable) ?? "mkv";
  return { container: destino, forced: `${codec.toUpperCase()} no cabe en ${c.label} → ${destino.toUpperCase()}` };
}

/**
 * Cadena `-f` de yt-dlp: primero el códec pedido con el tope de altura, y si el
 * sitio no lo tiene, lo mejor disponible. Siempre con audio, siempre con
 * fallback (sin fallback, un Short vertical o un bilibili DASH falla en seco).
 */
export function videoSelector(opts: { height?: string; codec?: VideoCodec }): string {
  const codec = opts.codec ?? "auto";
  const def = videoCodecDef(codec);
  const h = opts.height && opts.height !== "best" ? Number(opts.height) : 0;
  const cap = (extra: string) => [
    h ? `bv*${extra}[height<=${h}]` : `bv*${extra}`,
    h ? `bv*${extra}[height<=${h}]` : null,
  ].filter(Boolean).join("/");
  // Filtro por códec, con varios prefijos (avc1/avc3, hev1/hvc1…)
  const filtro = (p: string) => `[vcodec^=${p}]`;
  const porCodigo = def.prefixes.length
    ? def.prefixes.map((p) => cap(filtro(p))).join("/")
    : "";
  const generico = h
    ? `bv*[height<=${h}]+ba/bv*[width<=${h}]+ba/b[height<=${h}]/b[width<=${h}]/bv*+ba/b`
    : "bv*+ba/b";
  const partes = [porCodigo, generico].filter(Boolean);
  // El "+ba" del códec concreto: si el sitio da vídeo y audio separados hay que
  // pedir el audio aparte; el patrón `bv*[vcodec^=x]+ba` lo hace.
  return partes
    .map((p) => (p.includes("+ba") ? p : `${p}+ba`))
    .join("/");
}

/** ¿Este destino de audio lo sabe hacer yt-dlp, o hay que pasar por ffmpeg? */
export function audioNeedsFfmpeg(ytdlpFormat: string | null): boolean {
  return !ytdlpFormat || !(YTDLP_AUDIO_FORMATS as readonly string[]).includes(ytdlpFormat);
}

export interface AudioTarget {
  /** Qué pedirle a yt-dlp: su formato nativo o "best" (copia) si hay post. */
  ytdlpFormat: string;
  /** ¿Hay que convertir después? (yt-dlp no sabe producir este códec) */
  needsFfmpeg: boolean;
  /** Códec de ffmpeg. Se conoce siempre, aunque yt-dlp pueda hacerlo solo. */
  ffmpegEncoder: string | null;
  encArgs: string[];
  ext: string;
  /** Nombre del destino para el log ("AC-3", "AIFF"…). */
  label: string;
}

/**
 * Plan de conversión de audio.
 * @param format   formato pedido ("mp3", "ac3", "aiff", "best"…)
 * @param quality  bitrate del usuario ("320K") o "" para el del códec
 */
/** Alias de la interfaz (extensión visible) → id del catálogo. */
const ALIAS: Record<string, string> = { ogg: "vorbis", wav: "pcm16", aif: "aiff", copy: "auto", original: "auto" };

export function audioTarget(format: string, quality = ""): AudioTarget {
  const f = format.toLowerCase();
  const id = ALIAS[f] ?? f;
  const def = AUDIO_CODECS.find((c) => c.id === id);
  if (!def || def.id === "auto") {
    return { ytdlpFormat: "best", needsFfmpeg: false, ffmpegEncoder: null, encArgs: [], ext: "", label: "original" };
  }
  const encArgs = [...(def.encArgs ?? [])];
  // El bitrate del usuario manda sobre el del catálogo, salvo en lossless.
  if (quality && !def.lossless && /^\d+K$/i.test(quality)) {
    const i = encArgs.findIndex((x) => x === "-b:a");
    if (i >= 0) encArgs[i + 1] = quality.toUpperCase().replace("K", "k");
    else if (def.encoder && !def.encoder.startsWith("pcm")) encArgs.push("-b:a", quality.toUpperCase().replace("K", "k"));
  }
  const post = audioNeedsFfmpeg(def.ytdlp);
  return {
    ytdlpFormat: post ? "best" : (def.ytdlp as string),
    needsFfmpeg: post,
    ffmpegEncoder: def.encoder ?? null,
    encArgs,
    ext: def.ext,
    label: def.label,
  };
}

/** Argumentos de ffmpeg para convertir un audio sin tocar la pista de vídeo. */
export function ffmpegAudioArgs(input: string, target: AudioTarget): string[] {
  let out = input.replace(/\.[^.\\/]+$/, "") + "." + (target.ext || "mka");
  // WAV → WAV 24 bits, MKA → MKA…: si la extensión es la misma, la salida sería
  // el MISMO archivo y ffmpeg se niega ("Output ... same as Input"). Se añade
  // un sufijo para no pisar el original antes de haberlo convertido.
  if (out.toLowerCase() === input.toLowerCase()) out = out.replace(/(\.[^.]+)$/, " (conv)$1");
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn",
    "-c:a", target.ffmpegEncoder ?? "copy",
    ...target.encArgs, out];
}

/** Argumentos de ffmpeg para recodificar vídeo a un códec concreto. */
/** Códec de audio que cada contenedor de vídeo admite de verdad. */
const AUDIO_PARA: Record<string, string> = {
  webm: "libopus", ogv: "libvorbis", avi: "libmp3lame",
  mp4: "aac", m4v: "aac", mov: "aac", mkv: "aac", ts: "aac", flv: "aac",
};

export function ffmpegVideoArgs(input: string, codec: VideoCodec, container: string, audioCodec?: string): string[] {
  const def = videoCodecDef(codec);
  let out = input.replace(/\.[^.\\/]+$/, "") + "." + container;
  // Mismo caso que en audio: MP4 → MP4 (recodificar el códec sin cambiar la
  // caja) escribiría sobre la entrada y ffmpeg aborta. Se le pone sufijo.
  if (out.toLowerCase() === input.toLowerCase()) out = out.replace(/(\.[^.]+)$/, " (conv)$1");
  const acodec = audioCodec ?? AUDIO_PARA[container] ?? "aac";
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-c:v", def.encoder ?? "libx264", ...(def.encArgs ?? []),
    "-c:a", acodec, "-b:a", "192k", out];
}

/** ¿El códec real del archivo corresponde al pedido? (para avisar con la verdad) */
export function codecMatches(real: string, wanted: VideoCodec): boolean {
  if (wanted === "auto") return true;
  const r = real.toLowerCase();
  return videoCodecDef(wanted).prefixes.some((p) => r.startsWith(p));
}
