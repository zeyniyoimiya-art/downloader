// Conversión REAL con ffmpeg: no comprueba que el catálogo diga "AC-3", comprueba
// que ffprobe encuentra un AC-3 de verdad al final del proceso. Es la diferencia
// entre "el desplegable existe" y "el archivo existe".
//
// Se salta solo si ffmpeg no está en el PATH (en Windows vive en vendor\ffmpeg.exe
// y las pruebas de la app no lo necesitan): así `npm test` nunca falla por eso.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  audioTarget, ffmpegAudioArgs, ffmpegVideoArgs, videoCodecDef, type VideoCodec,
} from "../src/lib/shared/codecs";

const FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ly-ff-"));

function probeCodec(file: string, tipo: "audio" | "video"): string {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", file]).toString());
  return String((j.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === tipo)?.codec_name ?? "");
}
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "ly-"));
const src = path.join(dirA, "tono.wav");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", src]);

const CODEC_ESPERADO: Record<string, string> = {
  ac3: "ac3", eac3: "eac3", dts: "dts", mp2: "mp2", aiff: "pcm_s16be",
  pcm24: "pcm_s24le", flac: "flac", alac: "alac", mp3: "mp3", vorbis: "vorbis", opus: "opus",
};

describe.skipIf(!FFMPEG)("ffmpeg de verdad: cada destino produce su códec", () => {
  for (const [fmt, esperado] of Object.entries(CODEC_ESPERADO)) {
    it(`${fmt} → ${esperado}`, () => {
      const t = audioTarget(fmt, "192K");
      const argv = ffmpegAudioArgs(src, t);
      execFileSync("ffmpeg", argv);
      const salida = argv[argv.length - 1];
      expect(fs.existsSync(salida)).toBe(true);
      expect(probeCodec(salida, "audio")).toBe(esperado);
    });
  }
});

const dirV = fs.mkdtempSync(path.join(os.tmpdir(), "lyv-"));
const clip = path.join(dirV, "clip.mp4");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=1",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-shortest", clip]);

const encoders = spawnSync("ffmpeg", ["-hide_banner", "-encoders"]).stdout?.toString() ?? "";

const CASOS: [VideoCodec, string, string][] = [
  ["h264", "mp4", "h264"],
  ["h265", "mp4", "hevc"],
  ["av1", "mkv", "av1"],
  ["vp9", "webm", "vp9"],
  ["vp8", "webm", "vp8"],
  ["mpeg4", "avi", "mpeg4"],
  ["prores", "mov", "prores"],
  ["theora", "ogv", "theora"],
];

describe.skipIf(!FFMPEG)("ffmpeg de verdad: cada códec de vídeo se produce", () => {
  for (const [codec, cont, esperado] of CASOS) {
    const enc = videoCodecDef(codec).encoder ?? "";
    const disponible = encoders.includes(" " + enc + " ") || encoders.includes(" " + enc + "\n");
    it.skipIf(!disponible)(`${codec} (${enc}) → ${cont}`, () => {
      const argv = ffmpegVideoArgs(clip, codec, cont);
      execFileSync("ffmpeg", argv, { stdio: "pipe" });
      const salida = argv[argv.length - 1];
      expect(fs.existsSync(salida)).toBe(true);
      expect(probeCodec(salida, "video")).toBe(esperado);
    });
  }
});
