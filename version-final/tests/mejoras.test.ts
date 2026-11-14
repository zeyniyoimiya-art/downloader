// Tests de las correcciones aplicadas en la revisión de código.
// Cada bloque documenta el bug que evita que vuelva.
import { describe, expect, it } from "vitest";
import { buildArgs, type ArgOptions } from "../src/lib/shared/args";
import { detect, isSafeUrl, isPrivateHost } from "../src/lib/shared/platforms";
import { argsSinFiltro, formatForPart, listaDeFormatos } from "../src/lib/server/jobs";
import { newId, defaultConfig } from "../src/lib/server/store";

const d = (u: string) => detect(u)!;
const base: ArgOptions = {
  mode: "audio", format: "mp3", quality: "1080", outputDir: "/out",
  turbo: false, aria2Healthy: false, noRepeat: false, embedMetadata: true,
  archiveFile: "/data/archive-audio.txt", profileLimit: 50,
};

describe("BUG: instaloader ignoraba el cookies.txt", () => {
  // Antes: --load-cookies chrome (le dice a instaloader que saque las cookies de
  // Chrome instalado, no del fichero). Consecuencia: tus cookies se ignoraban y
  // si no había Chrome, instaloader abortaba.
  it("usa --cookiefile con la ruta real", () => {
    const a = buildArgs("instaloader", d("https://instagram.com/linyue"), { ...base, mode: "profile", cookies: "/data/cookies/instagram.txt" });
    expect(a).toContain("--cookiefile");
    expect(a[a.indexOf("--cookiefile") + 1]).toBe("/data/cookies/instagram.txt");
  });
  it("ya NO usa --load-cookies", () => {
    const a = buildArgs("instaloader", d("https://instagram.com/linyue"), { ...base, mode: "profile", cookies: "/data/cookies/instagram.txt" });
    expect(a).not.toContain("--load-cookies");
    expect(a).not.toContain("chrome");
  });
  it("sin cookies no añade ninguna bandera de cookies", () => {
    const a = buildArgs("instaloader", d("https://instagram.com/linyue"), { ...base, mode: "profile" });
    expect(a).not.toContain("--cookiefile");
    expect(a).not.toContain("--load-cookies");
  });
});

describe("BUG: spotdl recibía una carpeta en --ffmpeg", () => {
  // spotdl exige la ruta al EJECUTABLE; con la carpeta decía "FFmpeg not found".
  it("pasa el binario, no el directorio", () => {
    const a = buildArgs("spotdl", d("https://open.spotify.com/track/abc"), {
      ...base, ffmpegDir: "C:\\vendor", ffmpegPath: "C:\\vendor\\ffmpeg.exe",
    });
    expect(a[a.indexOf("--ffmpeg") + 1]).toBe("C:\\vendor\\ffmpeg.exe");
  });
  it("yt-dlp sigue recibiendo la carpeta con --ffmpeg-location", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), { ...base, ffmpegDir: "C:\\vendor", ffmpegPath: "C:\\vendor\\ffmpeg.exe" });
    expect(a[a.indexOf("--ffmpeg-location") + 1]).toBe("C:\\vendor");
  });
});

describe("BUG: «perfil completo» en mp3 se degradaba a mp4", () => {
  it("el modo profile acepta formatos de audio y de vídeo", () => {
    const cfg = defaultConfig();
    expect(formatForPart("profile", "mp3", cfg)).toBe("mp3");
    expect(formatForPart("profile", "m4a", cfg)).toBe("m4a");
    expect(formatForPart("profile", "mp4", cfg)).toBe("mp4");
  });
  it("los modos atómicos siguen filtrando por su pool", () => {
    const cfg = { ...defaultConfig(), videoFormat: "mp4" as const, photoFormat: "webp" as const };
    expect(formatForPart("video", "mp3", cfg)).toBe("mp4"); // audio en modo vídeo → default de vídeo
    expect(formatForPart("photo", "mp4", cfg)).toBe("webp");
  });
});

describe("BUG: SSRF parcial en isSafeUrl", () => {
  it("bloquea toda la red privada y link-local", () => {
    for (const u of [
      "http://127.0.0.1/x", "http://10.1.2.3/x", "http://192.168.1.1/x",
      "http://172.16.0.1/x", "http://172.31.255.255/x", "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/x", "http://localhost/x", "http://algo.localhost/x",
      "http://router.internal/x", "http://[::1]/x",
    ]) expect(isSafeUrl(u)).toBe(false);
  });
  it("deja pasar hosts públicos normales", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=jNQXAC9IVRw", "https://youtu.be/a",
      "https://172.32.0.1/x", // fuera del rango 172.16/12
      "https://8.8.8.8/x",
    ]) expect(isSafeUrl(u)).toBe(true);
  });
  it("isPrivateHost no confunde dominios que solo lo parecen", () => {
    expect(isPrivateHost("192.168.1.1")).toBe(true);
    expect(isPrivateHost("192.168.1.1.evil.com")).toBe(false);
  });
});

describe("BUG: ids de trabajo colisionables", () => {
  it("siempre 10 caracteres [a-f0-9] (cumple /^[a-z0-9]{1,12}$/)", () => {
    for (let i = 0; i < 500; i++) expect(newId()).toMatch(/^[a-z0-9]{10}$/);
  });
  it("no se repite en 5000 generaciones", () => {
    const s = new Set(Array.from({ length: 5000 }, newId));
    expect(s.size).toBe(5000);
  });
});

describe("reintento cuando el sitio no tiene el formato pedido", () => {
  it("sustituye el selector y añade --no-check-formats", () => {
    const args = ["-P", "C:\\out", "-f", "bv*+ba/b", "--merge-output-format", "mp4", "--", "https://www.facebook.com/share/p/1EEQ6ttVWJ/"];
    const alt = argsSinFiltro(args);
    expect(alt).toContain("-f");
    expect(alt[alt.indexOf("-f") + 1]).toBe("b/bv*+ba/best");
    expect(alt).toContain("--no-check-formats");
    // el "--" y la URL siguen al final, y no se duplica el flag
    expect(alt.indexOf("--no-check-formats")).toBeLessThan(alt.indexOf("--"));
    expect(argsSinFiltro(alt).filter((x) => x === "--no-check-formats")).toHaveLength(1);
  });

  it("sin selector previo lo añade antes del «--»", () => {
    const alt = argsSinFiltro(["-P", "C:\\out", "--", "https://x/y"]);
    expect(alt[alt.indexOf("-f") + 1]).toBe("b/bv*+ba/best");
    expect(alt[alt.length - 1]).toBe("https://x/y");
  });
});

describe("listaDeFormatos", () => {
  it("resume las filas de yt-dlp -F sin repetir", () => {
    const salida = [
      "[info] Available formats for abc:",
      "ID  EXT   RESOLUTION FPS CH │   FILESIZE   TBR PROTO │ VCODEC        VBR ACODEC      ABR",
      "──────────────────────────────────────────────────────────────────────────────",
      "sb0 mhtml 48x27        0    │                  │ mhtml                   storyboard",
      "137 mp4   1920x1080   25    │  120.00MiB 2500k https │ avc1.640028  2500k video only",
      "136 mp4   1280x720    25    │   60.00MiB 1200k https │ avc1.4d401f  1200k video only",
      "136 mp4   1280x720    25    │   60.00MiB 1200k https │ avc1.4d401f  1200k video only",
      "18  mp4   640x360     25    │   20.00MiB  400k https │ avc1.42001E        mp4a.40.2",
      "140 m4a   audio            │    3.20MiB  128k https │ audio only        mp4a.40.2",
    ].join("\n");
    const r = listaDeFormatos(salida);
    expect(r).toBe("mp4 1920, mp4 1280, mp4 640, m4a audio");
  });

  it("sin formatos devuelve vacío (no inventa)", () => {
    expect(listaDeFormatos("ERROR: Unsupported URL")).toBe("");
  });
});
