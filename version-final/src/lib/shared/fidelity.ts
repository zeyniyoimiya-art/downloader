// Guardián de fidelidad de audio: evita los "FLAC falsos".
//
// ── EL PROBLEMA ──────────────────────────────────────────────────────────────
// `yt-dlp -x --audio-format flac` descarga el mejor audio disponible (AAC 128k
// en YouTube, Opus 160k en el resto) y luego lo RECODIFICA a FLAC. El resultado
// es un FLAC técnicamente válido y acústicamente idéntico al AAC: has cambiado
// un archivo de 4 MB por uno de 30 MB sin ganar ni un bit de información.
// Eso es un "mp3 disfrazado de flac": no se puede deshacer, y la pérdida ya
// venía del origen.
//
// La única forma honesta de tener FLAC es que la FUENTE sea lossless (un
// SoundCloud/Bandcamp en WAV, un archivo local, un CD rip subido en FLAC).
// Este módulo decide, con el códec real que reporta el extractor, si la
// conversión que pidió el usuario tiene sentido.
//
// ── MODOS ────────────────────────────────────────────────────────────────────
//  · "estricto" (recomendado): si la fuente es lossy y pides un contenedor
//    lossless, NO se recodifica: se entrega el audio original tal cual (m4a /
//    opus / mp3) y se avisa del motivo. Nunca generas basura de 30 MB.
//  · "avisar": se hace lo que pediste, pero el trabajo queda marcado y el
//    historial lo dice ("FLAC · transcode desde AAC").
//  · "libre": conversión sin preguntas (comportamiento antiguo).

export type FidelityMode = "estricto" | "avisar" | "libre";

/** Contenedores sin pérdida (el audio dentro NO ha pasado por un códec lossy). */
export const LOSSLESS_FORMATS = ["flac", "wav", "alac", "aiff", "aif", "wv", "ape"] as const;

/** Códecs que SÍ son lossless en origen. */
const LOSSLESS_CODECS = /^(flac|alac|wav|pcm_|aiff|ape|wavpack|tta|truehd|dts)/i;

/** Códecs con pérdida. */
const LOSSY_CODECS = /^(aac|mp3|mp4a|opus|vorbis|ac-?3|e-?ac-?3|mp2|amr|wmav|nellymoser|speex|gsm)/i;

export interface AudioSource {
  /** Códec real reportado por el extractor (acodec de yt-dlp, o el de ffprobe). */
  codec?: string | null;
  /** Bitrate aproximado en kbps, si se conoce. */
  abr?: number | null;
  /** Formato del contenedor de origen (ext). */
  ext?: string | null;
}

export interface AudioPlan {
  /** Formato que se va a producir de verdad. */
  format: string;
  /** ¿Hay que recodificar? false = copia directa del stream (lossless-perfect). */
  reencode: boolean;
  /** true cuando el usuario pidió lossless pero la fuente no lo es. */
  upconvert: boolean;
  /** Mensaje para el log / la UI. Vacío si no hay nada que contar. */
  note: string;
}

export function isLosslessRequest(format: string): boolean {
  return (LOSSLESS_FORMATS as readonly string[]).includes(format.toLowerCase());
}

/** ¿El códec de origen es lossless? Sin dato fiable, se asume que NO. */
export function isLosslessSource(src: AudioSource): boolean {
  const c = (src.codec ?? "").toLowerCase().trim();
  if (c) return LOSSLESS_CODECS.test(c);
  const ext = (src.ext ?? "").toLowerCase().replace(/^\./, "");
  if (ext) return (LOSSLESS_FORMATS as readonly string[]).includes(ext);
  return false;
}

/** ¿El códec de origen es lossy? (para poder afirmarlo, no para suponerlo) */
export function isLossySource(src: AudioSource): boolean {
  const c = (src.codec ?? "").toLowerCase().trim();
  if (c) return LOSSY_CODECS.test(c);
  return false;
}

/**
 * ¿Qué hacemos con este audio?
 *
 * @param requested  formato pedido por el usuario ("flac", "mp3", "best"…)
 * @param src        datos del stream de origen
 * @param mode       política de fidelidad
 * @param fallback   formato al que caer en modo estricto ("m4a" normalmente:
 *                   contenedor que admite AAC sin recodificar)
 */
export function planAudio(requested: string, src: AudioSource, mode: FidelityMode, fallback = "m4a"): AudioPlan {
  const want = requested.toLowerCase();
  // "best"/"original" = no tocar nada: se guarda el stream tal cual llega.
  if (want === "best" || want === "original" || want === "copy") {
    return { format: src.ext || "original", reencode: false, upconvert: false, note: "" };
  }
  if (!isLosslessRequest(want)) {
    // Se pide un formato con pérdida (mp3, aac, opus, vorbis…): es legítimo.
    // Se avisa solo si la fuente ya era lossy y encima se recodifica otra vez.
    const doble = isLossySource(src) && !["mp3", "aac", "opus", "vorbis", "m4a"].includes((src.ext ?? "").toLowerCase().includes("m4a") ? "m4a" : (src.ext ?? "").toLowerCase());
    return {
      format: want,
      reencode: true,
      upconvert: false,
      note: doble ? `Recodificación de ${src.codec || src.ext || "la fuente"} a ${want}: se pierde un poco más de calidad que yendo a "${fallback}".` : "",
    };
  }
  // Pediste lossless.
  if (isLosslessSource(src)) {
    // Fuente lossless → FLAC/WAV real, sin pérdida añadida.
    return { format: want, reencode: want !== "flac", upconvert: false, note: `${want.toUpperCase()} real (la fuente ya era ${src.codec || "lossless"}).` };
  }
  // Fuente lossy + destino lossless → aquí estaba el "mp3 disfrazado de flac".
  const origen = src.codec || src.ext || "lossy";
  const kbps = src.abr ? ` ${Math.round(src.abr)} kb/s` : "";
  if (mode === "libre") {
    return { format: want, reencode: true, upconvert: true, note: `${want.toUpperCase()} generado desde ${origen}${kbps}: es más grande pero NO tiene más calidad.` };
  }
  if (mode === "avisar") {
    return { format: want, reencode: true, upconvert: true, note: `${want.toUpperCase()} desde ${origen}${kbps} (transcode): sin mejora real de calidad.` };
  }
  // estricto (por defecto)
  const alt = bestPassthrough(src, fallback);
  return {
    format: alt,
    reencode: false,
    upconvert: false,
    note: `Pediste ${want.toUpperCase()}, pero la fuente es ${origen}${kbps}. Un ${want.toUpperCase()} ahí sería "${want.toUpperCase()} falso" (mismo audio, ~5× más peso). Se guarda el audio original en ${alt.toUpperCase()} sin recodificar. Cambia Ajustes → Fidelidad a "avisar" si lo quieres igualmente.`,
  };
}

/**
 * Contenedor sin recodificar que mejor conserva el stream de origen.
 * AAC→m4a, Opus/Vorbis→opus/ogg, MP3→mp3, resto→su propia extensión.
 */
export function bestPassthrough(src: AudioSource, fallback = "m4a"): string {
  const c = (src.codec ?? "").toLowerCase();
  const ext = (src.ext ?? "").toLowerCase();
  if (c.startsWith("aac") || c.includes("mp4a") || ext === "m4a") return "m4a";
  if (c.startsWith("opus")) return "opus";
  if (c.startsWith("vorbis")) return "ogg";
  if (c.startsWith("mp3")) return "mp3";
  if (c.startsWith("flac")) return "flac";
  if (c.startsWith("alac")) return "m4a";
  if (c.startsWith("pcm") || ext === "wav") return "wav";
  return fallback;
}

/** Etiqueta corta para el historial: "FLAC (desde AAC)" o "FLAC". */
export function formatLabel(plan: AudioPlan): string {
  const base = plan.format.toUpperCase();
  return plan.upconvert ? `${base} (desde origen lossy)` : base;
}
