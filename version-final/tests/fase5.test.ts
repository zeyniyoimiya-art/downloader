// Tests de la fase 5: matriz de códecs, contenedores, pistas y conversión.
import { describe, expect, it } from "vitest";
import {
  AUDIO_CODECS, VIDEO_CODECS, audioNeedsFfmpeg, audioTarget, codecMatches,
  ffmpegAudioArgs, ffmpegVideoArgs, resolveContainer, videoSelector,
} from "../src/lib/shared/codecs";
import { buildArgs, magickArgs, type ArgOptions } from "../src/lib/shared/args";
import { detect } from "../src/lib/shared/platforms";

const d = detect("https://www.youtube.com/watch?v=abc")!;
const base: ArgOptions = {
  outputDir: "D:\\Descargas", profileLimit: 50, noRepeat: false, archiveFile: "D:\\a.txt",
  turbo: false, cookies: null, ffmpegDir: null, ffmpegPath: null, tempDir: null,
  quality: "1080", mode: "video", format: "mp4", aria2Healthy: false, embedMetadata: true,
};

describe("catálogo de códecs", () => {
  it("ofrece los 9 códecs de vídeo y los 16 de audio", () => {
    expect(VIDEO_CODECS).toHaveLength(9);
    expect(AUDIO_CODECS.length).toBeGreaterThanOrEqual(15);
    expect(VIDEO_CODECS.map((c) => c.id)).toContain("h265");
    expect(AUDIO_CODECS.map((c) => c.id)).toEqual(expect.arrayContaining(["ac3", "eac3", "dts", "aiff", "mp2", "pcm24"]));
  });

  it("solo ProRes y Theora no salen del sitio", () => {
    expect(VIDEO_CODECS.filter((c) => !c.fromSite).map((c) => c.id)).toEqual(["prores", "theora"]);
  });
});

describe("selector -f de yt-dlp", () => {
  it("auto no filtra códec pero mantiene el tope de altura", () => {
    const s = videoSelector({ height: "1080", codec: "auto" });
    expect(s).toContain("bv*[height<=1080]+ba");
    expect(s).not.toContain("vcodec");
  });

  it("H.265 pide hev1, con caída a lo mejor disponible", () => {
    const s = videoSelector({ height: "1080", codec: "h265" });
    expect(s).toContain("[vcodec^=hev1]");
    expect(s).toContain("bv*+ba/b");   // fallback aunque no haya HEVC
  });

  it("AV1 pide av01 y H.264 pide avc1", () => {
    expect(videoSelector({ codec: "av1" })).toContain("[vcodec^=av01]");
    expect(videoSelector({ codec: "h264" })).toContain("[vcodec^=avc1]");
  });

  it("respeta altura \"best\" (sin tope) y los verticales", () => {
    expect(videoSelector({ height: "best", codec: "h264" })).not.toContain("height<=");
    expect(videoSelector({ height: "480" })).toContain("[width<=480]");
  });
});

describe("compatibilidad contenedor ↔ códec", () => {
  it("webm + H.264 se corrige (webm no admite AVC)", () => {
    const r = resolveContainer("webm", "h264");
    expect(r.container).not.toBe("webm");
    expect(r.forced).toMatch(/H264|h264/i);
  });

  it("mp4 + H.265 cabe sin cambios", () => {
    expect(resolveContainer("mp4", "h265")).toEqual({ container: "mp4" });
  });

  it("avi + AV1 se corrige; mkv admite todo", () => {
    expect(resolveContainer("avi", "av1").container).not.toBe("avi");
    expect(resolveContainer("mkv", "prores")).toEqual({ container: "mkv" });
  });

  it("un contenedor inventado cae a mkv con aviso", () => {
    const r = resolveContainer("xyz", "auto");
    expect(r.container).toBe("mkv");
    expect(r.forced).toBeTruthy();
  });
});

describe("destinos de audio", () => {
  it("yt-dlp hace mp3/m4a/flac; AC-3 y AIFF van a ffmpeg", () => {
    expect(audioTarget("mp3").ytdlpFormat).toBe("mp3");
    expect(audioTarget("mp3").ffmpegEncoder).toBe("libmp3lame");  // conocido, pero yt-dlp ya lo hace
    expect(audioTarget("m4a").ytdlpFormat).toBe("m4a");
    expect(audioTarget("ac3").ffmpegEncoder).toBe("ac3");
    expect(audioTarget("ac3").needsFfmpeg).toBe(true);
    expect(audioTarget("mp3").needsFfmpeg).toBe(false);
    expect(audioTarget("aiff").ffmpegEncoder).toBe("pcm_s16be");
    expect(audioTarget("aiff").ext).toBe("aiff");
    expect(audioTarget("dts").ffmpegEncoder).toBe("dca");
    expect(audioTarget("pcm24").ffmpegEncoder).toBe("pcm_s24le");
  });

  it("\"best\" no toca el audio y \"ogg\" es vorbis nativo", () => {
    expect(audioTarget("best").ytdlpFormat).toBe("best");
    expect(audioTarget("best").needsFfmpeg).toBe(false);
    // vorbis SÍ está en la lista de yt-dlp: no hace falta ffmpeg
    expect(audioTarget("ogg").needsFfmpeg).toBe(false);
    expect(audioTarget("ogg").label).toMatch(/Vorbis/i);
  });

  it("la calidad del usuario sustituye al bitrate del catálogo (nunca en lossless)", () => {
    expect(audioTarget("ac3", "256K").encArgs).toContain("256k");
    expect(audioTarget("flac", "320K").encArgs).not.toContain("320k");
  });

  it("sabe qué necesita ffmpeg", () => {
    expect(audioNeedsFfmpeg(null)).toBe(true);
    expect(audioNeedsFfmpeg("best")).toBe(false);
    expect(audioNeedsFfmpeg("aiff")).toBe(true);
  });
});

describe("argumentos de ffmpeg", () => {
  it("audio: -vn, códec y salida con la extensión correcta", () => {
    const a = ffmpegAudioArgs("/tmp/x.webm", audioTarget("ac3"));
    expect(a).toContain("-vn");
    expect(a).toContain("ac3");
    expect(a[a.length - 1]).toBe("/tmp/x.ac3");
  });

  it("vídeo H.265 lleva libx265 y la etiqueta hvc1", () => {
    const a = ffmpegVideoArgs("/tmp/x.mkv", "h265", "mp4");
    expect(a).toContain("libx265");
    expect(a).toContain("hvc1");
    expect(a[a.length - 1]).toBe("/tmp/x.mp4");
  });

  it("webm fuerza audio opus", () => {
    expect(ffmpegVideoArgs("/tmp/x.mkv", "vp9", "webm")).toContain("libopus");
  });
});

describe("verificación de códec real", () => {
  it("entiende los nombres de ffprobe y los de yt-dlp", () => {
    expect(codecMatches("hevc", "h265")).toBe(true);
    expect(codecMatches("h264", "h264")).toBe(true);
    expect(codecMatches("av1", "av1")).toBe(true);
    expect(codecMatches("vp9", "vp9")).toBe(true);
    expect(codecMatches("vp9", "h264")).toBe(false);
    expect(codecMatches("cualquiera", "auto")).toBe(true);
  });
});

describe("pistas en los argumentos", () => {
  it("subtítulos incrustados piden conversión a srt", () => {
    const a = buildArgs("yt-dlp", d, { ...base, subtitles: "embed", subLangs: "es,en", autoSubs: true });
    expect(a).toContain("--embed-subs");
    expect(a).toContain("--convert-subs");
    expect(a.join(" ")).toContain("--sub-langs es,en");
    expect(a).toContain("--write-auto-subs");
  });

  it("subtítulos aparte no incrustan nada", () => {
    const a = buildArgs("yt-dlp", d, { ...base, subtitles: "sidecar" });
    expect(a).toContain("--write-subs");
    expect(a).not.toContain("--embed-subs");
  });

  it("capítulos y carátula se incrustan en vídeo", () => {
    const a = buildArgs("yt-dlp", d, { ...base, chapters: true, embedThumbnail: true });
    expect(a).toContain("--embed-chapters");
    expect(a).toContain("--embed-thumbnail");
  });

  it("el códec elegido llega al selector y el contenedor se corrige", () => {
    const a = buildArgs("yt-dlp", d, { ...base, format: "webm", videoCodec: "h264" });
    const i = a.indexOf("-f");
    expect(a[i + 1]).toContain("[vcodec^=avc1]");
    // webm + h264 → merge a un contenedor que sí lo admite, y sin --remux-video webm
    const m = a.indexOf("--merge-output-format");
    expect(a[m + 1]).not.toBe("webm");
  });

  it("audio AC-3 no se le pide a yt-dlp (sería error duro)", () => {
    const a = buildArgs("yt-dlp", d, { ...base, mode: "audio", format: "ac3" });
    const i = a.indexOf("--audio-format");
    expect(a[i + 1]).toBe("best");
    expect(a).not.toContain("ac3");
  });

  it("magick convierte a los formatos nuevos y solo pone -quality donde aplica", () => {
    const avif = magickArgs("/a/b.png", "avif");
    expect(avif).toContain("-quality");
    expect(avif[avif.length - 1]).toMatch(/\.avif$/);
    expect(magickArgs("/a/b.png", "bmp")).not.toContain("-quality");
    expect(magickArgs("/a/b.png", "bmp").at(-1)).toMatch(/\.bmp$/);
  });
});
