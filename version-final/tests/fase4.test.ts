// Tests de la fase 4: fidelidad de audio, límite de tasa, guardia anti-CSRF,
// validación de carpeta de salida y argumentos nuevos de los motores.
import { describe, expect, it } from "vitest";
import { bestPassthrough, formatLabel, isLosslessSource, isLossySource, planAudio } from "../src/lib/shared/fidelity";
import { HostLimiter, hostKey, jitter } from "../src/lib/server/ratelimit";
import { guard } from "../src/lib/server/guard";
import { ConfigSchema, getConfig } from "../src/lib/server/store";
import { buildArgs, type ArgOptions } from "../src/lib/shared/args";
import { detect } from "../src/lib/shared/platforms";

const AAC = { codec: "mp4a.40.2", abr: 128, ext: "m4a" };
const OPUS = { codec: "opus", abr: 160, ext: "webm" };
const FLAC = { codec: "flac", abr: 900, ext: "flac" };

describe("fidelidad: el FLAC que no es FLAC", () => {
  it("estricto: FLAC pedido sobre AAC entrega m4a sin recodificar y avisa", () => {
    const p = planAudio("flac", AAC, "estricto");
    expect(p.format).toBe("m4a");
    expect(p.upconvert).toBe(false);
    expect(p.reencode).toBe(false);
    expect(p.note).toMatch(/falso/i);
  });

  it("avisar: convierte pero marca el trabajo como transcode", () => {
    const p = planAudio("flac", AAC, "avisar");
    expect(p.format).toBe("flac");
    expect(p.upconvert).toBe(true);
    expect(p.note).toMatch(/transcode/i);
  });

  it("libre: convierte y dice que no hay mejora real", () => {
    const p = planAudio("flac", AAC, "libre");
    expect(p.format).toBe("flac");
    expect(p.upconvert).toBe(true);
    expect(p.note).toMatch(/NO tiene más calidad/i);
  });

  it("fuente lossless → FLAC real, sin marcar upconvert", () => {
    const p = planAudio("flac", FLAC, "estricto");
    expect(p.format).toBe("flac");
    expect(p.upconvert).toBe(false);
    expect(p.note).toMatch(/real/i);
  });

  it("\"best\" nunca toca el audio", () => {
    const p = planAudio("best", OPUS, "estricto");
    expect(p.reencode).toBe(false);
    expect(p.format).toBe("webm");
  });

  it("mp3 sobre AAC se permite (es lossy→lossy, no un disfraz)", () => {
    const p = planAudio("mp3", AAC, "estricto");
    expect(p.format).toBe("mp3");
    expect(p.upconvert).toBe(false);
  });

  it("bestPassthrough mapea códec → contenedor compatible", () => {
    expect(bestPassthrough(AAC)).toBe("m4a");
    expect(bestPassthrough(OPUS)).toBe("opus");
    expect(bestPassthrough({ codec: "vorbis", ext: "webm" })).toBe("ogg");
    expect(bestPassthrough({ codec: "mp3", ext: "mp3" })).toBe("mp3");
    expect(bestPassthrough(FLAC)).toBe("flac");
    expect(bestPassthrough({ codec: "pcm_s16le", ext: "wav" })).toBe("wav");
    expect(bestPassthrough({ codec: null, ext: null }, "m4a")).toBe("m4a");
  });

  it("distingue lossless de lossy sin adivinar", () => {
    expect(isLosslessSource(FLAC)).toBe(true);
    expect(isLosslessSource({ codec: "pcm_s24le" })).toBe(true);
    expect(isLosslessSource(AAC)).toBe(false);
    expect(isLossySource(OPUS)).toBe(true);
    expect(isLossySource(FLAC)).toBe(false);
    expect(isLosslessSource({ codec: null, ext: null })).toBe(false);
  });

  it("formatLabel añade el aviso solo cuando hubo transcode", () => {
    expect(formatLabel({ format: "flac", reencode: true, upconvert: true, note: "" })).toMatch(/lossy/);
    expect(formatLabel({ format: "flac", reencode: false, upconvert: false, note: "" })).toBe("FLAC");
  });
});

describe("rate limit por host", () => {
  const T = 1_700_000_000_000;

  it("hostKey normaliza www y subdominios móviles", () => {
    expect(hostKey("https://www.youtube.com/watch?v=1")).toBe("youtube.com");
    expect(hostKey("https://m.facebook.com/x")).toBe("facebook.com");
    expect(hostKey("no-es-url")).toBe("");
  });

  it("sin límite configurado siempre deja pasar", () => {
    const l = new HostLimiter();
    for (let i = 0; i < 50; i++) expect(l.check("https://a.com/v", T).kind).toBe("ok");
  });

  it("token bucket: ráfaga inicial y luego espera", () => {
    const l = new HostLimiter({ perMinute: 3 });
    expect(l.check("https://a.com/1", T).kind).toBe("ok");
    expect(l.check("https://a.com/2", T).kind).toBe("ok");
    expect(l.check("https://a.com/3", T).kind).toBe("ok");
    const w = l.check("https://a.com/4", T);
    expect(w.kind).toBe("wait");
    expect(w.waitMs).toBeGreaterThan(0);
    // Otro host no se ve afectado
    expect(l.check("https://b.com/1", T).kind).toBe("ok");
  });

  it("backoff 30 → 60 → 120 → 240 → 300 s (tope)", () => {
    const l = new HostLimiter();
    const esperado = [30_000, 60_000, 120_000, 240_000, 300_000, 300_000];
    let t = T;
    for (const ms of esperado) {
      expect(l.penalize("https://a.com/x", t)).toBe(ms);
      t += 1000; // mismo episodio: los strikes se acumulan
    }
  });

  it("el castigo se olvida pasado el strikeWindow", () => {
    const l = new HostLimiter({ strikeWindowMs: 1000 });
    expect(l.penalize("https://a.com/x", T)).toBe(30_000);
    expect(l.penalize("https://a.com/x", T + 5000)).toBe(30_000);
  });

  it("check respeta el cooldown y lo reporta", () => {
    const l = new HostLimiter();
    l.penalize("https://a.com/x", T);
    const r = l.check("https://a.com/y", T + 1000);
    expect(r.kind).toBe("cooldown");
    expect(r.waitMs).toBe(29_000);
    expect(r.reason).toMatch(/límite/);
    expect(l.check("https://a.com/y", T + 31_000).kind).toBe("ok");
  });

  it("respeta Retry-After mayor que el backoff", () => {
    const l = new HostLimiter();
    expect(l.penalize("https://a.com/x", T, 120_000)).toBe(120_000);
  });

  it("reconoce los textos de error reales", () => {
    for (const t of [
      "HTTP Error 429: Too Many Requests",
      "ERROR: rate-limit reached",
      "Sign in to confirm you're not a bot",
      "403 Forbidden",
      "This content is not available... try again later",
    ]) expect(HostLimiter.isRateLimit(t)).toBe(true);
    for (const t of ["Video unavailable", "Unsupported URL", "No space left on device"]) expect(HostLimiter.isRateLimit(t)).toBe(false);
  });

  it("retryAfterMs entiende segundos y minutos", () => {
    expect(HostLimiter.retryAfterMs("Retry-After: 90")).toBe(90_000);
    expect(HostLimiter.retryAfterMs("try again in 5 minutes")).toBe(300_000);
    expect(HostLimiter.retryAfterMs("try again in 20 seconds")).toBe(20_000);
    expect(HostLimiter.retryAfterMs("nada")).toBe(0);
  });

  it("snapshot solo lista hosts castigados", () => {
    const l = new HostLimiter();
    l.penalize("https://a.com/x");
    expect(l.snapshot().map((s) => s.host)).toEqual(["a.com"]);
  });

  it("jitter devuelve un valor dentro del rango", () => {
    for (let i = 0; i < 20; i++) {
      const j = jitter(100);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(100);
    }
  });
});

describe("guard: la API local no es de todos", () => {
  const req = (init: { method?: string; headers?: Record<string, string> } = {}) =>
    new Request("http://127.0.0.1:3000/api/jobs", { method: init.method ?? "POST", headers: init.headers });

  it("rechaza una mutación sin la cabecera x-linyue", () => {
    const g = guard(req());
    expect(g.ok).toBe(false);
  });

  it("acepta la mutación con x-linyue: 1", () => {
    expect(guard(req({ headers: { "x-linyue": "1" } })).ok).toBe(true);
  });

  it("deja pasar los GET sin cabecera", () => {
    expect(guard(req({ method: "GET" })).ok).toBe(true);
  });

  it("bloquea peticiones de otros sitios (Sec-Fetch-Site)", () => {
    const g = guard(req({ headers: { "x-linyue": "1", "sec-fetch-site": "cross-site" } }));
    expect(g.ok).toBe(false);
  });

  it("bloquea cuando Origin no coincide con Host", () => {
    const g = guard(req({ headers: { "x-linyue": "1", origin: "https://evil.example", host: "127.0.0.1:3000" } }));
    expect(g.ok).toBe(false);
  });

  it("modo loopback corta el DNS rebinding", () => {
    const g = guard(req({ headers: { "x-linyue": "1", host: "evil.example:3000" } }), { loopback: true });
    expect(g.ok).toBe(false);
    expect(guard(req({ headers: { "x-linyue": "1", host: "localhost:3000" } }), { loopback: true }).ok).toBe(true);
  });
});

describe("carpeta de salida: nada de System32", () => {
  const base = getConfig();
  it("acepta rutas absolutas normales", () => {
    expect(ConfigSchema.safeParse({ ...base, outputDir: "D:\\Descargas" }).success).toBe(true);
    expect(ConfigSchema.safeParse({ ...base, outputDir: "/home/linyue/Media" }).success).toBe(true);
  });
  it("rechaza rutas relativas", () => {
    expect(ConfigSchema.safeParse({ ...base, outputDir: "Descargas" }).success).toBe(false);
  });
  it("rechaza carpetas del sistema", () => {
    for (const d of ["C:\\Windows\\System32", "C:/Windows/Temp", "C:\\Program Files\\app", "C:\\ProgramData\\x"]) {
      expect(ConfigSchema.safeParse({ ...base, outputDir: d }).success).toBe(false);
    }
  });
});

describe("argumentos nuevos de los motores", () => {
  const d = detect("https://www.youtube.com/watch?v=abc")!;
  const base: ArgOptions = { outputDir: "D:\\Descargas", profileLimit: 50, noRepeat: false, archiveFile: "D:\\archive.txt", turbo: false, cookies: null, ffmpegDir: null, ffmpegPath: null, tempDir: null, quality: "best", mode: "video", format: "mp4", aria2Healthy: false, embedMetadata: false };

  it("yt-dlp recibe cookies del navegador, impersonate, límite y reintentos", () => {
    const a = buildArgs("yt-dlp", d, { ...base, cookiesFromBrowser: "chrome", impersonate: "safari", limitRate: "5M", retries: 4, sleepRequests: 1 });
    expect(a.join(" ")).toContain("--cookies-from-browser chrome");
    expect(a.join(" ")).toContain("--impersonate safari");
    expect(a.join(" ")).toContain("--limit-rate 5M");
    expect(a.join(" ")).toContain("--retries 4");
    expect(a.join(" ")).toContain("--sleep-requests 1");
  });

  it("audio mp3 sube a 320K y \"best\" deja el códec original", () => {
    const mp3 = buildArgs("yt-dlp", d, { ...base, mode: "audio", format: "mp3", audioQuality: "320K" });
    expect(mp3.join(" ")).toContain("--audio-quality 320K");
    const best = buildArgs("yt-dlp", d, { ...base, mode: "audio", format: "best" });
    // "best" = extraer sin recodificar: yt-dlp lo llama --audio-format best y
    // no debe pedir una calidad de conversión concreta.
    expect(best.join(" ")).toContain("--audio-format best");
    expect(best.join(" ")).not.toContain("--audio-quality");
  });

  it("curl usa --fail y reanuda (nunca guarda un 404 como archivo)", () => {
    const a = buildArgs("curl", detect("https://example.com/video.mp4")!, base);
    expect(a).toContain("--fail");
    expect(a).toContain("--continue-at");
  });

  it("streamlink recibe cookies como pares, no una cabecera vacía", () => {
    const a = buildArgs("streamlink", detect("https://www.twitch.tv/alguien")!, { ...base, cookiePairs: ["auth-token=abc"] });
    expect(a.join(" ")).toContain("--http-cookie auth-token=abc");
    expect(a.join(" ")).not.toContain('--http-cookie ""');
  });
});
