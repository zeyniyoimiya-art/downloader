// Tests unitarios: router de motores, parseo de progreso, dedup, sanitización de args. Nunca lanzan ejecutables.
import { describe, expect, it } from "vitest";
import { detect, parseLinks, routeEngine, isSafeUrl, primaryMode, modeParts, supportedModes, availableModes, recommendMode } from "../src/lib/shared/platforms";
import { parseLine, toBytes, fmtBytes, fmtDuration, fmtViews } from "../src/lib/shared/progress";
import { buildArgs, safeUrlArg, sanitizeArg, magickArgs, type ArgOptions } from "../src/lib/shared/args";
import { normalizeUrl } from "../src/lib/server/store";
import { ENGINES } from "../src/lib/server/engines";

const d = (u: string) => detect(u)!;
const opts: ArgOptions = { mode: "audio", format: "mp3", quality: "1080", outputDir: "/out", turbo: false, aria2Healthy: false, noRepeat: true, embedMetadata: true, archiveFile: "/data/archive.txt", profileLimit: 50 };

describe("UA de navegador para Bilibili (WAF)", () => {
  it("bilibili recibe --user-agent con UA de navegador", () => {
    const a = buildArgs("yt-dlp", d("https://www.bilibili.com/video/BV1xx411c7mD"), { ...opts, mode: "video", format: "mp4" });
    expect(a).toContain("--user-agent");
    expect(a.join(" ")).toContain("Mozilla/5.0");
  });
  it("b23.tv (enlace corto) también recibe el UA", () => {
    expect(buildArgs("yt-dlp", d("https://b23.tv/abc123"), { ...opts, mode: "video", format: "mp4" })).toContain("--user-agent");
  });
  it("YouTube NO recibe --user-agent", () => {
    const a = buildArgs("yt-dlp", d("https://www.youtube.com/watch?v=jNQXAC9IVRw"), { ...opts, mode: "video", format: "mp4" });
    expect(a).not.toContain("--user-agent");
  });
});

describe("selector de calidad con fallback (vídeos verticales/DASH-only)", () => {
  it("calidad fija: cadena completa con fallback por ancho y final", () => {
    const f = buildArgs("yt-dlp", d("https://www.bilibili.com/video/BV1xx411c7mD"), { ...opts, mode: "video", format: "mp4", quality: "480" }).join(" ");
    expect(f).toContain("bv*[height<=480]+ba/bv*[width<=480]+ba/b[height<=480]/b[width<=480]/bv*+ba/b");
  });
  it("quality=best mantiene el selector simple bv*+ba/b", () => {
    const f = buildArgs("yt-dlp", d("https://www.youtube.com/watch?v=jNQXAC9IVRw"), { ...opts, mode: "video", format: "mp4", quality: "best" }).join(" ");
    expect(f).toContain("-f bv*+ba/b");
    expect(f).not.toContain("height<=");
  });
});

describe("turbo (aria2c) desactivado donde la CDN lo rechaza", () => {
  const turbo = { ...opts, mode: "video" as const, format: "mp4", turbo: true, aria2Healthy: true };
  it("bilibili NO usa aria2c (exit 29 en su CDN)", () => {
    const f = buildArgs("yt-dlp", d("https://www.bilibili.com/video/BV1xx411c7mD"), turbo).join(" ");
    expect(f).not.toContain("--external-downloader");
  });
  it("YouTube NO usa aria2c (exit 22, y yt-dlp no hace fallback solo)", () => {
    const f = buildArgs("yt-dlp", d("https://www.youtube.com/watch?v=jNQXAC9IVRw"), turbo).join(" ");
    expect(f).not.toContain("--external-downloader");
  });
  it("youtu.be tampoco", () => {
    expect(buildArgs("yt-dlp", d("https://youtu.be/a"), turbo).join(" ")).not.toContain("--external-downloader");
  });
  it("un sitio normal SÍ usa aria2c con turbo", () => {
    const f = buildArgs("yt-dlp", d("https://download.samplelib.com/mp4/sample-5s.mp4"), turbo).join(" ");
    expect(f).toContain("--external-downloader aria2c");
  });
});

describe("router de motores", () => {
  it("Spotify track → spotdl", () => expect(routeEngine(d("https://open.spotify.com/track/abc"), "audio")).toBe("spotdl"));
  it("Spotify álbum es colección", () => expect(d("https://open.spotify.com/album/abc").kind).toBe("collection"));
  it("Instagram perfil → instaloader", () => expect(routeEngine(d("https://instagram.com/linyue"), "photo")).toBe("instaloader"));
  it("Instagram reel → yt-dlp", () => expect(routeEngine(d("https://www.instagram.com/reel/XYZ/"), "video")).toBe("yt-dlp"));
  it("Pinterest → gallerydl", () => expect(routeEngine(d("https://pinterest.com/pin/1"), "photo")).toBe("gallerydl"));
  it("X media → gallerydl", () => expect(routeEngine(d("https://x.com/u/media"), "video")).toBe("gallerydl"));
  it("YouTube → yt-dlp", () => expect(routeEngine(d("https://youtu.be/abc"), "audio")).toBe("yt-dlp"));
  it("Bilibili con lux activo y sano → lux", () => expect(routeEngine(d("https://www.bilibili.com/video/BV1"), "video", { altEngineCN: true, healthy: () => true })).toBe("lux"));
  it("Bilibili con lux caído → yt-dlp", () => expect(routeEngine(d("https://www.bilibili.com/video/BV1"), "video", { altEngineCN: true, healthy: () => false })).toBe("yt-dlp"));
  it("TikTok perfil detectado", () => expect(d("https://www.tiktok.com/@lin").kind).toBe("profile"));
  it("YouTube canal es colección", () => expect(d("https://youtube.com/@canal").kind).toBe("collection"));
  it("Facebook → yt-dlp", () => expect(routeEngine(d("https://www.facebook.com/watch/?v=1"), "video")).toBe("yt-dlp"));
  it("Imgur (galería) en modo foto → gallerydl", () => expect(routeEngine(d("https://imgur.com/a/xyz"), "photo")).toBe("gallerydl"));
  it("DeviantArt detectado como galería", () => expect(d("https://www.deviantart.com/autor/art/x").kind).toBe("gallery"));
  it("instagr.am se detecta como Instagram", () => expect(d("https://instagr.am/linyue").platform).toBe("instagram"));
  it("Instagram /explore no es perfil → yt-dlp", () => expect(routeEngine(d("https://www.instagram.com/explore/"), "photo")).toBe("yt-dlp"));
});

describe("registro de motores (fusión)", () => {
  it("expone exactamente 12 motores", () => expect(ENGINES).toHaveLength(12));
  it("todos declaran args de versión", () => expect(ENGINES.every((e) => e.versionArgs.length > 0)).toBe(true));
  it("yt-dlp acepta el alias ytdlp.exe", () => expect(ENGINES.find((e) => e.id === "yt-dlp")?.alt).toContain("ytdlp.exe"));
});

describe("detección y seguridad de links", () => {
  it("rechaza localhost (SSRF)", () => expect(isSafeUrl("http://127.0.0.1/x")).toBe(false));
  it("rechaza file://", () => expect(isSafeUrl("file:///etc/passwd")).toBe(false));
  it("rechaza comillas", () => expect(isSafeUrl('https://a.com/"x')).toBe(false));
  it("parseLinks dedup y multilínea", () => expect(parseLinks("https://youtu.be/a\nhttps://youtu.be/a\nbasura\nhttps://x.com/b").length).toBe(2));
  it("parseLinks con texto vacío → []", () => expect(parseLinks("   ")).toEqual([]));
});

describe("parseo de progreso", () => {
  it("yt-dlp completo", () => expect(parseLine("[download]  45.3% of ~10.00MiB at  2.50MiB/s ETA 00:04")).toEqual({ percent: 45.3, speed: 2.5 * 1024 ** 2, eta: "00:04" }));
  it("yt-dlp 100% sin velocidad", () => expect(parseLine("[download] 100% of 3.00MiB")?.percent).toBe(100));
  it("aria2c", () => expect(parseLine("[#2089b0 400.0KiB/33.2MiB(1%) CN:1 DL:115.7KiB ETA:4m51s]")).toMatchObject({ percent: 1, eta: "4m51s" }));
  it("marcador de archivo", () => expect(parseLine("LYF|/out/a.mp3")?.file).toBe("/out/a.mp3"));
  it("línea irrelevante → null", () => expect(parseLine("[youtube] Extracting URL")).toBeNull());
  it("toBytes KiB", () => expect(toBytes("2", "KiB")).toBe(2048));
  it("fmtBytes", () => expect(fmtBytes(1536)).toBe("1.5 KB"));
  it("fmtDuration con horas", () => expect(fmtDuration(3725)).toBe("1:02:05"));
  it("fmtViews", () => {
    expect(fmtViews(850)).toBe("850");
    expect(fmtViews(12345)).toBe("12.3k");
    expect(fmtViews(2500000)).toBe("2.5M");
    expect(fmtViews(1000000)).toBe("1M");
    expect(fmtViews(0)).toBe("");
  });
});

describe("dedup", () => {
  it("ignora utm, www y hash", () => expect(normalizeUrl("https://www.youtube.com/watch?v=a&utm_source=x#t")).toBe(normalizeUrl("https://youtube.com/watch?v=a")));
  it("distingue ids distintos", () => expect(normalizeUrl("https://youtu.be/a")).not.toBe(normalizeUrl("https://youtu.be/b")));
});

describe("sanitización y args", () => {
  it("quita saltos de línea", () => expect(sanitizeArg("a\nb\r\0")).toBe("ab"));
  it("URL que empieza por - falla", () => expect(() => safeUrlArg("--exec=rm")).toThrow());
  it("yt-dlp termina con -- url", () => { const a = buildArgs("yt-dlp", d("https://youtu.be/a"), opts); expect(a.slice(-2)).toEqual(["--", "https://youtu.be/a"]); });
  it("yt-dlp audio usa -x y archive", () => { const a = buildArgs("yt-dlp", d("https://youtu.be/a"), opts); expect(a).toContain("-x"); expect(a).toContain("--download-archive"); });
  it("M4A nativo sin recodificar", () => expect(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, format: "m4a" })).toContain("bestaudio[ext=m4a]/bestaudio"));
  it("turbo solo con aria2c sano", () => {
    // URL neutra: en YouTube/bilibili aria2c se omite a propósito (ver arriba).
    const u = d("https://download.samplelib.com/mp4/sample-5s.mp4");
    expect(buildArgs("yt-dlp", u, { ...opts, turbo: true, aria2Healthy: false })).not.toContain("--external-downloader");
    expect(buildArgs("yt-dlp", u, { ...opts, turbo: true, aria2Healthy: true })).toContain("--external-downloader");
  });
  it("video limita altura", () => expect(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "video", format: "mp4" }).join(" ")).toContain("height<=1080"));
  it("instaloader valida usuario", () => expect(() => buildArgs("instaloader", d("https://instagram.com/bad%20user"), opts)).toThrow());
  it("spotdl mapea vorbis→ogg", () => expect(buildArgs("spotdl", d("https://open.spotify.com/track/a"), { ...opts, format: "vorbis" })).toContain("ogg"));
it("motor sin descargas lanza", () => expect(() => buildArgs("ffmpeg", d("https://youtu.be/a"), opts)).toThrow());
  it("magick cambia extensión", () => expect(magickArgs("/o/a.png", "webp").at(-1)).toBe("/o/a.webp"));
  it("embedMetadata activo añade --embed-metadata", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), opts);
    expect(a).toContain("--embed-metadata");
    expect(a).toContain("--embed-thumbnail");
  });
  it("embedMetadata desactivado omite flags de metadata", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, embedMetadata: false });
    expect(a).not.toContain("--embed-metadata");
    expect(a).not.toContain("--embed-thumbnail");
  });
  it("wav lleva metadata pero NO thumbnail (yt-dlp lo rechaza)", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, format: "wav" });
    expect(a).toContain("--embed-metadata");
    expect(a).not.toContain("--embed-thumbnail");
  });
  it("webm no lleva --embed-thumbnail (contenedor incompatible)", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "video", format: "webm" });
    expect(a).toContain("--embed-metadata");
    expect(a).not.toContain("--embed-thumbnail");
  });
  it("aac tampoco lleva --embed-thumbnail", () => {
    expect(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, format: "aac" })).not.toContain("--embed-thumbnail");
  });
});

describe("detección de Threads", () => {
  it("reconoce threads.net", () => expect(d("https://www.threads.net/@user/post/abc").platform).toBe("threads"));
  it("reconoce threads.com", () => expect(d("https://www.threads.com/@user/post/abc").label).toBe("Threads"));
  it("threads no se confunde con instagram", () => expect(d("https://www.threads.net/@user/post/abc").platform).not.toBe("instagram"));
});

describe("modos combinados: expansión y parte principal", () => {
  it("primaryMode reduce un combo a su primera parte", () => {
    expect(primaryMode("all")).toBe("photo");
    expect(primaryMode("photo_video")).toBe("photo");
    expect(primaryMode("audio_photo")).toBe("audio");
    expect(primaryMode("video")).toBe("video");
  });
  it("modeParts expande los combos a atómicos", () => {
    expect(modeParts("all")).toEqual(["photo", "video", "audio"]);
    expect(modeParts("photo_video")).toEqual(["photo", "video"]);
    expect(modeParts("audio_photo")).toEqual(["audio", "photo"]);
    expect(modeParts("audio")).toEqual(["audio"]);
  });
  it("routeEngine con combo no rompe (usa la parte principal)", () => {
    expect(routeEngine(d("https://pinterest.com/pin/1"), "photo_video")).toBe("gallerydl");
    expect(routeEngine(d("https://open.spotify.com/track/a"), "all")).toBe("spotdl");
  });
});

describe("capacidades por plataforma (supportedModes)", () => {
  it("Spotify solo audio", () => expect(supportedModes(d("https://open.spotify.com/track/a"))).toEqual(["audio"]));
  it("YouTube sin fotos", () => expect(supportedModes(d("https://youtu.be/a"))).toEqual(["audio", "video", "profile"]));
  it("Pinterest solo fotos", () => expect(supportedModes(d("https://pinterest.com/pin/1"))).toEqual(["photo"]));
  it("X/Instagram tienen las 4", () => expect(supportedModes(d("https://x.com/u/status/1"))).toEqual(["audio", "video", "photo", "profile"]));
});

describe("modos disponibles según los links", () => {
  it("sin links → los 7", () => expect(availableModes([]).length).toBe(7));
  it("solo YouTube → sin foto ni combos con foto", () => {
    const m = availableModes([d("https://youtu.be/a")]);
    expect(m).toContain("video"); expect(m).toContain("audio");
    expect(m).not.toContain("photo"); expect(m).not.toContain("all"); expect(m).not.toContain("photo_video");
  });
  it("solo Spotify → solo audio", () => expect(availableModes([d("https://open.spotify.com/track/a")])).toEqual(["audio"]));
  it("X → incluye combos con foto", () => {
    const m = availableModes([d("https://x.com/u/status/1")]);
    expect(m).toContain("all"); expect(m).toContain("photo_video"); expect(m).toContain("audio_photo");
  });
  it("mezcla incompatible (Spotify+Pinterest) → los 7", () => {
    expect(availableModes([d("https://open.spotify.com/track/a"), d("https://pinterest.com/pin/1")]).length).toBe(7);
  });
});

describe("recomendación de modo", () => {
  it("sin links → audio", () => expect(recommendMode([])).toBe("audio"));
  it("Spotify → audio", () => expect(recommendMode([d("https://open.spotify.com/track/a")])).toBe("audio"));
  it("Pinterest → photo", () => expect(recommendMode([d("https://pinterest.com/pin/1")])).toBe("photo"));
  it("canal/lista de YouTube → profile", () => expect(recommendMode([d("https://www.youtube.com/@linyue")])).toBe("profile"));
  it("X → photo_video", () => expect(recommendMode([d("https://x.com/u/status/1")])).toBe("photo_video"));
  it("YouTube video suelto → video", () => expect(recommendMode([d("https://youtu.be/a")])).toBe("video"));
});

describe("audio y vídeo NUNCA comparten ruta (evita borrar el vídeo)", () => {
  const tpl = (a: string[]) => a[a.indexOf("-o") + 1];
  it("el audio va a su propia subcarpeta Audio/", () => {
    expect(tpl(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "audio", format: "mp3" }))).toContain("/Audio/");
  });
  it("el vídeo NO usa la subcarpeta de audio", () => {
    expect(tpl(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "video", format: "mp4" }))).not.toContain("/Audio/");
  });
  it("mismo link en audio y en vídeo ⇒ plantillas distintas", () => {
    const v = tpl(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "video", format: "mp4" }));
    const s = tpl(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "audio", format: "mp3" }));
    // yt-dlp descarga el ORIGEN del audio con el nombre del vídeo y luego lo borra:
    // si ambas plantillas coincidieran, bajar el audio eliminaría el vídeo.
    expect(v).not.toBe(s);
    expect(v.replace("/Audio/", "")).not.toBe(s.replace("/Audio/", ""));
  });
});

describe("decide el FORMATO, no el modo", () => {
  it("perfil completo en mp3 usa -x (antes: --merge-output-format mp3, orden inválida)", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "profile", format: "mp3" });
    expect(a).toContain("-x");
    expect(a).not.toContain("--merge-output-format");
  });
  it("modo foto no lleva merge ni remux (antes: --merge-output-format original)", () => {
    const a = buildArgs("yt-dlp", d("https://x.com/u/status/1"), { ...opts, mode: "photo", format: "original" });
    expect(a).not.toContain("--merge-output-format");
    expect(a).not.toContain("--remux-video");
  });
  it("vídeo sí lleva merge y remux", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "video", format: "mp4" });
    expect(a).toContain("--merge-output-format");
    expect(a).toContain("--remux-video");
  });
  it("webm no lleva remux", () => {
    const a = buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, mode: "video", format: "webm" });
    expect(a).toContain("--merge-output-format");
    expect(a).not.toContain("--remux-video");
  });
  it("tempDir se traduce en -P temp:", () => {
    expect(buildArgs("yt-dlp", d("https://youtu.be/a"), { ...opts, tempDir: "/tmp/ly" }).join(" ")).toContain("-P temp:/tmp/ly");
  });
  it("sin tempDir no se añade -P temp:", () => {
    expect(buildArgs("yt-dlp", d("https://youtu.be/a"), opts).join(" ")).not.toContain("temp:");
  });
});

describe("sitio genérico (ningún dominio reconocido)", () => {
  it("URL directa a un MP4 → video (antes: Fotos + Video)", () => {
    expect(recommendMode([d("https://download.samplelib.com/mp4/sample-5s.mp4")])).toBe("video");
  });
  it("URL directa a una imagen → photo", () => {
    expect(recommendMode([d("https://ejemplo.com/fotos/paisaje.jpg")])).toBe("photo");
  });
  it("una imagen con query string también cuenta como photo", () => {
    expect(recommendMode([d("https://ejemplo.com/img.webp?w=800")])).toBe("photo");
  });
  it("un MP4 directo NO debe encolar ningún trabajo de gallery-dl", () => {
    const l = d("https://download.samplelib.com/mp4/sample-5s.mp4");
    const partes = modeParts(recommendMode([l])).filter((p) => supportedModes(l).includes(p));
    expect([...new Set(partes.map((p) => routeEngine(l, p)))]).toEqual(["yt-dlp"]);
  });
  it("«todo» en un MP4 directo tampoco mete gallery-dl", () => {
    const l = d("https://download.samplelib.com/mp4/sample-5s.mp4");
    const partes = modeParts("all").filter((p) => supportedModes(l).includes(p));
    expect(partes).not.toContain("photo");
  });
});
