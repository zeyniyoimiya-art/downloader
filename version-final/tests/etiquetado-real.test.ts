// Etiquetado REAL con ffmpeg: se comprueba en el archivo, no en la teoría.
//
// Se salta solo si no hay ffmpeg/ffprobe en el equipo (igual que
// `ffmpeg-real.test.ts`): no tiene sentido fallar en una máquina sin binarios.
//
// Lo que se verifica aquí es exactamente lo que el usuario pidió:
//   · las etiquetas llegan al archivo (título, artista, álbum, género, año, letra)
//   · la carátula entra con su TAMAÑO ORIGINAL (1200x1200 sigue siendo 1200x1200)
//   · el audio NO se recodifica (misma duración, mismo códec)
//   · si algo falla, el archivo original queda intacto
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function hay(bin: string): boolean {
  try { execFileSync(bin, ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}
const HAY_FFMPEG = hay("ffmpeg") && hay("ffprobe");
const d = describe.skipIf(!HAY_FFMPEG);

let dir = "";
type Mod = typeof import("@/lib/server/etiquetar");
let M: Mod;

const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "pipe" });
const probe = (f: string) => JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", f], { stdio: "pipe" }).toString());

const TAGS = {
  titulo: "Never Gonna Give You Up", artista: "Rick Astley", album: "Whenever You Need Somebody",
  artistaAlbum: "Rick Astley", genero: "Pop", fecha: "1987-11-12", pista: "1/10", disco: "1",
  compositor: "Stock Aitken Waterman", comentario: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  letra: "[00:19.67] We're no strangers to love\n[00:23.56] You know the rules and so do I",
  isrc: "GBARL9300135",
};

beforeAll(async () => {
  if (!HAY_FFMPEG) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ly-tags-"));
  // El módulo lee la carpeta de datos al importarse: se aísla antes.
  process.env.LINYUE_DATA = path.join(dir, "data");
  M = await import("@/lib/server/etiquetar");
  // 3 s de tono y una carátula CUADRADA grande (el caso del usuario).
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ar", "44100", path.join(dir, "tono.wav")]);
  ff(["-f", "lavfi", "-i", "color=c=0x3355aa:s=1200x1200", "-frames:v", "1", path.join(dir, "portada.png")]);
  ff(["-f", "lavfi", "-i", "color=c=0xaa5533:s=900x600", "-frames:v", "1", path.join(dir, "otra.png")]);
  for (const [ext, codec] of [["mp3", "libmp3lame"], ["m4a", "aac"], ["flac", "flac"], ["opus", "libopus"], ["aac", "aac"]] as const) {
    ff(["-i", path.join(dir, "tono.wav"), "-c:a", codec, path.join(dir, `pista.${ext}`)]);
  }
});

afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

d("etiquetar un MP3 sin recodificar", () => {
  it("escribe todos los campos, la letra y la carátula en tamaño original", async () => {
    const f = path.join(dir, "pista.mp3");
    const antes = probe(f);
    const r = await M.etiquetarArchivo(f, TAGS, { cover: path.join(dir, "portada.png") });
    expect(r.ok).toBe(true);
    expect(r.cover).toBe("incrustada");
    expect(r.campos).toBe(12);

    const despues = probe(f);
    const tag = despues.format.tags ?? {};
    expect(tag.title).toBe(TAGS.titulo);
    expect(tag.artist).toBe(TAGS.artista);
    expect(tag.album).toBe(TAGS.album);
    expect(tag.album_artist).toBe(TAGS.artistaAlbum);
    expect(tag.genre).toBe(TAGS.genero);
    expect(tag.date).toBe(TAGS.fecha);
    expect(tag.track).toBe(TAGS.pista);
    expect(tag.disc).toBe(TAGS.disco);
    expect(tag.composer).toBe(TAGS.compositor);
    expect(tag.comment).toBe(TAGS.comentario);
    expect(tag.ISRC).toBe(TAGS.isrc);
    expect(String(tag.lyrics)).toContain("strangers");

    // ── La carátula NO se redimensiona ──
    const cover = despues.streams.find((s: { codec_type: string; disposition?: { attached_pic?: number } }) => s.codec_type === "video" && s.disposition?.attached_pic);
    expect(cover).toBeDefined();
    expect(cover.width).toBe(1200);
    expect(cover.height).toBe(1200);

    // ── El audio no se recodifica ──
    expect(parseFloat(despues.format.duration)).toBeCloseTo(parseFloat(antes.format.duration), 1);
    expect(despues.streams.find((s: { codec_type: string }) => s.codec_type === "audio").codec_name).toBe("mp3");
  });

  it("es idempotente: aplicarlo dos veces no estropea nada", async () => {
    const f = path.join(dir, "pista.mp3");
    const r2 = await M.etiquetarArchivo(f, TAGS, { cover: path.join(dir, "portada.png") });
    expect(r2.ok).toBe(true);
    // La portada ya estaba: no se añade una segunda.
    expect(r2.cover).toBe("ya-estaba");
    const p = probe(f);
    expect(p.streams.filter((s: { disposition?: { attached_pic?: number } }) => s.disposition?.attached_pic)).toHaveLength(1);
  });
});

d("otros contenedores", () => {
  it("FLAC conserva la carátula cuadrada y las etiquetas", async () => {
    const f = path.join(dir, "pista.flac");
    const r = await M.etiquetarArchivo(f, TAGS, { cover: path.join(dir, "portada.png") });
    expect(r.ok).toBe(true);
    const p = probe(f);
    const cover = p.streams.find((s: { codec_type: string; disposition?: { attached_pic?: number } }) => s.codec_type === "video" && s.disposition?.attached_pic);
    expect([cover.width, cover.height]).toEqual([1200, 1200]);
    expect(p.format.tags.title).toBe(TAGS.titulo);
  });

  it("M4A escribe la letra y la portada sin cambiar el códec", async () => {
    const f = path.join(dir, "pista.m4a");
    const r = await M.etiquetarArchivo(f, TAGS, { cover: path.join(dir, "portada.png") });
    expect(r.ok).toBe(true);
    const p = probe(f);
    expect(p.format.tags.lyrics).toContain("strangers");
    expect(p.streams.find((s: { codec_type: string }) => s.codec_type === "audio").codec_name).toBe("aac");
  });

  it("Opus guarda etiquetas pero dice la verdad sobre la carátula", async () => {
    const f = path.join(dir, "pista.opus");
    const r = await M.etiquetarArchivo(f, TAGS, { cover: path.join(dir, "portada.png") });
    expect(r.ok).toBe(true);
    expect(r.cover).toBe("no-soportada");
    expect(r.motivo).toContain("Opus");
    // Las etiquetas de Opus viven en el STREAM, no en el formato.
    const p = probe(f);
    const audio = p.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    expect(audio.tags.title).toBe(TAGS.titulo);
    expect(audio.tags.lyrics).toContain("strangers");
  });

  it("un contenedor sin metadatos se rechaza con motivo, sin tocar el archivo", async () => {
    const f = path.join(dir, "pista.aac");
    const antes = fs.statSync(f).size;
    const r = await M.etiquetarArchivo(f, TAGS, { cover: path.join(dir, "portada.png") });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("no guarda metadatos");
    expect(fs.statSync(f).size).toBe(antes);
  });
});

d("carátula en WebP: se convierte sin escalar", () => {
  it("1000x1000 webp → 1000x1000 dentro del MP3", async () => {
    const webp = path.join(dir, "c.webp");
    ff(["-f", "lavfi", "-i", "color=c=0x22aa55:s=1000x1000", "-frames:v", "1", webp]);
    const f = path.join(dir, "conwebp.mp3");
    ff(["-i", path.join(dir, "tono.wav"), "-c:a", "libmp3lame", f]);
    const r = await M.etiquetarArchivo(f, { titulo: "X" }, { cover: webp });
    expect(r.ok).toBe(true);
    expect(r.cover).toBe("incrustada");
    expect(r.motivo).toContain("sin cambiar el tamaño");
    const p = probe(f);
    const cover = p.streams.find((s: { codec_type: string; disposition?: { attached_pic?: number } }) => s.codec_type === "video" && s.disposition?.attached_pic);
    expect([cover.width, cover.height]).toEqual([1000, 1000]);
    // El temporal de conversión no se queda tirado.
    expect(fs.readdirSync(dir).filter((n) => n.startsWith("cover-"))).toHaveLength(0);
  });
});

d("red de seguridad", () => {
  it("si el archivo no es un audio, NO se pierde: queda intacto", async () => {
    const f = path.join(dir, "falso.mp3");
    const original = "esto no es un mp3, es texto";
    fs.writeFileSync(f, original);
    const r = await M.etiquetarArchivo(f, TAGS, { cover: path.join(dir, "portada.png") });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(f, "utf8")).toBe(original);
  });

  it("sin etiquetas ni portada no se reescribe nada (ni se copia el archivo)", async () => {
    const f = path.join(dir, "quieto.mp3");
    ff(["-i", path.join(dir, "tono.wav"), "-c:a", "libmp3lame", f]);
    const mtime = fs.statSync(f).mtimeMs;
    const r = await M.etiquetarArchivo(f, {}, {});
    expect(r.ok).toBe(false);
    expect(fs.statSync(f).mtimeMs).toBe(mtime);
  });

  it("inspeccionar() devuelve códec, duración y presencia de carátula", async () => {
    const info = await M.inspeccionar(path.join(dir, "pista.mp3"));
    expect(info?.audio?.codec).toBe("mp3");
    expect(info?.duracion).toBeGreaterThan(2);
    expect(info?.cover).toBe(true);
    expect(info?.coverTamano).toMatchObject({ ancho: 1200, alto: 1200 });
    expect(info?.etiquetas.title).toBe(TAGS.titulo);
  });

  it("inspeccionar() devuelve null con un archivo ilegible (no lanza)", async () => {
    expect(await M.inspeccionar(path.join(dir, "no-existe.bin"))).toBeNull();
  });
});
