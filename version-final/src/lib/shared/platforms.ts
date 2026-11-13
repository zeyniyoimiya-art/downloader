// Detección de plataforma y tabla de enrutado plataforma → motor. Código puro (usable en cliente, servidor y tests).

// Modo de descarga: atómicos (un trabajo = un modo) y combinados (varios trabajos)
export type Mode = "audio" | "video" | "photo" | "profile" | "all" | "photo_video" | "audio_photo";
export type AtomicMode = "audio" | "video" | "photo" | "profile";
export type ComboMode = "all" | "photo_video" | "audio_photo";
export type EngineId =
  | "yt-dlp" | "ffmpeg" | "ffprobe" | "ffplay" | "gallerydl" | "instaloader"
  | "spotdl" | "lux" | "aria2c" | "magick" | "exiftool" | "deno";

export const ATOMIC_MODES: readonly AtomicMode[] = ["audio", "video", "photo", "profile"];
const COMBO_PARTS: Record<ComboMode, readonly AtomicMode[]> = {
  all: ["photo", "video", "audio"],
  photo_video: ["photo", "video"],
  audio_photo: ["audio", "photo"],
};

export function isCombo(mode: Mode): mode is ComboMode {
  return mode in COMBO_PARTS;
}
/** Partes atómicas de un modo (los combinados se expanden; los atómicos, [uno]). */
export function modeParts(mode: Mode): AtomicMode[] {
  return isCombo(mode) ? [...COMBO_PARTS[mode]] : [mode];
}

export interface Detected {
  url: string;
  platform: string;
  label: string;
  color: string;
  kind: "track" | "collection" | "profile" | "post" | "gallery" | "video";
}

const RULES: { re: RegExp; platform: string; label: string; color: string }[] = [
  { re: /(^|\.)(youtube\.com|youtu\.be|music\.youtube\.com)$/i, platform: "youtube", label: "YouTube", color: "#ff3b30" },
  { re: /(^|\.)tiktok\.com$/i, platform: "tiktok", label: "TikTok", color: "#25f4ee" },
  { re: /(^|\.)(x\.com|twitter\.com)$/i, platform: "x", label: "X", color: "#e5e5ea" },
  { re: /(^|\.)(instagram\.com|instagr\.am)$/i, platform: "instagram", label: "Instagram", color: "#e1306c" },
  { re: /(^|\.)(open\.)?spotify\.com$/i, platform: "spotify", label: "Spotify", color: "#1ed760" },
  { re: /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/i, platform: "pinterest", label: "Pinterest", color: "#e60023" },
  { re: /(^|\.)artstation\.com$/i, platform: "artstation", label: "ArtStation", color: "#13aff0" },
  { re: /(^|\.)(imgur\.com|deviantart\.com|flickr\.com)$/i, platform: "galeria", label: "Galería", color: "#2ecc71" },
  { re: /(^|\.)(facebook\.com|fb\.watch)$/i, platform: "facebook", label: "Facebook", color: "#1877f2" },
  { re: /(^|\.)(bilibili\.com|b23\.tv)$/i, platform: "bilibili", label: "Bilibili", color: "#00a1d6" },
  { re: /(^|\.)(douyin\.com|iqiyi\.com|youku\.com|v\.qq\.com)$/i, platform: "cn", label: "Sitio CN", color: "#ff9f0a" },
  { re: /(^|\.)twitch\.tv$/i, platform: "twitch", label: "Twitch", color: "#9146ff" },
  { re: /(^|\.)soundcloud\.com$/i, platform: "soundcloud", label: "SoundCloud", color: "#ff5500" },
  { re: /(^|\.)(threads\.net|threads\.com)$/i, platform: "threads", label: "Threads", color: "#d1d5db" },
  { re: /(^|\.)vimeo\.com$/i, platform: "vimeo", label: "Vimeo", color: "#1ab7ea" },
  { re: /(^|\.)(reddit\.com|redd\.it)$/i, platform: "reddit", label: "Reddit", color: "#ff4500" },
];

// Secciones de Instagram que NUNCA son un perfil (evita enrutar /explore por instaloader)
const IG_NO_PERFIL = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct"]);

// Valida que sea http(s) y no apunte a la red local (evita SSRF accidental)
export function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname)) return false;
    return raw.length < 2048 && !/[\s"'`]/.test(raw);
  } catch {
    return false;
  }
}

export function detect(raw: string): Detected | null {
  const url = raw.trim();
  if (!isSafeUrl(url)) return null;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const p = u.pathname;
  const rule = RULES.find((r) => r.re.test(host));
  const base = rule ?? { platform: "web", label: host, color: "#a78bfa" };
  let kind: Detected["kind"] = "video";
  if (base.platform === "spotify") kind = /\/(album|playlist|artist)\//.test(p) ? "collection" : "track";
  else if (base.platform === "instagram") kind = IG_NO_PERFIL.has((p.split("/").filter(Boolean)[0] ?? "").toLowerCase()) ? "post" : "profile";
  else if (["pinterest", "artstation", "galeria"].includes(base.platform)) kind = "gallery";
  else if (base.platform === "x" && /\/(media|photo)/.test(p)) kind = "gallery";
  else if (base.platform === "youtube" && /^\/(@|channel\/|c\/|user\/)|[?&]list=/.test(p + u.search)) kind = "collection";
  else if (base.platform === "tiktok" && /^\/@[^/]+\/?$/.test(p)) kind = "profile";
  return { url, platform: base.platform, label: base.label, color: base.color, kind };
}

// Extrae links de un textarea multilínea (uno o varios por línea)
export function parseLinks(text: string): Detected[] {
  const out: Detected[] = [];
  const seen = new Set<string>();
  for (const tok of text.split(/[\s,]+/)) {
    if (!tok) continue;
    const d = detect(tok);
    if (d && !seen.has(d.url)) {
      seen.add(d.url);
      out.push(d);
    }
  }
  return out;
}

// Parte "principal" de un modo: los combinados se reducen a su primera parte atómica
export function primaryMode(mode: Mode): AtomicMode {
  return isCombo(mode) ? COMBO_PARTS[mode][0] : mode;
}

// Extensiones de archivo directo. En un dominio desconocido son la única pista
// de qué se puede descargar; sin mirarlas se ofrecían —y se encolaban— modos
// que no existen, como un trabajo de gallery-dl para un .mp4.
const EXT_IMG = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|svg)(\?|#|$)/i;
const EXT_AUDIO = /\.(mp3|m4a|aac|flac|wav|opus|ogg|oga|weba)(\?|#|$)/i;
const EXT_VIDEO = /\.(mp4|m4v|webm|mkv|mov|avi|flv|ts|mpe?g)(\?|#|$)/i;

// Tabla de capacidades: qué modos atómicos puede ofrecer cada plataforma.
// Es la base de la lógica de la UI (no ofrecer "fotos" en YouTube ni "video" en Spotify).
export function supportedModes(d: Detected): AtomicMode[] {
  switch (d.platform) {
    case "spotify": return ["audio"];
    case "soundcloud": return ["audio", "profile"];
    case "pinterest":
    case "artstation":
    case "galeria": return ["photo"];
    case "youtube": return ["audio", "video", "profile"];
    case "tiktok": return ["audio", "video", "profile"];
    case "bilibili":
    case "cn": return ["audio", "video"];
    case "twitch": return ["audio", "video", "profile"];
    case "vimeo": return ["audio", "video"];
    default: {
      // Dominio desconocido: si la propia URL declara el tipo de archivo, se
      // respeta; si no hay pista, se ofrecen los cuatro modos.
      if (d.platform === "web") {
        if (EXT_IMG.test(d.url)) return ["photo"];
        if (EXT_AUDIO.test(d.url)) return ["audio"];
        if (EXT_VIDEO.test(d.url)) return ["audio", "video"];
      }
      return ["audio", "video", "photo", "profile"]; // instagram, x, facebook, reddit, threads
    }
  }
}

// Modos (atómicos + combinados) con sentido para el conjunto de links detectados.
// Sin links → los 7. Con links → intersección de capacidades; los combos solo si
// TODAS sus partes caben. Mezcla incompatible (Spotify+Pinterest) → los 7 y que el
// backend encuele por-parte solo lo válido de cada link.
export function availableModes(links: Detected[]): Mode[] {
  const ALL: Mode[] = ["audio", "video", "photo", "profile", "all", "photo_video", "audio_photo"];
  if (!links.length) return ALL;
  let inter = new Set<AtomicMode>(["audio", "video", "photo", "profile"]);
  for (const l of links) {
    const s = supportedModes(l);
    inter = new Set([...inter].filter((m) => s.includes(m)));
  }
  if (inter.size === 0) return ALL;
  const out: Mode[] = ATOMIC_MODES.filter((m) => inter.has(m));
  for (const c of ["all", "photo_video", "audio_photo"] as ComboMode[]) {
    if (COMBO_PARTS[c].every((p) => inter.has(p))) out.push(c);
  }
  return out;
}

// Modo recomendado según las plataformas detectadas (el que se preselecciona).
export function recommendMode(links: Detected[]): Mode {
  if (!links.length) return "audio";
  const plats = new Set(links.map((l) => l.platform));
  if (links.some((l) => l.kind === "profile" || l.kind === "collection")) return "profile";
  if ([...plats].every((p) => p === "spotify" || p === "soundcloud")) return "audio";
  // Sitio genérico: `detect()` no reconoció el dominio, o sea platform "web".
  // Antes «web» caía en la lista de Fotos + Video, así que la opción TOP para un
  // MP4 directo encolaba además un trabajo de gallery-dl sin ningún sentido.
  // Ahora se mira la extensión: imagen → foto; cualquier otra cosa → vídeo
  // (yt-dlp, que es quien resuelve las URLs genéricas).
  if ([...plats].every((p) => p === "web")) {
    return links.every((l) => EXT_IMG.test(l.url)) ? "photo" : "video";
  }
  if ([...plats].every((p) => ["pinterest", "artstation", "galeria"].includes(p))) return "photo";
  if ([...plats].every((p) => ["x", "instagram", "facebook", "reddit", "threads"].includes(p))) return "photo_video";
  return "video"; // youtube, tiktok, bilibili, cn, twitch, vimeo…
}

// Tabla de enrutado: decide el motor primario
export function routeEngine(d: Detected, mode: Mode, opts: { altEngineCN?: boolean; healthy?: (e: EngineId) => boolean } = {}): EngineId {
  const m = primaryMode(mode);
  const ok = opts.healthy ?? (() => true);
  if (d.platform === "spotify") return "spotdl";
  if (d.platform === "instagram") return d.kind === "profile" || m === "profile" ? "instaloader" : "yt-dlp";
  if (d.kind === "gallery" || (m === "photo" && ["x", "pinterest", "artstation", "reddit", "web"].includes(d.platform))) return "gallerydl";
  if ((d.platform === "cn" || d.platform === "bilibili") && opts.altEngineCN && ok("lux")) return "lux";
  return "yt-dlp";
}

export const AUDIO_FORMATS = ["m4a", "mp3", "flac", "wav", "opus", "aac", "vorbis"] as const;
export const VIDEO_FORMATS = ["mp4", "mkv", "webm"] as const;
export const PHOTO_FORMATS = ["original", "webp", "jpg"] as const;
